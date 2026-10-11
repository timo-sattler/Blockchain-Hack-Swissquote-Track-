// MOCK Swissquote bank backend: eBanking login, client identity, passkey verification,
// self-hosted wallet registry (Travel Rule ownership proofs), compliance, transaction approval for
// the MPC wallet, gasless stablecoin relay, recovery workflow, KYC operator console and an on-chain
// treasury. It never holds any part of the client's key: Part B lives in the separate Share Vault,
// and the bank only stores the passkey-encrypted Part A (or nothing, when the client keeps Part A
// as a password-encrypted backup file). It decides what the vault may co-sign by issuing one-time
// tickets for hashes it rebuilt itself from the payment it screened.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { DATA_DIR, getDb, getClient, save, notify, logActivity, publicClient } from "./store.mjs";
import {
  checkPassword,
  issueOtp,
  checkOtp,
  createSession,
  getSession,
  signTicket,
  revokeSessionsForCredential,
  loginLockedFor,
  recordLoginFailure,
  clearLoginFailures,
  SHOW_OTP_IN_APP,
} from "./security.mjs";
import { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication, intentHash } from "./webauthn.mjs";
import { screen, HIGH_VALUE_CHF, sanctionsHit, toChf, valueOf } from "./compliance.mjs";
import { DEMO_REQUESTS, explainCall, publicDapps } from "./dapps.mjs";
import {
  provider,
  treasury,
  withTreasury,
  balanceEth,
  relayAuthorization,
  TOKENS,
  tokenByAddress,
  RPC_URL,
  RPC_URLS,
  RPC_ALLOW,
  CHAIN_ID,
  EXPLORER,
  NETWORK,
  TREASURY_TOPUP_ENABLED,
} from "./chain.mjs";
import { ethChf, priceInfo } from "./price.mjs";

const PORT = Number(process.env.BANK_PORT || 4000);
const VAULT_URL = process.env.VAULT_URL || "http://localhost:4100";
const RECOVERY_DELAY_SECONDS = Number(process.env.RECOVERY_DELAY_SECONDS || 90); // production: 72h
const FREEZE_SECONDS = Number(process.env.FREEZE_SECONDS || 300); // production: 7 days
const RELEASE_WINDOW_MS = Number(process.env.RELEASE_WINDOW_SECONDS || 3600) * 1000; // time to finish after the share is released
const KYC_WINDOW_MS = 24 * 3600 * 1000;
const OPERATOR_PIN = process.env.KYC_OPERATOR_PIN || "kyc-demo";
const RELAY_DAILY_LIMIT = Number(process.env.RELAY_DAILY_LIMIT || 10); // sponsored transfers per client and day
const INVITE_MS = 10 * 60_000;
const MAX_PHOTO_CHARS = 1_500_000;

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/portal", express.static(path.resolve(here, "../public/portal")));
app.get("/", (_req, res) => res.redirect("/portal/"));

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const status = e.status || 400;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.shortMessage || e.message, ...(e.screening ? { screening: e.screening } : {}) });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const round8 = (n) => Math.round(n * 1e8) / 1e8;

function auth(req) {
  const s = getSession(req);
  if (!s) throw fail(401, "Your session expired. Please log in again.");
  const client = getClient(s.clientId);
  if (!client) throw fail(401, "Unknown client");
  return { s, client };
}

function photoFrom(body, field) {
  const photo = String(body[field] || "");
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw fail(400, "Please take a photo with your camera (or upload a JPEG/PNG).");
  if (photo.length > MAX_PHOTO_CHARS) throw fail(413, "That photo is too large. Please retake it.");
  return { photo, source: body.photoSource === "camera" ? "camera" : "upload" };
}

// ---------------- Recovery state ----------------
const ACTIVE = ["pending_kyc", "timelock", "released"];

