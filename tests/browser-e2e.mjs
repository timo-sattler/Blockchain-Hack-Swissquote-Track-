// Browser end-to-end test of the real wallet app in Google Chrome (or Edge), with a virtual
// WebAuthn authenticator and a fake webcam. Needs `npm run demo` running (a short
// RECOVERY_DELAY_SECONDS makes it much faster: `npm run demo:fast`) and Chrome or Edge installed.
//
//   npm run test:browser
//   APP_URL=http://localhost:5173 BROWSER=msedge HEADED=1 node tests/browser-e2e.mjs
//
// Scenario 1 (passkey with PRF, like iCloud Keychain / Google Password Manager):
//   create wallet (MPC key generation in the browser) → unlock → co-sign a payment with the vault →
//   add a second device by invite link → remove it → lose this device → recover with the synced
//   passkey (all key parts refreshed) → unlock → new device with only the paper card recovers too
// Scenario 2 (passkey WITHOUT PRF, like many Windows Hello setups):
//   create wallet with the password fallback → unlock (wrong + right password) → remove →
//   recover with the encrypted backup file + uploaded photo → unlock →
//   offline emergency tool signs for the same wallet from backup file + paper card
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { ethers } from "ethers";

const APP = process.env.APP_URL || "http://localhost:5173";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-browser-e2e-"));