// Recoveries that were never finished must not block the client forever: they expire.
function sweepRecoveries() {
  const now = Date.now();
  let changed = false;
  for (const r of Object.values(getDb().recoveries)) {
    const stale =
      (r.status === "pending_kyc" && now - Date.parse(r.createdAt) > KYC_WINDOW_MS) ||
      (r.status === "timelock" && r.unlockAt && now - r.unlockAt > RELEASE_WINDOW_MS) ||
      (r.status === "released" && r.releasedAt && now - r.releasedAt > RELEASE_WINDOW_MS);
    if (stale) {
      r.status = "expired";
      r.expiredAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) save();
}

function recoveriesOf(clientId) {
  sweepRecoveries();
  return Object.values(getDb().recoveries)
    .filter((r) => r.clientId === clientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function activeRecovery(clientId) {
  return recoveriesOf(clientId).find((r) => ACTIVE.includes(r.status));
}

function recoveryView(r) {
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    path: r.path,
    deviceLabel: r.deviceLabel,
    createdAt: r.createdAt,
    unlockAt: r.unlockAt,
    secondsLeft: r.unlockAt ? Math.max(0, Math.ceil((r.unlockAt - Date.now()) / 1000)) : null,
    kycDecision: r.kycDecision || null,
    expectedAddress: getClient(r.clientId)?.wallet?.address || null,
  };
}

// ---------------- Config ----------------
app.get("/api/public/config", (_req, res) =>
  res.json({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    rpcUrls: RPC_URLS,
    explorer: EXPLORER,
    blockscout: NETWORK.blockscout,
    network: { key: NETWORK.key, name: NETWORK.name, testnet: NETWORK.testnet, symbol: NETWORK.symbol, faucets: NETWORK.faucets },
    demoAddresses: NETWORK.demoAddresses,
    treasuryAddress: treasury.address,
    treasuryTopup: TREASURY_TOPUP_ENABLED,
    highValueChf: HIGH_VALUE_CHF,
    ethChf: ethChf(),
    price: priceInfo(),
    recoveryDelaySeconds: RECOVERY_DELAY_SECONDS,
    tokens: Object.fromEntries(Object.entries(TOKENS).map(([k, t]) => [k, { address: t.address, decimals: t.decimals, name: t.name, version: t.version, chf: t.chf }])),
    tokenFaucet: NETWORK.tokenFaucet || null,
    gasless: { available: Object.keys(TOKENS).length > 0, dailyLimit: RELAY_DAILY_LIMIT },
    dapps: publicDapps(),
    demoDappRequests: DEMO_REQUESTS,
  })
);

// The https address of `npm run tunnel`, if it is running: invite links made on localhost use it,
// since a phone can't open the computer's localhost.
app.get("/api/public/phone-url", (_req, res) => {
  let url = null;
  try {
    url = fs.readFileSync(path.join(DATA_DIR, "phone-url.txt"), "utf8").trim() || null;
  } catch {
    /* no tunnel */
  }
  res.json({ url });
});

// ---------------- Login: client ID + password + SMS OTP ----------------
app.post("/api/auth/login", wrap(async (req, res) => {
  const { clientId, password, deviceId } = req.body;
  const client = getClient(clientId);
  if (client) {
    const wait = loginLockedFor(client.id);
    if (wait) throw fail(429, `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.`);
  }
  if (!client || !checkPassword(client, password)) {
    if (client) recordLoginFailure(client.id);
    throw fail(401, "Client ID or password incorrect");
  }
  clearLoginFailures(client.id);
  const mockDelivery = issueOtp(`login:${client.id}:${deviceId}`, client, "login");
  res.json({ otpRequired: true, mockDelivery });
}));

app.post("/api/auth/otp", wrap(async (req, res) => {
  const { clientId, deviceId, code } = req.body;
  const client = getClient(clientId);
  if (!client || !checkOtp(`login:${client.id}:${deviceId}`, code)) throw fail(401, "Wrong or expired code");
  const token = createSession(client.id, "otp", deviceId);
  logActivity(client.id, "login", { method: "password+sms", deviceId });
  res.json({ token, client: publicClient(client) });
}));

// ---------------- Login: passkey (Face ID / Touch ID / Windows Hello / fingerprint) ----------------
app.post("/api/auth/passkey/options", wrap(async (req, res) => {
  const client = getClient(req.body.clientId);
  if (!client) throw fail(404, "Unknown client");
  res.json(await authenticationOptions(req, client, "login"));
}));

app.post("/api/auth/passkey/verify", wrap(async (req, res) => {
  const client = getClient(req.body.clientId);
  if (!client) throw fail(404, "Unknown client");
  const { cred } = await verifyAuthentication(req, client, req.body.response, "login");
  save();
  const token = createSession(client.id, "passkey", req.body.deviceId, { credentialId: cred.id });
  logActivity(client.id, "login", { method: "passkey", device: cred.deviceLabel });
  res.json({ token, client: publicClient(client) });
}));

app.get("/api/me", wrap(async (req, res) => {
  const { s, client } = auth(req);
  res.json({ client: publicClient(client), session: { kind: s.kind }, recovery: recoveryView(activeRecovery(client.id)) });
}));

// ---------------- Passkey registration ----------------
function mayRegisterPasskey(s, client) {
  if (!client.wallet?.activatedAt) return true;
  if (s.kind === "passkey") return true;
  const r = activeRecovery(client.id);
  return Boolean(r && r.status === "released" && r.deviceId === s.deviceId);
}

app.post("/api/passkey/register/options", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (!mayRegisterPasskey(s, client)) throw fail(403, "Adding a new passkey needs a passkey login or a completed recovery");
  res.json(await registrationOptions(req, client));
}));

app.post("/api/passkey/register/verify", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (!mayRegisterPasskey(s, client)) throw fail(403, "Not allowed");
  const rec = await verifyRegistration(req, client, req.body.response, req.body.deviceLabel);
  // Before a wallet is active, earlier passkeys on this domain are leftovers of an unfinished
  // setup: replace them so retries start clean.
  if (!client.wallet?.activatedAt) client.credentials = client.credentials.filter((k) => k === rec || k.rpID !== rec.rpID);
  save();
  notify(client.id, "New passkey added", `A passkey for "${rec.deviceLabel}" can now unlock your Swissquote Wallet.`);
  res.json({ ok: true, credentialId: rec.id, backedUp: rec.backedUp });
}));

// ---------------- MOCK KYC reference photo (stands in for the account-opening video-ident) ----------------
app.post("/api/kyc/reference-photo", wrap(async (req, res) => {
  const { client } = auth(req);
  if (client.kycPhoto) return res.json({ ok: true, alreadyOnFile: true });
  const { photo, source } = photoFrom(req.body, "photo");
  client.kycPhoto = photo;
  client.kycPhotoSource = source;
  save();
  res.json({ ok: true });
}));

// ---------------- Wallet registry & Travel Rule ownership proof ----------------
const linkMessage = (client, address, nonce) => `Swissquote Wallet ownership proof\nClient: ${client.id}\nAddress: ${address}\nChain: eip155:${CHAIN_ID}\nNonce: ${nonce}`;

app.get("/api/wallet/link-message", wrap(async (req, res) => {
  const { s, client } = auth(req);
  s.linkNonce = crypto.randomBytes(8).toString("hex");
  res.json({ template: linkMessage(client, "{ADDRESS}", s.linkNonce) });
}));

app.post("/api/wallet/link", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (client.wallet?.activatedAt) throw fail(409, "A Swissquote Wallet is already linked to this client. Use recovery instead.");
  const { address, signature, backupA } = req.body;
  if (!ethers.isAddress(address)) throw fail(400, "bad address");
  if (typeof signature !== "string") throw fail(400, "missing ownership signature");
  if (!s.linkNonce) throw fail(400, "request a link message first");
  const message = linkMessage(client, address, s.linkNonce);
  let signer;
  try {
    signer = ethers.verifyMessage(message, signature.startsWith("0x") ? signature : `0x${signature}`);
  } catch {
    throw fail(400, "ownership signature is malformed");
  }
  if (signer.toLowerCase() !== address.toLowerCase()) throw fail(400, "ownership signature does not match address");
  // The address must belong to the key whose Part B the vault holds: otherwise the vault could
  // never co-sign for it.
  const { publicKey } = await vaultKey(client.id);
  if (ethers.computeAddress(`0x${publicKey}`).toLowerCase() !== address.toLowerCase()) throw fail(400, "This address does not belong to the key created with the Share Vault");
  const backupMode = req.body.backupMode === "client-file" ? "client-file" : "bank";
  if (backupMode === "bank" && (!backupA || typeof backupA !== "object")) throw fail(400, "missing encrypted backup");
  s.linkNonce = null;
  client.wallet = {
    address: ethers.getAddress(address),
    chain: `eip155:${CHAIN_ID}`,
    linkedAt: new Date().toISOString(),
    activatedAt: null,
    backupMode,
    custody: "mpc-2of3",
    travelRule: { status: "verified-self-hosted", method: "EIP-191 signature (MPC-signed in-app, wallet-core)", message, signature, verifiedAt: new Date().toISOString() },
  };
  client.backupA = backupMode === "bank" ? { ...backupA, storedAt: new Date().toISOString() } : null;
  save();
  logActivity(client.id, "wallet-linked", { address: client.wallet.address });
  res.json({ ok: true, wallet: client.wallet });
}));

// The bank never sees the key parts, but it needs the wallet's public key to check addresses.
async function vaultKey(clientId) {
  const r = await fetch(`${VAULT_URL}/v1/keys/${encodeURIComponent(clientId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r) throw fail(503, "The Share Vault is unreachable. Try again in a moment.");
  if (!r.ok) throw fail(409, "The Share Vault holds no key for this client.");
  return r.json();
}

function mayChangeShares(s, client) {
  if (!client.wallet?.activatedAt) return true;
  const r = activeRecovery(client.id);
  return Boolean(r && r.status === "released" && r.deviceId === s.deviceId);
}

// Creates the MPC key with the vault: Part A and Part C on the device, Part B in the vault. Only
// while the client has no active wallet (a retry of an unfinished setup replaces the old key).
app.post("/api/wallet/keygen-ticket", wrap(async (req, res) => {
  const { client } = auth(req);
  if (client.wallet?.activatedAt) throw fail(409, "A Swissquote Wallet is already linked to this client. Use recovery instead.");
  res.json({ ticket: signTicket({ purpose: "keygen", clientId: client.id, exp: Date.now() + 5 * 60_000 }) });
}));

app.put("/api/wallet/backup", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (!client.wallet || !mayChangeShares(s, client)) throw fail(403, "Not allowed");
  const { backupA } = req.body;
  client.backupA = backupA && typeof backupA === "object" ? { ...backupA, storedAt: new Date().toISOString() } : null;
  client.wallet.backupMode = client.backupA ? "bank" : "client-file";
  save();
  res.json({ ok: true });
}));

// The passkey-encrypted Part A (Swissquote can't open it) plus what the vault knows about the key:
// a device that has the wallet's synced passkey restores the wallet without a recovery.
app.get("/api/wallet/backup", wrap(async (req, res) => {
  const { client } = auth(req);
  if (!client.wallet?.activatedAt) throw fail(404, "This client has no Swissquote Wallet yet.");
  if (!client.backupA) throw fail(404, "This wallet is protected with a wallet password, so Swissquote keeps no copy of Part A. Add this device from your other device (Profile → Devices → Add a device), or recover with your backup file or paper card.");
  const ticket = signTicket({ purpose: "restore", clientId: client.id, exp: Date.now() + 60_000 });
  const r = await fetch(`${VAULT_URL}/v1/keys/${encodeURIComponent(client.id)}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!r?.ok) throw fail(503, "The Share Vault is unreachable. Try again in a moment.");
  const key = await r.json();
  res.json({ backupA: client.backupA, walletAddress: client.wallet.address, name: client.name, ...key });
}));

app.post("/api/wallet/activate", wrap(async (req, res) => {
  const { client } = auth(req);
  if (!client.wallet) throw fail(400, "no wallet");
  if (!client.wallet.activatedAt) {
    client.wallet.activatedAt = new Date().toISOString();
    save();
    notify(client.id, "Swissquote Wallet created", `Your self-custody wallet ${client.wallet.address} is active and verified as yours (Travel Rule).`);
  }
  res.json({ ok: true, wallet: client.wallet });
}));

// ---------------- Compliance + transaction approval (MPC co-signing) ----------------
// Every payment needs Part B, so every payment passes here first: the bank rebuilds the exact hash
// from the transaction (or gasless authorization) itself, screens the real recipient, binds the
// result into the passkey challenge and, once approved, gives the device a one-time ticket that lets
// the vault co-sign exactly that hash.
const MAX_GAS = 500_000n;
const pendingIntents = new Map(); // intentHash -> { clientId, intent, tier, message?, exp }
const pendingRelays = new Map(); // hash -> { clientId, asset, message, exp }
const sweep = (m) => {
  for (const [k, v] of m) if (Date.now() > v.exp) m.delete(k);
};

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
const tokenDomain = (t) => ({ name: t.name, version: t.version, chainId: CHAIN_ID, verifyingContract: t.address });
const erc20 = new ethers.Interface(["function transfer(address to, uint256 amount)"]);
const big = (v, what) => {
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw fail(400, `bad ${what}`);
  }
};

// Returns { hash, to (the real recipient), amount (smallest unit) } for an EIP-1559 transfer the
// device built with Trust Wallet Core.
function txFields(tx) {
  if (!tx || typeof tx !== "object") throw fail(400, "missing transaction");
  const fields = {
    type: 2,
    chainId: CHAIN_ID,
    nonce: Number(big(tx.nonce, "nonce")),
    gasLimit: big(tx.gasLimit, "gas limit"),
    maxFeePerGas: big(tx.maxFeePerGas, "fee"),
    maxPriorityFeePerGas: big(tx.maxPriorityFeePerGas, "fee"),
    to: String(tx.to),
    value: big(tx.value ?? 0, "value"),
    data: tx.data || "0x",
  };
  if (!ethers.isAddress(fields.to)) throw fail(400, "bad recipient");
  if (fields.gasLimit > MAX_GAS) throw fail(400, "gas limit too high");
  if (!/^0x([0-9a-fA-F]{2})*$/.test(fields.data)) throw fail(400, "bad call data");
  return fields;
}

function transferIntent(client, asset, tx) {
  const fields = txFields(tx);
  let to;
  let amount;
  if (asset === "ETH") {
    if (fields.data !== "0x") throw fail(400, "an ETH transfer carries no call data");
    to = fields.to;
    amount = fields.value;
  } else {
    const t = TOKENS[asset];
    if (!t) throw fail(400, `Unsupported asset ${asset}`);
    if (fields.to.toLowerCase() !== t.address.toLowerCase() || fields.value !== 0n) throw fail(400, `not a ${asset} transfer`);
    let call;
    try {
      call = erc20.parseTransaction({ data: fields.data });
    } catch {
      call = null;
    }
    if (call?.name !== "transfer") throw fail(400, `only ${asset} transfers can be co-signed`);
    [to, amount] = call.args;
  }
  return { hash: ethers.Transaction.from(fields).unsignedHash, to: ethers.getAddress(to), amount };
}