const browser = await chromium.launch({
  channel: process.env.BROWSER || "chrome",
  headless: !process.env.HEADED,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

async function newDevice({ prf }) {
  const context = await browser.newContext({ acceptDownloads: true, permissions: ["camera"], viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf },
  });
  await page.goto(APP);
  return { context, page };
}

const button = (page, name) => page.getByRole("button", { name });

async function bankLogin(page, clientId, password) {
  await page.locator('input[autocomplete="username"]').fill(clientId);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await button(page, "Continue").click();
  const sms = page.locator(".banner.mock", { hasText: "MOCK SMS" });
  await sms.waitFor();
  const code = (await sms.innerText()).match(/(\d{6})/)[1];
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
  await button(page, "Log in").click();
}

async function cameraSelfie(page, label) {
  await button(page, label).click();
  await page.locator(".camera video").waitFor();
  await page.waitForFunction(() => document.querySelector(".camera video")?.videoWidth > 0);
  await button(page, "📸 Capture").click();
  await page.locator("img.selfie").waitFor();
}

async function confirmCard(page) {
  // Fail with the app's own error message instead of a bare timeout.
  const shown = await Promise.race([
    page.getByRole("heading", { name: "Your paper Recovery Card" }).waitFor({ timeout: 90_000 }).then(() => null),
    page.locator(".banner.bad, .err").first().waitFor({ timeout: 90_000 }).then(() => page.locator(".banner.bad, .err").first().innerText()),
  ]);
  if (shown) throw new Error(`The app shows an error instead of the Recovery Card: ${shown}`);
  const words = await page.locator(".words div").evaluateAll((els) => els.map((e) => e.lastChild.textContent.trim()));
  assert.equal(words.length, 24);
  const dl = page.waitForEvent("download");
  await button(page, /^⬇ Download$/).click();
  const cardFile = path.join(tmp, `card-${Date.now()}.txt`);
  await (await dl).saveAs(cardFile);
  const label = await page.getByText(/To check, type word #\d+/).innerText();
  const n = Number(label.match(/#(\d+)/)[1]);
  await page.locator(".card input.f").last().fill(words[n - 1]);
  await button(page, "Continue").click();
  return { words, cardFile };
}

async function saveBackupFile(page) {
  const dl = page.waitForEvent("download");
  await button(page, /Download encrypted backup file/).click();
  const file = path.join(tmp, `backup-${Date.now()}.json`);
  await (await dl).saveAs(file);
  return file;
}

async function approveKyc(context, expectBadge) {
  const op = await context.newPage();
  await op.goto(`${APP}/portal/kyc.html`);
  await op.getByRole("button", { name: "Log in" }).click();
  await op.getByText(expectBadge).first().waitFor();
  await op.getByRole("button", { name: /Same person, approve/ }).first().click();
  await op.getByText(/Decision: approved/).first().waitFor();
  await op.close();
}

async function homeAddress(page) {
  await page.locator(".hero .addr").waitFor();
  return (await page.locator(".hero .addr").innerText()).match(/0x[0-9a-fA-F]{40}/)[0];
}

// The app's own modules (served by Vite) co-sign a payment in the page: Trust Wallet Core builds it,
// the bank approves it with the virtual passkey, Part A + the vault's Part B sign. The test wallet
// has no Sepolia ETH, so the compiled transaction is returned instead of broadcast.
async function coSignInBrowser(page) {
  return page.evaluate(async () => {
    const im = (m) => import(/* @vite-ignore */ m);
    const [{ loadProfile }, api, pay, passkey, keys, mpc, walletcore] = await Promise.all(
      ["/src/lib/profile.ts", "/src/lib/api.ts", "/src/lib/pay.ts", "/src/lib/passkey.ts", "/src/lib/keys.ts", "/src/lib/mpc.ts", "/src/lib/walletcore.ts"].map(im)
    );
    const p = loadProfile();
    const draft = await pay.draftPayment(p, await api.config(), "ETH", "0x000000000000000000000000000000000000dEaD", 1000n, false);
    const prepared = await pay.prepareWithBank(draft);
    const pk = await passkey.getPasskey({ serverOptions: prepared.options });
    const { ticket } = await api.bank("/tx/approve", "POST", { response: pk.json, version: p.keyVersion });
    const partA = await keys.openPartA(p, { kind: "prf", prf: passkey.requirePrf(pk) });
    const full = await walletcore.finishSignature(draft.hash, await mpc.signWithVault(partA, ticket, draft.hash), p.address);
    return walletcore.compileTx(draft.tx, full, Uint8Array.from(p.publicKey.match(/../g).map((h) => parseInt(h, 16))));
  });
}

test("passkey with PRF: create, co-sign, add + remove a device, lose device, recover with synced passkey", { timeout: 300_000 }, async () => {
  const { context, page } = await newDevice({ prf: true });
  await button(page, "Create my Swissquote Wallet").click();
  await bankLogin(page, "SQ-100234", "Demo-1234");
  await cameraSelfie(page, "📷 Take reference photo");
  await button(page, "Continue").click();
  await button(page, /^Protect with/).click();
  await confirmCard(page);
  await page.getByText("Your Swissquote Wallet is ready").waitFor();
  await button(page, "Open my wallet").click();

  await button(page, /^Unlock with/).click();
  const address = await homeAddress(page);
  await page.getByText(/MPC 2 of 3/).waitFor();

  // Send: an empty wallet gets a clear message instead of a failed broadcast.
  await button(page, /Send/).first().click();
  await page.locator("input.f.mono").fill("0x000000000000000000000000000000000000dEaD");
  await button(page, "Review payment").click();
  await page.getByText(/Not enough ETH/).waitFor();
  // Free USDC transfer: an empty fee account (or an empty wallet) is reported before any approval.
  await page.getByRole("button", { name: /USDC/ }).click();
  await button(page, "Review payment").click();
  await page.getByText(/fee account is empty|Not enough USDC/).waitFor();
  const raw = await coSignInBrowser(page);
  assert.equal(ethers.Transaction.from(raw).from, address, "Part A + Part B co-signed in the browser, Trust Wallet Core compiled it");
  await button(page, "Back").click();

  // Add a second device with an invite link (QR), then remove it again.
  await button(page, "Settings").click();
  await page.getByText("How your key works").waitFor();
  await button(page, /Add a device/).click();
  await page.locator("img.qr").waitFor();
  const link = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Copy link"));
    let copied = "";
    navigator.clipboard.writeText = async (t) => void (copied = t);
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    return copied;
  });
  assert.match(link, /#add-device=SQ-100234\./);
  const second = await newDevice({ prf: true });
  await second.page.goto(link);
  await bankLogin(second.page, "SQ-100234", "Demo-1234");
  await button(second.page, /^Protect with/).click();
  await button(second.page, /^Unlock with/).click({ timeout: 60_000 });
  assert.equal(await homeAddress(second.page), address, "the second device holds the same wallet");
  await second.context.close();
  await page.reload();
  await button(page, /^Unlock with/).click();
  await button(page, "Settings").click();
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".list-item")].some((e) => e.textContent.includes("Remove")));

  // Lose the device (the passkey survives in the authenticator, like a synced passkey).
  await button(page, /Remove wallet from this device/).click();
  await button(page, "I lost my device. Recover my wallet").click();
  await bankLogin(page, "SQ-100234", "Demo-1234");
  await page.getByText("What do you still have?").waitFor();
  await button(page, "Continue").click();
  await cameraSelfie(page, "📷 Take selfie");
  await button(page, "Start recovery").click();
  await page.getByText("Checking your identity…").waitFor();
  await approveKyc(context, "live camera");
  await button(page, "Continue").click({ timeout: 90_000 });
  await button(page, /^Unlock with/).click(); // the synced passkey, before this device creates its new one
  await button(page, /^Protect with/).click();
  const { cardFile } = await confirmCard(page);
  await page.getByText(/Welcome back/).waitFor();
  await button(page, "Open my wallet").click();
  await button(page, /^Unlock with/).click();
  assert.equal(await homeAddress(page), address, "same wallet after recovery");
  await context.close();

  // Everything lost but the paper card: a brand-new device without any passkey.
  const fresh = await newDevice({ prf: true });
  await button(fresh.page, "I lost my device. Recover my wallet").click();
  await bankLogin(fresh.page, "SQ-100234", "Demo-1234");
  await button(fresh.page, /My paper Recovery Card/).click();
  await button(fresh.page, "Continue").click();
  await cameraSelfie(fresh.page, "📷 Take selfie");
  await button(fresh.page, "Start recovery").click();
  await approveKyc(fresh.context, "live camera");
  await button(fresh.page, "Continue").click({ timeout: 90_000 });
  await fresh.page.locator('input[type="file"][accept=".txt,text/plain"]').setInputFiles(cardFile);
  await button(fresh.page, "Continue").click();
  await button(fresh.page, /^Protect with/).click();
  await confirmCard(fresh.page);
  await button(fresh.page, "Open my wallet").click();
  await button(fresh.page, /^Unlock with/).click();
  assert.equal(await homeAddress(fresh.page), address, "same wallet from the paper card alone (+ Swissquote)");
  await fresh.context.close();
});