// A call to a dApp: only approved dApps and functions, after a dry run (dapps.mjs).
async function contractIntent(client, tx) {
  const fields = txFields(tx);
  if (fields.data === "0x") throw fail(400, "not a contract call");
  const explained = await explainCall(client.wallet.address, fields);
  if (!explained.allowed) throw Object.assign(fail(403, explained.reasons.join(" ")), { explanation: explained });
  return { hash: ethers.Transaction.from(fields).unsignedHash, to: ethers.getAddress(fields.to), amount: explained.ethWei, explanation: explained };
}

function gaslessIntent(client, asset, a) {
  const t = TOKENS[asset];
  if (!t) throw fail(400, `Gasless transfers are not available for ${asset} on ${NETWORK.name}`);
  if (!a || typeof a !== "object") throw fail(400, "missing authorization");
  const now = Math.floor(Date.now() / 1000);
  const message = {
    from: client.wallet.address,
    to: String(a.to),
    value: big(a.value, "amount").toString(),
    validAfter: big(a.validAfter ?? 0, "validAfter").toString(),
    validBefore: big(a.validBefore, "validBefore").toString(),
    nonce: String(a.nonce),
  };
  if (!ethers.isAddress(message.to)) throw fail(400, "bad recipient");
  if (!/^0x[0-9a-fA-F]{64}$/.test(message.nonce)) throw fail(400, "bad nonce");
  if (BigInt(message.validAfter) > BigInt(now)) throw fail(400, "authorization not yet valid");
  if (BigInt(message.validBefore) <= BigInt(now) || BigInt(message.validBefore) > BigInt(now + 3600)) throw fail(400, "authorization must expire within the next hour");
  if (BigInt(message.value) === 0n) throw fail(400, "Enter an amount above 0");
  return { hash: ethers.TypedDataEncoder.hash(tokenDomain(t), authorizationTypes, message), to: ethers.getAddress(message.to), amount: BigInt(message.value), message };
}

function relayQuota(client) {
  const day = new Date().toISOString().slice(0, 10);
  const q = client.relayQuota?.day === day ? client.relayQuota : { day, used: 0, nonces: [] };
  return { q, remaining: Math.max(0, RELAY_DAILY_LIMIT - q.used) };
}

app.post("/api/compliance/screen", wrap(async (req, res) => {
  const { client } = auth(req);
  const asset = req.body.asset || "ETH";
  res.json(await screen(client, req.body.to, req.body.amount ?? req.body.valueWei, asset));
}));

// Before the client approves a dApp request: what it would do, in plain language, and whether
// Swissquote will co-sign it. /api/tx/prepare checks everything again.
app.post("/api/dapps/simulate", wrap(async (req, res) => {
  const { client } = auth(req);
  if (!client.wallet?.activatedAt) throw fail(400, "Create your Swissquote Wallet first");
  const to = String(req.body.to || "");
  if (!ethers.isAddress(to)) throw fail(400, "bad contract address");
  const data = String(req.body.data || "0x");
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data) || data === "0x") throw fail(400, "bad call data");
  const value = big(req.body.value ?? 0, "value");
  const explained = await explainCall(client.wallet.address, { to: ethers.getAddress(to), value, data });
  const verdict = await screen(client, to, explained.ethWei.toString(), "ETH");
  const reasons = [...explained.reasons, ...(verdict.decision === "blocked" ? verdict.reasons : [])];
  logActivity(client.id, "dapp-simulated", { to, call: explained.call, allowed: reasons.length === 0 });
  res.json({
    decision: reasons.length ? "blocked" : "ok",
    reasons,
    effects: explained.effects,
    checks: explained.checks,
    dapp: explained.dapp,
    tier: verdict.tier,
    chf: verdict.chf,
    highValueChf: HIGH_VALUE_CHF,
  });
}));

app.post("/api/tx/prepare", wrap(async (req, res) => {
  const { client } = auth(req);
  if (!client.wallet?.activatedAt) throw fail(400, "Create your Swissquote Wallet first");
  const asset = String(req.body.asset || "ETH");
  const kind = ["gasless", "contract"].includes(req.body.kind) ? req.body.kind : "transfer";
  const built =
    kind === "gasless"
      ? gaslessIntent(client, asset, req.body.authorization)
      : kind === "contract"
        ? await contractIntent(client, req.body.tx)
        : transferIntent(client, asset, req.body.tx);
  const verdict = await screen(client, built.to, built.amount.toString(), kind === "contract" ? "ETH" : asset);
  if (verdict.decision === "blocked") throw Object.assign(fail(403, verdict.reasons.join(" ")), { screening: verdict });
  if (kind === "gasless" && relayQuota(client).remaining === 0) throw fail(429, `You used today's ${RELAY_DAILY_LIMIT} free transfers. Pay the network fee yourself, or try again tomorrow.`);
  const intent = { chainId: CHAIN_ID, from: client.wallet.address, kind, asset, to: built.to, amount: built.amount.toString(), hash: built.hash };
  const options = await authenticationOptions(req, client, "sign", intent);
  const ih = intentHash(intent);
  sweep(pendingIntents);
  pendingIntents.set(ih, { clientId: client.id, intent, tier: verdict.tier, message: built.message, exp: Date.now() + 5 * 60_000 });
  const what = `${verdict.units} ${asset} (CHF ${verdict.chf}) to ${built.to.slice(0, 8)}…`;
  const mockDelivery = verdict.tier === "high-value" ? issueOtp(`sign:${client.id}:${ih}`, client, `approving ${what}`) : null;
  res.json({ options, intent, screening: verdict, otpRequired: Boolean(mockDelivery), mockDelivery });
}));

// The passkey signed the intent (amount, recipient, hash); high-value payments also need the SMS code.
app.post("/api/tx/approve", wrap(async (req, res) => {
  const { client } = auth(req);
  const { intentHash: signed, cred } = await verifyAuthentication(req, client, req.body.response, "sign");
  save();
  const pending = pendingIntents.get(signed);
  if (!pending || pending.clientId !== client.id || Date.now() > pending.exp) throw fail(403, "This approval expired. Review the payment again.");
  if (pending.tier === "high-value" && !checkOtp(`sign:${client.id}:${signed}`, req.body.otp)) throw fail(403, "Wrong or expired SMS code");
  pendingIntents.delete(signed);
  const { intent } = pending;
  if (intent.kind === "gasless") {
    sweep(pendingRelays);
    pendingRelays.set(intent.hash.toLowerCase(), { clientId: client.id, asset: intent.asset, message: pending.message, tier: pending.tier, exp: Date.now() + 10 * 60_000 });
  }
  const ticket = signTicket({
    purpose: "sign",
    clientId: client.id,
    hash: Buffer.from(ethers.getBytes(intent.hash)).toString("base64url"),
    version: Number(req.body.version) || undefined,
    what: intent.kind,
    exp: Date.now() + 2 * 60_000,
  });
  logActivity(client.id, "tx-approved", { kind: intent.kind, asset: intent.asset, to: intent.to, amount: intent.amount, device: cred.deviceLabel });
  res.json({ ticket, intent });
}));

const NO_FUEL = "Free transfers are unavailable right now: Swissquote's fee account is empty. Pay the network fee yourself instead.";
const treasuryFunded = async () => (await provider.getBalance(treasury.address).catch(() => null)) !== 0n;

// Asked before the client approves a free transfer, so an empty fee account shows up front.
app.get("/api/relay/status", wrap(async (req, res) => {
  const { client } = auth(req);
  res.json({ dailyLimit: RELAY_DAILY_LIMIT, remaining: relayQuota(client).remaining, funded: await treasuryFunded(), message: NO_FUEL });
}));

// Gasless: the device co-signed the authorization with the vault; Swissquote's treasury submits it
// and pays the fee. Only the exact authorization approved above is relayed.
app.post("/api/relay", wrap(async (req, res) => {
  const { client } = auth(req);
  const key = String(req.body.hash || "").toLowerCase();
  const pending = pendingRelays.get(key);
  if (!pending || pending.clientId !== client.id || Date.now() > pending.exp) throw fail(403, "No approved gasless transfer matches this signature.");
  const t = TOKENS[pending.asset];
  let signer;
  try {
    signer = ethers.verifyTypedData(tokenDomain(t), authorizationTypes, pending.message, req.body.signature);
  } catch {
    throw fail(400, "malformed signature");
  }
  if (signer.toLowerCase() !== client.wallet.address.toLowerCase()) throw fail(400, "The signature is not from your wallet.");
  // Reserve before the network call: a timeout after broadcast doesn't prove no gas was spent.
  const { q, remaining } = relayQuota(client);
  if (remaining === 0) throw fail(429, `You used today's ${RELAY_DAILY_LIMIT} free transfers.`);
  if (q.nonces.includes(pending.message.nonce.toLowerCase())) throw fail(409, "This transfer was already submitted.");
  if (!(await treasuryFunded())) throw fail(503, NO_FUEL);
  q.used++;
  q.nonces.push(pending.message.nonce.toLowerCase());
  client.relayQuota = q;
  pendingRelays.delete(key);
  save();
  let hash;
  try {
    hash = await relayAuthorization(t.address, pending.message, req.body.signature);
  } catch (e) {
    const why = e.shortMessage || e.reason || e.message;
    throw fail(502, /balance/i.test(why) ? `Not enough ${pending.asset} in your wallet.` : `The network refused the sponsored transfer: ${why}`);
  }
  const value = valueOf(pending.asset, pending.message.value);
  logActivity(client.id, "wallet-tx", { hash, to: pending.message.to, asset: pending.asset, amount: pending.message.value, units: value.units, chf: value.chf, sponsored: true, tier: pending.tier, explorer: `${EXPLORER}/tx/${hash}` });
  console.log(`[bank] relayed gasless ${value.units} ${pending.asset} for ${client.id}: ${hash}`);
  res.json({ hash, explorer: `${EXPLORER}/tx/${hash}`, remaining: RELAY_DAILY_LIMIT - q.used });
}));

app.post("/api/tx/report", wrap(async (req, res) => {
  const { client } = auth(req);
  const { hash, to, tier } = req.body;
  const asset = TOKENS[req.body.asset] ? req.body.asset : "ETH";
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) throw fail(400, "bad transaction hash");
  if (!ethers.isAddress(to)) throw fail(400, "bad recipient");
  let amount;
  try {
    amount = BigInt(req.body.amount ?? req.body.valueWei);
  } catch {
    throw fail(400, "bad amount");
  }
  const dup = getDb().activity.some((a) => a.clientId === client.id && a.type === "wallet-tx" && a.hash?.toLowerCase() === hash.toLowerCase());
  if (dup) return res.json({ ok: true, duplicate: true });
  const value = valueOf(asset, amount);
  const entry = { hash, to, asset, amount: amount.toString(), units: value.units, chf: value.chf, tier: tier === "high-value" ? "high-value" : "standard", explorer: `${EXPLORER}/tx/${hash}` };
  if (asset === "ETH") {
    entry.valueWei = amount.toString();
    entry.eth = value.units;
    if (to.toLowerCase() === treasury.address.toLowerCase()) entry.depositPending = true;
  }
  logActivity(client.id, "wallet-tx", entry);
  res.json({ ok: true });
}));

// Read-only + broadcast JSON-RPC relay (the app can also talk to any public RPC directly).
app.post("/api/rpc", wrap(async (req, res) => {
  const { method, params = [] } = req.body;
  if (!RPC_ALLOW.has(method)) throw fail(403, `method ${method} not allowed`);
  res.json({ result: await provider.send(method, params) });
}));

app.get("/api/notifications", wrap(async (req, res) => {
  const { client } = auth(req);
  res.json({ notifications: getDb().notifications.filter((n) => n.clientId === client.id).slice(0, 30) });
}));

// ---------------- Recovery ----------------
app.post("/api/recovery/start", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (!client.wallet?.activatedAt) throw fail(400, "No active wallet to recover");
  if (client.recoveryFrozenUntil > Date.now()) throw fail(423, `Recovery is frozen after a fraud report until ${new Date(client.recoveryFrozenUntil).toLocaleString("de-CH")}. Call Swissquote support.`);
  const open = activeRecovery(client.id);
  if (open) {
    const at = (t) => new Date(t).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    const ends = open.status === "pending_kyc" ? Date.parse(open.createdAt) + KYC_WINDOW_MS : (open.releasedAt || open.unlockAt) + RELEASE_WINDOW_MS;
    throw fail(
      409,
      `A recovery started on "${open.deviceLabel}" at ${at(open.createdAt)} is still open. Finish it on that device, or close it there ("Start a new recovery") or ` +
        `on a device that still has the wallet (Home → "It was me, discard it"), or ask Swissquote support to close it. Otherwise it expires at ${at(ends)}.`
    );
  }
  const { photo, source } = photoFrom({ selfie: req.body.selfie, photoSource: req.body.selfieSource }, "selfie");
  const r = {
    id: crypto.randomUUID(),
    clientId: client.id,
    deviceId: s.deviceId,
    deviceLabel: String(req.body.deviceLabel || "Unknown device").slice(0, 80),
    path: ["paper", "file"].includes(req.body.path) ? req.body.path : "passkey",
    selfie: photo,
    selfieSource: source,
    status: "pending_kyc",
    createdAt: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  };
  getDb().recoveries[r.id] = r;
  save();
  notify(client.id, "⚠️ Wallet recovery requested", `Someone started recovering your Swissquote Wallet from "${r.deviceLabel}". If this was not you, cancel it now in eBanking or on your current device.`, { recoveryId: r.id, actionable: true });
  logActivity(client.id, "recovery-started", { recoveryId: r.id, device: r.deviceLabel, path: r.path });
  res.json({ recovery: recoveryView(r) });
}));