test("passkey without PRF: password fallback, backup file recovery, offline emergency tool", { timeout: 300_000 }, async () => {
  const { context, page } = await newDevice({ prf: false });
  await button(page, "Create my Swissquote Wallet").click();
  await bankLogin(page, "SQ-100777", "Demo-5678");
  await cameraSelfie(page, "📷 Take reference photo");
  await button(page, "Continue").click();
  await button(page, /^Protect with/).click();
  await page.getByText("Set a wallet password").waitFor();
  const pw = "correct horse battery";
  await page.locator('input[autocomplete="new-password"]').nth(0).fill(pw);
  await page.locator('input[autocomplete="new-password"]').nth(1).fill(pw);
  await button(page, "Create wallet").click();
  await page.getByText("Encrypted backup file (important)").waitFor({ timeout: 90_000 });
  await saveBackupFile(page);
  await confirmCard(page);
  await button(page, "Open my wallet").click();

  await page.locator('input[type="password"]').fill("not my password");
  await button(page, /^Unlock \(password/).click();
  await page.getByText("Wrong wallet password.").waitFor();
  await page.locator('input[type="password"]').fill(pw);
  await button(page, /^Unlock \(password/).click();
  const address = await homeAddress(page);

  await button(page, "Settings").click();
  await button(page, /Remove wallet from this device/).click();
  await button(page, "I lost my device. Recover my wallet").click();
  await bankLogin(page, "SQ-100777", "Demo-5678");
  assert.equal(await button(page, /My passkey \(synced\)/).isDisabled(), true, "no bank-held Part A for password wallets");
  await button(page, /My encrypted backup file/).click();
  await button(page, "Continue").click();
  // Upload a photo instead of using the camera.
  const shot = path.join(tmp, "upload.png");
  await page.screenshot({ path: shot });
  await page.locator('.camera-box input[type="file"]').setInputFiles(shot);
  await page.locator("img.selfie").waitFor();
  await button(page, "Start recovery").click();
  await approveKyc(context, "uploaded file, not live");
  await button(page, "Continue").click({ timeout: 90_000 });
  const oldBackup = fs.readdirSync(tmp).find((f) => f.startsWith("backup-"));
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(path.join(tmp, oldBackup));
  await page.locator('input[type="password"]').fill(pw);
  await button(page, "Open my backup").click();
  await button(page, /^Protect with/).click();
  const pw2 = "a brand new password";
  await page.locator('input[autocomplete="new-password"]').nth(0).fill(pw2);
  await page.locator('input[autocomplete="new-password"]').nth(1).fill(pw2);
  await button(page, "Finish recovery").click();
  await page.getByText("Encrypted backup file (important)").waitFor({ timeout: 90_000 });
  const newBackup = await saveBackupFile(page);
  const { cardFile } = await confirmCard(page);
  await button(page, "Open my wallet").click();
  await page.locator('input[type="password"]').fill(pw2);
  await button(page, /^Unlock \(password/).click();
  assert.equal(await homeAddress(page), address, "same wallet after recovery");
  await context.close();

  // Swissquote gone: the open-source tool signs for the wallet from backup file + paper card alone.
  const out = execFileSync(process.execPath, [path.join(root, "tools/emergency-recover.mjs"), "--card", cardFile, "--backup", newBackup, "--password", pw2], { cwd: root, encoding: "utf8" });
  assert.match(out, new RegExp(address), out);
  assert.match(out, /two parts sign together/, out);
});

test.after(() => browser.close());