app.get("/api/recovery/current", wrap(async (req, res) => {
  const { s, client } = auth(req);
  const mine = recoveriesOf(client.id).find((r) => r.deviceId === s.deviceId);
  res.json({ recovery: recoveryView(mine) });
}));

app.get("/api/recovery/all", wrap(async (req, res) => {
  const { client } = auth(req);
  res.json({ recoveries: recoveriesOf(client.id).map(recoveryView) });
}));

async function freezeInVault(clientId, until) {
  try {
    await fetch(`${VAULT_URL}/v1/freeze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: signTicket({ purpose: "freeze", clientId, until, exp: Date.now() + 60_000 }) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[bank] could not reach vault for freeze:", e.message);
  }
}

// "That wasn't me": the account owner stops someone else's recovery and freezes new ones.
app.post("/api/recovery/:id/cancel", wrap(async (req, res) => {
  const { client } = auth(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || r.clientId !== client.id) throw fail(404, "Recovery not found");
  if (!ACTIVE.includes(r.status)) throw fail(409, `Recovery is already ${r.status}`);
  r.status = "cancelled";
  r.cancelledAt = new Date().toISOString();
  client.recoveryFrozenUntil = Date.now() + FREEZE_SECONDS * 1000;
  save();
  await freezeInVault(client.id, client.recoveryFrozenUntil);
  notify(client.id, "Recovery cancelled", `You cancelled the recovery from "${r.deviceLabel}". New recoveries are frozen until ${new Date(client.recoveryFrozenUntil).toLocaleString("de-CH")}.`);
  logActivity(client.id, "recovery-cancelled", { recoveryId: r.id });
  res.json({ recovery: recoveryView(r) });
}));

// The device that started a recovery can give up on it (no freeze), e.g. to choose another path.
// So can the owner on a device that still has the wallet (logged in with its passkey), when the
// recovery was their own and got stuck.
app.post("/api/recovery/:id/abandon", wrap(async (req, res) => {
  const { s, client } = auth(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || r.clientId !== client.id || (r.deviceId !== s.deviceId && s.kind !== "passkey")) throw fail(404, "Recovery not found for this device");
  if (!ACTIVE.includes(r.status)) throw fail(409, `Recovery is already ${r.status}`);
  r.status = "abandoned";
  r.abandonedAt = new Date().toISOString();
  save();
  logActivity(client.id, "recovery-abandoned", { recoveryId: r.id });
  res.json({ recovery: recoveryView(r) });
}));

// After KYC and the time-lock: a one-time ticket that lets the vault refresh all three key parts
// with this device. The vault checks the time-lock and any fraud freeze again with its own clock.
app.post("/api/recovery/:id/recover-ticket", wrap(async (req, res) => {
  const { s, client } = auth(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || r.clientId !== client.id || r.deviceId !== s.deviceId) throw fail(404, "Recovery not found for this device");
  if (r.status === "pending_kyc") throw fail(403, "Waiting for identity verification");
  if (r.status !== "timelock" && r.status !== "released") throw fail(403, `Recovery is ${r.status}`);
  if (Date.now() < r.unlockAt) throw fail(403, `Security delay: ${Math.ceil((r.unlockAt - Date.now()) / 1000)}s left`);
  if (r.status !== "released") {
    r.status = "released";
    r.releasedAt = Date.now();
    save();
  }
  res.json({ ticket: signTicket({ purpose: "recover", clientId: client.id, recoveryId: r.id, notBefore: r.unlockAt, exp: Date.now() + 5 * 60_000 }) });
}));

app.post("/api/recovery/:id/complete", wrap(async (req, res) => {
  const { s, client } = auth(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || r.clientId !== client.id || r.deviceId !== s.deviceId || r.status !== "released") throw fail(404, "No released recovery");
  if (String(req.body.address).toLowerCase() !== client.wallet.address.toLowerCase()) throw fail(400, "Recovered address does not match the wallet on file");
  const { publicKey } = await vaultKey(client.id);
  if (ethers.computeAddress(`0x${publicKey}`).toLowerCase() !== client.wallet.address.toLowerCase()) throw fail(409, "The vault's key no longer matches this wallet");
  r.status = "completed";
  r.completedAt = new Date().toISOString();
  // The recovered device got a fresh passkey. Older passkeys may sit on the lost device, so they
  // can no longer log in to Swissquote or approve high-value payments.
  const revoked = [];
  for (const k of client.credentials) {
    if (!k.revoked && Date.parse(k.createdAt) < Date.parse(r.createdAt)) {
      k.revoked = true;
      k.revokedAt = r.completedAt;
      revokeSessionsForCredential(k.id);
      revoked.push(k.deviceLabel);
    }
  }
  save();
  notify(
    client.id,
    "Wallet recovered",
    `Your Swissquote Wallet was recovered on "${r.deviceLabel}". All key parts were refreshed: old devices and your old Recovery Card no longer work with Swissquote.${revoked.length ? ` Older passkeys (${revoked.join(", ")}) were revoked.` : ""}`
  );
  logActivity(client.id, "recovery-completed", { recoveryId: r.id, device: r.deviceLabel });
  res.json({ ok: true });
}));

// ---------------- MOCK video-ident / KYC operator console ----------------
const operatorTokens = new Set();
function operator(req) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  if (!operatorTokens.has(t)) throw fail(401, "operator login required");
}

app.post("/api/operator/login", wrap(async (req, res) => {
  if (req.body.pin !== OPERATOR_PIN) throw fail(401, "wrong PIN");
  const t = crypto.randomBytes(16).toString("hex");
  operatorTokens.add(t);
  res.json({ token: t });
}));

app.get("/api/operator/recoveries", wrap(async (req, res) => {
  operator(req);
  sweepRecoveries();
  const list = Object.values(getDb().recoveries)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((r) => {
      const c = getClient(r.clientId);
      return {
        ...recoveryView(r),
        clientId: r.clientId,
        clientName: c?.name,
        kycPhoto: c?.kycPhoto,
        kycPhotoSource: c?.kycPhotoSource || null,
        selfie: r.selfie,
        selfieSource: r.selfieSource || null,
        ip: r.ip,
        frozenUntil: c?.recoveryFrozenUntil,
      };
    });
  res.json({ recoveries: list });
}));

app.post("/api/operator/recoveries/:id/decision", wrap(async (req, res) => {
  operator(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || r.status !== "pending_kyc") throw fail(409, "Not awaiting identity verification");
  const approve = req.body.decision === "approve";
  r.kycDecision = { decision: approve ? "approved" : "rejected", note: String(req.body.note || "").slice(0, 200), at: new Date().toISOString() };
  if (approve) {
    r.status = "timelock";
    r.unlockAt = Date.now() + RECOVERY_DELAY_SECONDS * 1000;
    notify(r.clientId, "Recovery identity check passed", `The recovery from "${r.deviceLabel}" passed identity verification. Swissquote releases its share in ${RECOVERY_DELAY_SECONDS}s unless you cancel.`, { recoveryId: r.id, actionable: true });
  } else {
    r.status = "rejected";
    notify(r.clientId, "Recovery refused", `A recovery attempt from "${r.deviceLabel}" was refused: the person did not match your identity documents.`);
  }
  save();
  logActivity(r.clientId, `recovery-kyc-${r.kycDecision.decision}`, { recoveryId: r.id });
  res.json({ recovery: recoveryView(r) });
}));

// The client called support: close an open recovery that got stuck (for example the device that
// started it was reset). No freeze, the client can start a new recovery right away.
app.post("/api/operator/recoveries/:id/close", wrap(async (req, res) => {
  operator(req);
  sweepRecoveries();
  const r = getDb().recoveries[req.params.id];
  if (!r || !ACTIVE.includes(r.status)) throw fail(409, "This recovery is not open");
  r.status = "abandoned";
  r.abandonedAt = new Date().toISOString();
  save();
  notify(r.clientId, "Recovery closed by Swissquote", `Swissquote support closed the open recovery from "${r.deviceLabel}" at your request. You can start a new one.`);
  logActivity(r.clientId, "recovery-closed-by-operator", { recoveryId: r.id });
  res.json({ recovery: recoveryView(r) });
}));

app.post("/api/operator/clients/:id/unfreeze", wrap(async (req, res) => {
  operator(req);
  const c = getClient(req.params.id);
  if (!c) throw fail(404, "unknown client");
  c.recoveryFrozenUntil = 0;
  save();
  await freezeInVault(c.id, 0);
  res.json({ ok: true });
}));

app.get("/api/operator/vault-audit", wrap(async (req, res) => {
  operator(req);
  const r = await fetch(`${VAULT_URL}/v1/audit`, { signal: AbortSignal.timeout(5000) })
    .then((x) => x.json())
    .catch(() => ({ audit: [], error: "vault unreachable" }));
  res.json(r);
}));

// ---------------- eBanking portal ----------------
// Credits ETH that the client sent from their verified wallet to the bank treasury. Every claim
// is checked on-chain (sender, recipient, status) and each transaction is credited only once.
async function settleDeposits(client) {
  const pending = getDb().activity.filter((x) => x.clientId === client.id && x.depositPending);
  if (!pending.length) return;
  let changed = false;
  for (const a of pending) {
    const [tx, rcpt] = await Promise.all([provider.getTransaction(a.hash).catch(() => null), provider.getTransactionReceipt(a.hash).catch(() => null)]);
    if (!tx || !rcpt) {
      if (Date.now() - Date.parse(a.at) > 24 * 3600 * 1000) {
        a.depositPending = false;
        a.depositFailed = true;
        changed = true;
      }
      continue;
    }
    a.depositPending = false;
    changed = true;
    const already = getDb().activity.some((x) => x !== a && x.depositCredited && x.hash?.toLowerCase() === a.hash.toLowerCase());
    const genuine =
      rcpt.status === 1 &&
      tx.from.toLowerCase() === client.wallet?.address.toLowerCase() &&
      tx.to?.toLowerCase() === treasury.address.toLowerCase() &&
      tx.value > 0n;
    if (genuine && !already) {
      const eth = Number(ethers.formatEther(tx.value));
      client.accounts.ethCustody = round8(client.accounts.ethCustody + eth);
      a.eth = eth;
      a.depositCredited = true;
      notify(client.id, "Deposit credited", `${eth} ETH from your verified Swissquote Wallet was credited to your account.`);
    } else {
      a.depositFailed = true;
    }
  }
  if (changed) save();
}

app.get("/api/bank/overview", wrap(async (req, res) => {
  const { client } = auth(req);
  if (client.wallet) await settleDeposits(client).catch((e) => console.error("[bank] settle deposits:", e.message));
  const [walletBalance, treasuryBalance] = await Promise.all([
    client.wallet ? balanceEth(client.wallet.address).catch(() => null) : null,
    balanceEth(treasury.address).catch(() => null),
  ]);
  res.json({
    client: publicClient(client),
    walletBalance,
    treasury: { address: treasury.address, balance: treasuryBalance, topupEnabled: TREASURY_TOPUP_ENABLED },
    activity: getDb().activity.filter((a) => a.clientId === client.id).slice(0, 25),
    recoveries: recoveriesOf(client.id).slice(0, 10).map(recoveryView),
    notifications: getDb().notifications.filter((n) => n.clientId === client.id).slice(0, 20),
    explorer: EXPLORER,
    network: { name: NETWORK.name, testnet: NETWORK.testnet },
    ethChf: ethChf(),
  });
}));

app.post("/api/bank/withdraw", wrap(async (req, res) => {
  const { client } = auth(req);
  if (!TREASURY_TOPUP_ENABLED) throw fail(403, `Top-ups from the bank treasury are switched off on ${NETWORK.name}. Send ETH to your wallet address instead (Receive).`);
  if (!client.wallet?.activatedAt) throw fail(400, "Create your Swissquote Wallet first");
  if (sanctionsHit(client.wallet.address)) throw fail(403, "blocked");
  const amountStr = String(req.body.amountEth ?? "").trim().replace(",", ".");
  if (!/^\d*\.?\d+$/.test(amountStr)) throw fail(400, "Enter an amount like 0.002");
  let value;
  try {
    value = ethers.parseEther(amountStr);
  } catch {
    throw fail(400, "Use at most 18 decimals");
  }
  const amount = Number(amountStr);
  if (value <= 0n) throw fail(400, "Enter an amount above 0");
  if (amount > client.accounts.ethCustody + 1e-12) throw fail(400, `You only hold ${client.accounts.ethCustody} ETH at Swissquote`);

  // Reserve first so two quick clicks can't spend the same balance twice.
  client.accounts.ethCustody = round8(client.accounts.ethCustody - amount);
  save();
  let tx;
  try {
    tx = await withTreasury(async () => {
      const tBal = await provider.getBalance(treasury.address);
      if (tBal < value + ethers.parseEther("0.0005")) {
        throw fail(503, `The bank treasury on ${NETWORK.name} is not funded yet. Send ${NETWORK.testnet ? "test ETH from a faucet" : "ETH"} to ${treasury.address}.`);
      }
      return treasury.sendTransaction({ to: client.wallet.address, value });
    });
  } catch (e) {
    client.accounts.ethCustody = round8(client.accounts.ethCustody + amount);
    save();
    throw e.status ? e : fail(502, `The network refused the transfer: ${e.shortMessage || e.message}`);
  }
  logActivity(client.id, "bank-withdrawal", { hash: tx.hash, eth: amount, to: client.wallet.address, explorer: `${EXPLORER}/tx/${tx.hash}`, travelRule: "Destination is a self-hosted wallet with an ownership proof on file (FINMA Guidance 02/2019)" });
  notify(client.id, "Transfer to your wallet sent", `${amount} ETH is on its way to your Swissquote Wallet. Tx ${tx.hash.slice(0, 12)}…`);
  res.json({ hash: tx.hash, explorer: `${EXPLORER}/tx/${tx.hash}` });
}));

app.post("/api/devices/:credId/report-lost", wrap(async (req, res) => {
  const { client } = auth(req);
  const cred = client.credentials.find((k) => k.id === req.params.credId);
  if (!cred) throw fail(404, "Unknown device");
  cred.revoked = true;
  cred.revokedAt = new Date().toISOString();
  revokeSessionsForCredential(cred.id);
  save();
  notify(client.id, "Device reported lost", `"${cred.deviceLabel}" can no longer log in to Swissquote or approve any payment, so its copy of Part A is useless.`);
  res.json({ ok: true });
}));

// ---------------- More devices: identical copies of Part A ----------------
// A device that is unlocked with its passkey encrypts Part A with a one-time key that travels only in
// the invite link's URL fragment (never sent to a server), so Swissquote relays a copy it cannot read.
const invites = new Map(); // token -> { clientId, sealedShare, encC, version, publicKey, exp, by }

app.post("/api/devices/invite", wrap(async (req, res) => {
  const { s, client } = auth(req);
  if (s.kind !== "passkey") throw fail(403, "Unlock with your passkey on a device that already has the wallet to add another device.");
  if (!client.wallet?.activatedAt) throw fail(400, "No active wallet");
  const { sealedShare, encC, version, publicKey } = req.body;
  if (typeof sealedShare !== "string" || sealedShare.length > 2_000_000) throw fail(400, "bad sealed share");
  for (const [k, v] of invites) if (Date.now() > v.exp || v.clientId === client.id) invites.delete(k);
  const token = crypto.randomUUID();
  const exp = Date.now() + INVITE_MS;
  invites.set(token, { clientId: client.id, sealedShare, encC: encC ?? null, version: Number(version) || null, publicKey: String(publicKey || ""), exp, by: s.credentialId });
  logActivity(client.id, "device-invite", {});
  res.json({ inviteToken: token, expires: exp });
}));

function mustInvite(client, token) {
  const inv = invites.get(String(token || ""));
  if (!inv || inv.clientId !== client.id || Date.now() > inv.exp) throw fail(403, "This invite link expired or was already used. Create a new one on your other device.");
  return inv;
}

// The new device logged in with password + SMS, then registers its own passkey with the invite.
app.post("/api/devices/join/options", wrap(async (req, res) => {
  const { client } = auth(req);
  mustInvite(client, req.body.inviteToken);
  res.json(await registrationOptions(req, client));
}));

app.post("/api/devices/join/verify", wrap(async (req, res) => {
  const { s, client } = auth(req);
  const inv = mustInvite(client, req.body.inviteToken);
  const rec = await verifyRegistration(req, client, req.body.response, req.body.deviceLabel);
  invites.delete(String(req.body.inviteToken));
  s.credentialId = rec.id;
  s.kind = "passkey";
  save();
  notify(client.id, "New device added", `"${rec.deviceLabel}" now holds a copy of your wallet's Part A and can approve payments with its own passkey.`);
  res.json({ credentialId: rec.id, sealedShare: inv.sealedShare, encC: inv.encC, version: inv.version, publicKey: inv.publicKey, wallet: client.wallet });
}));

// MOCK SMS/e-mail/push gateway inbox (demo only). With DEMO_SHOW_OTP=0 the codes are redacted.
app.get("/api/mock/outbox", (_req, res) => {
  const outbox = getDb().outbox.slice(0, 60);
  res.json({ outbox: SHOW_OTP_IN_APP ? outbox : outbox.map((m) => ({ ...m, text: m.text.replace(/\b\d{6}\b/g, "••••••") })) });
});

const server = app.listen(PORT, async () => {
  console.log(`[bank] MOCK Swissquote bank on http://localhost:${PORT}  (portal: /portal/)`);
  console.log(`[bank] Network: ${NETWORK.name} (chain ${CHAIN_ID}) via ${RPC_URL}`);
  if (!NETWORK.testnet) console.log("[bank] ⚠️  MAINNET: wallets hold real ETH. Treasury top-ups are " + (TREASURY_TOPUP_ENABLED ? "ENABLED" : "disabled"));
  console.log(`[bank] Treasury hot wallet ${treasury.address} (fund it to enable bank->wallet transfers)`);
  const bal = await balanceEth(treasury.address).catch((e) => `unavailable (${e.shortMessage || e.message})`);
  console.log(`[bank] Treasury balance: ${bal} ETH`);
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[bank] Port ${PORT} is already in use. Another copy of the demo is probably still running: stop it (Ctrl+C in its window) or start this one with BANK_PORT=<other port>.`);
    process.exit(1);
  }
  throw e;
});
