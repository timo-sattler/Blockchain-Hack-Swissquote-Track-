// End-to-end API test against the running demo (npm run demo). Plays the wallet app's part in Node:
// a software passkey authenticator instead of Face ID (Node has no PRF, so Part A stays in memory),
// the real DKLs23 MPC library for the device's parts, the real Trust Wallet Core for transactions,
// and real Sepolia RPC. A short RECOVERY_DELAY_SECONDS (npm run demo:fast) makes it much faster.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import wc from "@trustwallet/wallet-core";
import { ethers } from "ethers";
import { softAuthenticator } from "./lib/soft-authenticator.mjs";
import {
  KeygenSession,
  Keyshare,
  SignSession,
  PART_A,
  PART_B,
  PART_C,
  addressOf,
  b64,
  core,
  finishSignature,
  forParty,
  fromWire,
  hex,
  openPartC,
  others,
  sealPartAWithPassword,
  sealPartC,
  signTogether,
  toWire,
  unb64,
  wordsOfCardKey,
} from "../tools/lib/mpc-offline.mjs";

const BANK = process.env.BANK_URL || "http://localhost:4000";
const VAULT = process.env.VAULT_URL || "http://localhost:4100";
const ORIGIN = process.env.APP_URL || "http://localhost:5173"; // passkeys are bound to the app's origin
const CLIENT = "SQ-100777"; // Marco: the test uses this client so it doesn't disturb Anna's demo wallet
const PASSWORD = "Demo-5678";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const SANCTIONED = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { TransactionCompiler, CoinType, DataVector, HexCoding, PublicKey, PublicKeyType } = await core();
const P = wc.TW.Ethereum.Proto;
const provider = new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });

async function call(base, p, { method = "GET", body, token } = {}) {
  const r = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

async function login(deviceId) {
  const a = await call(BANK, "/api/auth/login", { method: "POST", body: { clientId: CLIENT, password: PASSWORD, deviceId } });
  assert.ok(a.mockDelivery?.code, "OTP delivered (mock SMS)");
  const b = await call(BANK, "/api/auth/otp", { method: "POST", body: { clientId: CLIENT, deviceId, code: a.mockDelivery.code } });
  assert.ok(b.token, "logged in");
  return b;
}

async function passkeyLogin(auth, deviceId) {
  const options = await call(BANK, "/api/auth/passkey/options", { method: "POST", body: { clientId: CLIENT } });
  const r = await call(BANK, "/api/auth/passkey/verify", { method: "POST", body: { clientId: CLIENT, deviceId, response: auth.assert(options) } });
  assert.ok(r.token, `passkey login: ${r.error ?? ""}`);
  return r;
}

let operatorToken;
async function operator(p, body) {
  if (!operatorToken) operatorToken = (await call(BANK, "/api/operator/login", { method: "POST", body: { pin: "kyc-demo" } })).token;
  return call(BANK, p, { method: body ? "POST" : "GET", body, token: operatorToken });
}

// ---------------- The device's side of the MPC protocol (as wallet-app/src/lib/mpc.ts) ----------------
const mpc = async (sid, body) => {
  const r = await call(VAULT, `/v1/mpc/${sid}`, { method: "POST", body });
  if (r.status !== 200) throw new Error(`vault: ${r.error}`);
  return r;
};

async function runKeygen(start, a, c, sealC) {
  const sid = start.sessionId;
  const handle = (s, msgs, commitments) => s.handleMessages(msgs, commitments).map(toWire);
  const msg1 = [toWire(a.createFirstMessage()), toWire(c.createFirstMessage()), ...start.messages];
  const msg2Local = [...handle(a, others(msg1, PART_A)), ...handle(c, others(msg1, PART_C))];
  const r1 = await mpc(sid, { messages: msg1.filter((m) => m.from !== PART_B) });
  const commitments = [a.calculateChainCodeCommitment(), unb64(r1.commitment), c.calculateChainCodeCommitment()];
  const msg2 = [...msg2Local, ...r1.messages];
  const msg3Local = [...handle(a, forParty(msg2, PART_A)), ...handle(c, forParty(msg2, PART_C))];
  const r2 = await mpc(sid, { messages: msg2.filter((m) => m.to === PART_B) });
  const msg3 = [...msg3Local, ...r2.messages];
  const msg4Local = [...handle(a, forParty(msg3, PART_A), commitments), ...handle(c, forParty(msg3, PART_C), commitments)];
  const r3 = await mpc(sid, { messages: msg3.filter((m) => m.to === PART_B), commitments: commitments.map(b64) });
  const msg4 = [...msg4Local, ...r3.messages];
  handle(a, others(msg4, PART_A));
  handle(c, others(msg4, PART_C));
  const shareA = a.keyshare(); // keyshare() consumes the session: call it once
  const parts = { a: shareA.toBytes(), c: c.keyshare().toBytes(), publicKey: new Uint8Array(shareA.publicKey) };
  const done = await mpc(sid, { messages: msg4Local, encC: sealC(parts.c, parts.publicKey) });
  assert.equal(done.publicKey, hex(parts.publicKey), "vault ends up with the same public key");
  return { ...parts, version: done.version };
}

async function vaultSign(partA, ticket, expected) {
  const start = await call(VAULT, "/v1/sign/start", { method: "POST", body: { ticket } });
  if (start.status !== 200) throw new Error(`vault: ${start.error}`);
  const hash = unb64(start.hash);
  assert.equal(hex(hash), hex(expected), "vault signs the hash the device built");
  const me = new SignSession(Keyshare.fromBytes(partA), "m");
  const m1 = toWire(me.createFirstMessage());
  const msg2 = me.handleMessages(start.messages.map(fromWire)).map(toWire);
  const r1 = await mpc(start.sessionId, { messages: [m1] });
  const msg3 = me.handleMessages(forParty(r1.messages, PART_A)).map(toWire);
  const r2 = await mpc(start.sessionId, { messages: msg2 });
  me.handleMessages(forParty(r2.messages, PART_A));
  const r3 = await mpc(start.sessionId, { messages: msg3 });
  me.lastMessage(hash).free();
  const [r, s] = me.combine(r3.messages.map(fromWire));
  return { r: new Uint8Array(r), s: new Uint8Array(s) };
}

// ---------------- Transactions with Trust Wallet Core ----------------
const be = (n) => {
  let h = BigInt(n).toString(16);
  if (h.length % 2) h = "0" + h;
  return HexCoding.decode(h);
};

function ethInput(tx) {
  return P.SigningInput.encode(
    P.SigningInput.create({
      chainId: be(11155111),
      nonce: be(tx.nonce),
      txMode: P.TransactionMode.Enveloped,
      gasLimit: be(tx.gasLimit),
      maxInclusionFeePerGas: be(tx.tip),
      maxFeePerGas: be(tx.maxFee),
      toAddress: tx.token ?? tx.to,
      transaction: P.Transaction.create(
        tx.data
          ? { contractGeneric: P.Transaction.ContractGeneric.create({ amount: be(tx.amount), data: ethers.getBytes(tx.data) }) }
          : tx.token
            ? { erc20Transfer: P.Transaction.ERC20Transfer.create({ to: tx.to, amount: be(tx.amount) }) }
            : { transfer: P.Transaction.Transfer.create({ amount: be(tx.amount) }) }
      ),
    })
  ).finish();
}
const preImage = (input) => new Uint8Array(wc.TW.TxCompiler.Proto.PreSigningOutput.decode(TransactionCompiler.preImageHashes(CoinType.ethereum, input)).dataHash);
function compile(input, full, publicKey) {
  const pk = PublicKey.createWithData(publicKey, PublicKeyType.secp256k1);
  const sigs = DataVector.create();
  const pubs = DataVector.create();
  sigs.add(full);
  pubs.add(pk.uncompressed().data());
  return ethers.hexlify(P.SigningOutput.decode(TransactionCompiler.compileWithSignatures(CoinType.ethereum, input, sigs, pubs)).encoded);
}
const erc20 = new ethers.Interface(["function transfer(address to, uint256 amount)"]);
const forBank = (tx) => ({
  nonce: String(tx.nonce),
  gasLimit: String(tx.gasLimit),
  maxFeePerGas: String(tx.maxFee),
  maxPriorityFeePerGas: String(tx.tip),
  to: tx.token ?? tx.to,
  value: tx.token ? "0" : String(tx.amount),
  data: tx.data ?? (tx.token ? erc20.encodeFunctionData("transfer", [tx.to, tx.amount]) : "0x"),
});
const fees = { nonce: 0, gasLimit: 21000n, tip: 1_500_000_000n, maxFee: 40_000_000_000n };

// prepare -> passkey -> approve -> ticket (the bank's side of every payment)
async function approve(token, auth, body, { otp, version } = {}) {
  const prep = await call(BANK, "/api/tx/prepare", { method: "POST", token, body });
  if (prep.status !== 200) return { prep };
  const response = auth.assert(prep.options);
  const code = otp === true ? prep.mockDelivery?.code : otp;
  const ok = await call(BANK, "/api/tx/approve", { method: "POST", token, body: { response, otp: code, version } });
  return { prep, ok };
}

const state = {};

test("wrong password and wrong OTP are refused", async () => {
  const r = await call(BANK, "/api/auth/login", { method: "POST", body: { clientId: CLIENT, password: "nope", deviceId: "x" } });
  assert.equal(r.status, 401);
  await call(BANK, "/api/auth/login", { method: "POST", body: { clientId: CLIENT, password: PASSWORD, deviceId: "y" } });
  const o = await call(BANK, "/api/auth/otp", { method: "POST", body: { clientId: CLIENT, deviceId: "y", code: "000000" } });
  assert.equal(o.status, 401);
});

test("create wallet: MPC key in three parts with the vault, ownership proof signed by A + C", async (t) => {
  const s = await login("phone-1");
  if (s.client.wallet?.activatedAt) {
    t.skip("client already has a wallet (run `npm run reset` for a clean run)");
    state.skip = true;
    return;
  }
  state.auth1 = softAuthenticator(ORIGIN);
  const regOptions = await call(BANK, "/api/passkey/register/options", { method: "POST", token: s.token });
  const reg = await call(BANK, "/api/passkey/register/verify", { method: "POST", token: s.token, body: { response: state.auth1.register(regOptions), deviceLabel: "Test phone" } });
  assert.equal(reg.ok, true, reg.error);

  const forged = await call(VAULT, "/v1/keygen/start", { method: "POST", body: { ticket: "e30.forged" } });
  assert.equal(forged.status, 403, "vault refuses keygen without a bank-signed ticket");

  const { ticket } = await call(BANK, "/api/wallet/keygen-ticket", { method: "POST", token: s.token });
  const start = await call(VAULT, "/v1/keygen/start", { method: "POST", body: { ticket } });
  assert.equal(start.status, 200, start.error);
  const replay = await call(VAULT, "/v1/keygen/start", { method: "POST", body: { ticket } });
  assert.equal(replay.status, 403, "keygen tickets are single-use");

  state.cardKey = crypto.randomBytes(32);
  const parts = await runKeygen(start, new KeygenSession(3, 2, PART_A), new KeygenSession(3, 2, PART_C), (c, pk) => sealPartC(c, state.cardKey, CLIENT, pk));
  state.parts = parts;
  state.address = addressOf(parts.publicKey);
  assert.equal(parts.version, 1);
  assert.notEqual(hex(parts.a), hex(parts.c), "A and C are different parts");

  // A random key's valid ownership proof for its own address: the bank checks it against the vault's key.
  const intruder = ethers.Wallet.createRandom();
  const { template: t1 } = await call(BANK, "/api/wallet/link-message", { token: s.token });
  const bad = await call(BANK, "/api/wallet/link", {
    method: "POST",
    token: s.token,
    body: { address: intruder.address, signature: await intruder.signMessage(t1.replace("{ADDRESS}", intruder.address)), backupMode: "client-file" },
  });
  assert.equal(bad.status, 400, "an address that isn't the vault's key is rejected");

  const { template } = await call(BANK, "/api/wallet/link-message", { token: s.token });
  const hash = ethers.getBytes(ethers.hashMessage(template.replace("{ADDRESS}", state.address)));
  const full = finishSignature(hash, signTogether(parts.a, parts.c, hash), state.address);
  const signature = ethers.hexlify(full.slice(0, 64)) + (full[64] + 27).toString(16);
  const link = await call(BANK, "/api/wallet/link", { method: "POST", token: s.token, body: { address: state.address, signature, backupMode: "client-file" } });
  assert.equal(link.ok, true, link.error);
  assert.equal(link.wallet.travelRule.status, "verified-self-hosted");
  assert.equal(link.wallet.custody, "mpc-2of3");

  assert.equal((await call(BANK, "/api/wallet/activate", { method: "POST", token: s.token })).ok, true);
  const again = await call(BANK, "/api/wallet/keygen-ticket", { method: "POST", token: s.token });
  assert.equal(again.status, 409, "after activation the key can't be replaced without a recovery");
  const key = await call(VAULT, `/v1/keys/${CLIENT}`);
  assert.equal(key.publicKey, hex(parts.publicKey));
});

test("pay ETH: Trust Wallet Core builds, the bank screens and approves, Part A + Part B co-sign", async (t) => {
  if (state.skip) return t.skip();
  const s = await passkeyLogin(state.auth1, "phone-1");
  state.session1 = s.token;
  const tx = { ...fees, to: DEAD, amount: 1000n };
  const input = ethInput(tx);
  const hash = preImage(input);
  const { prep, ok } = await approve(s.token, state.auth1, { kind: "transfer", asset: "ETH", tx: forBank(tx) }, { version: 1 });
  assert.equal(prep.intent.hash, ethers.hexlify(hash), "the bank rebuilt the same hash as Trust Wallet Core");
  assert.equal(prep.screening.decision, "ok");
  assert.ok(ok.ticket, ok.error);

  const full = finishSignature(hash, await vaultSign(state.parts.a, ok.ticket, hash), state.address);
  const raw = compile(input, full, state.parts.publicKey);
  assert.equal(ethers.Transaction.from(raw).from, state.address, "Trust Wallet Core compiled a transaction from the MPC wallet");
  // The fresh test wallet has no Sepolia ETH, so the node must reject for funds, which shows the
  // signature, chain ID and encoding are valid.
  await assert.rejects(provider.broadcastTransaction(raw), (e) => /insufficient funds/i.test(e.message));

  const replay = await call(VAULT, "/v1/sign/start", { method: "POST", body: { ticket: ok.ticket } });
  assert.equal(replay.status, 403, "sign tickets are single-use");
  const forged = await call(VAULT, "/v1/sign/start", { method: "POST", body: { ticket: `${b64(Buffer.from(JSON.stringify({ purpose: "sign", clientId: CLIENT, hash: b64(hash), exp: Date.now() + 1e6, jti: "x" })))}.forged` } });
  assert.equal(forged.status, 403, "vault refuses forged sign tickets");
  assert.throws(() => signTogether(state.parts.a, state.parts.a, hash), /same part/, "one part alone can't sign");
});

test("screening sees the real recipient: sanctioned ETH and token payments are refused before signing", async (t) => {
  if (state.skip) return t.skip();
  const token = state.session1;
  const eth = await call(BANK, "/api/tx/prepare", { method: "POST", token, body: { kind: "transfer", asset: "ETH", tx: forBank({ ...fees, to: SANCTIONED, amount: 1000n }) } });
  assert.equal(eth.status, 403);
  assert.equal(eth.screening.decision, "blocked");
  const cfg = await call(BANK, "/api/public/config");
  const usdc = await call(BANK, "/api/tx/prepare", {
    method: "POST",
    token,
    body: { kind: "transfer", asset: "USDC", tx: forBank({ ...fees, gasLimit: 80000n, token: cfg.tokens.USDC.address, to: SANCTIONED, amount: 1_000_000n }) },
  });
  assert.equal(usdc.status, 403, "the recipient inside a token transfer is screened, not the token contract");
  const smuggle = await call(BANK, "/api/tx/prepare", { method: "POST", token, body: { kind: "transfer", asset: "ETH", tx: { ...forBank({ ...fees, to: DEAD, amount: 1n }), data: "0xdeadbeef" } } });
  assert.equal(smuggle.status, 400, "an ETH transfer can't carry hidden call data");
  const screen = await call(BANK, "/api/compliance/screen", { method: "POST", token, body: { to: DEAD, asset: "ETH", amount: ethers.parseEther("0.05").toString() } });
  assert.equal(screen.tier, "high-value");
  const small = await call(BANK, "/api/compliance/screen", { method: "POST", token, body: { to: DEAD, asset: "USDC", amount: "1000000" } });
  assert.equal(small.tier, "standard");
});

test("high-value payments also need the SMS code before the vault may co-sign", async (t) => {
  if (state.skip) return t.skip();
  const body = { kind: "transfer", asset: "ETH", tx: forBank({ ...fees, to: DEAD, amount: ethers.parseEther("0.05") }) };
  const noCode = await approve(state.session1, state.auth1, body, { otp: "000000" });
  assert.equal(noCode.prep.otpRequired, true);
  assert.equal(noCode.ok.status, 403, "wrong SMS code refused");
  const withCode = await approve(state.session1, state.auth1, body, { otp: true });
  assert.ok(withCode.ok.ticket, withCode.ok.error);
});

test("gasless USDC: the client signs an EIP-3009 authorization with A + B; only that exact one is relayed", async (t) => {
  if (state.skip) return t.skip();
  const cfg = await call(BANK, "/api/public/config");
  const usdc = cfg.tokens.USDC;
  const authorization = { to: DEAD, value: "1000000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: ethers.hexlify(crypto.randomBytes(32)) };
  const { prep, ok } = await approve(state.session1, state.auth1, { kind: "gasless", asset: "USDC", authorization }, { version: 1 });
  assert.equal(prep.status, 200, prep.error);
  const domain = { name: usdc.name, version: usdc.version, chainId: cfg.chainId, verifyingContract: usdc.address };
  const types = { TransferWithAuthorization: ["from:address", "to:address", "value:uint256", "validAfter:uint256", "validBefore:uint256", "nonce:bytes32"].map((x) => ({ name: x.split(":")[0], type: x.split(":")[1] })) };
  const hash = ethers.getBytes(ethers.TypedDataEncoder.hash(domain, types, { from: state.address, ...authorization }));
  assert.equal(prep.intent.hash, ethers.hexlify(hash));
  const full = finishSignature(hash, await vaultSign(state.parts.a, ok.ticket, hash), state.address);
  const signature = ethers.hexlify(full.slice(0, 64)) + (full[64] + 27).toString(16);
  assert.equal(ethers.verifyTypedData(domain, types, { from: state.address, ...authorization }, signature), state.address, "MPC signature is a valid EIP-712 signature");

  const wrong = await call(BANK, "/api/relay", { method: "POST", token: state.session1, body: { hash: ethers.hexlify(hash), signature: await ethers.Wallet.createRandom().signTypedData(domain, types, { from: state.address, ...authorization }) } });
  assert.equal(wrong.status, 400, "a signature from another key is refused");
  const other = await call(BANK, "/api/relay", { method: "POST", token: state.session1, body: { hash: ethers.hexlify(crypto.randomBytes(32)), signature } });
  assert.equal(other.status, 403, "nothing that wasn't approved is relayed");

  const before = await call(BANK, "/api/relay/status", { token: state.session1 });
  const relay = await call(BANK, "/api/relay", { method: "POST", token: state.session1, body: { hash: ethers.hexlify(hash), signature } });
  if (!before.funded) {
    assert.equal(relay.status, 503, "empty fee account: refused after the signature check");
    assert.equal((await call(BANK, "/api/relay/status", { token: state.session1 })).remaining, before.remaining, "a refused relay doesn't use up the daily quota");
    t.diagnostic(`treasury unfunded: relay stopped before submission (${relay.error})`);
  } else {
    // A fresh test wallet holds no USDC, so the token contract refuses it on simulation.
    assert.equal(relay.status, 502, relay.error);
  }
});

test("compliant dApps: approved apps only, plain-language effects after a dry run, no unlimited approvals", async (t) => {
  if (state.skip) return t.skip();
  const token = state.session1;
  const cfg = await call(BANK, "/api/public/config");
  const weth = cfg.dapps.find((d) => d.kind === "weth");
  const permit2 = cfg.dapps.find((d) => d.kind === "spender");
  const approveIface = new ethers.Interface(["function approve(address,uint256)", "function deposit() payable"]);
  const simulate = (to, data, value = "0") => call(BANK, "/api/dapps/simulate", { method: "POST", token, body: { to, data, value } });

  const unlimited = await simulate(cfg.tokens.USDC.address, approveIface.encodeFunctionData("approve", ["0x00000000000000000000000000000000DeaDBeef", ethers.MaxUint256]));
  assert.equal(unlimited.decision, "blocked");
  assert.match(unlimited.reasons.join(" "), /not on Swissquote's approved dApp list/);
  assert.match(unlimited.reasons.join(" "), /unlimited/);
  assert.match(unlimited.effects[0].text, /ALL your USDC/, "the effect is explained in plain language");

  const unknown = await simulate(cfg.demoDappRequests.find((r) => /unknown contract/i.test(r.label)).to, approveIface.encodeFunctionData("deposit"), "1000");
  assert.equal(unknown.decision, "blocked", "calls to contracts that aren't approved are refused");

  const wrap = await simulate(weth.address, approveIface.encodeFunctionData("deposit"), "1000000000000000");
  assert.deepEqual(wrap.effects.map((e) => e.dir), ["out", "in"], "wrapping: ETH out, WETH in");
  assert.match(wrap.reasons.join(" "), /You only have 0 ETH/, "the empty test wallet can't pay, so Swissquote says so before signing");

  // A limited approval to an approved dApp passes the dry run and is co-signed like a payment.
  const data = approveIface.encodeFunctionData("approve", [permit2.address, 5_000_000n]);
  const ok = await simulate(cfg.tokens.USDC.address, data);
  assert.equal(ok.decision, "ok", ok.reasons?.join(" "));
  assert.match(ok.effects[0].text, /Uniswap Permit2 may take up to 5 USDC/);
  assert.ok(ok.checks.some((c) => c.ok && /Dry run/.test(c.text)));
  const tx = { ...fees, gasLimit: 80000n, to: cfg.tokens.USDC.address, amount: 0n, data };
  const input = ethInput(tx);
  const hash = preImage(input);
  const { prep, ok: approved } = await approve(token, state.auth1, { kind: "contract", asset: "ETH", tx: forBank(tx) }, { version: 1 });
  assert.equal(prep.intent.hash, ethers.hexlify(hash), "the bank rebuilt the dApp call's hash");
  assert.equal(prep.intent.kind, "contract");
  const full = finishSignature(hash, await vaultSign(state.parts.a, approved.ticket, hash), state.address);
  assert.equal(ethers.Transaction.from(compile(input, full, state.parts.publicKey)).from, state.address);

  const bad = await call(BANK, "/api/tx/prepare", { method: "POST", token, body: { kind: "contract", asset: "ETH", tx: forBank({ ...tx, data: approveIface.encodeFunctionData("approve", [permit2.address, ethers.MaxUint256]) }) } });
  assert.equal(bad.status, 403, "unlimited approvals are refused even to approved dApps");
  const sneaky = await call(BANK, "/api/tx/prepare", { method: "POST", token, body: { kind: "contract", asset: "ETH", tx: forBank({ ...tx, data: erc20.encodeFunctionData("transfer", [SANCTIONED, 1n]) }) } });
  assert.equal(sneaky.status, 403, "token transfers can't bypass Send's screening through the dApp path");
});

test("add a device by invite, then remove it: Swissquote no longer co-signs for its copy of Part A", async (t) => {
  if (state.skip) return t.skip();
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([iv, c.update(state.parts.a), c.final(), c.getAuthTag()]);
  const otpOnly = await login("laptop-otp");
  const notPasskey = await call(BANK, "/api/devices/invite", { method: "POST", token: otpOnly.token, body: { sealedShare: b64(sealed) } });
  assert.equal(notPasskey.status, 403, "only a passkey-unlocked device can invite");
  const inv = await call(BANK, "/api/devices/invite", { method: "POST", token: state.session1, body: { sealedShare: b64(sealed), encC: { iv: "x", ct: "y" }, version: 1, publicKey: hex(state.parts.publicKey) } });
  assert.ok(inv.inviteToken, inv.error);

  const s2 = await login("phone-2");
  const auth2 = softAuthenticator(ORIGIN);
  const opts = await call(BANK, "/api/devices/join/options", { method: "POST", token: s2.token, body: { inviteToken: inv.inviteToken } });
  const joined = await call(BANK, "/api/devices/join/verify", { method: "POST", token: s2.token, body: { inviteToken: inv.inviteToken, response: auth2.register(opts), deviceLabel: "Test phone 2" } });
  assert.ok(joined.sealedShare, joined.error);
  const reuse = await call(BANK, "/api/devices/join/options", { method: "POST", token: s2.token, body: { inviteToken: inv.inviteToken } });
  assert.equal(reuse.status, 403, "an invite adds one device only");
  const packed = Buffer.from(unb64(joined.sealedShare));
  const d = crypto.createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  d.setAuthTag(packed.subarray(packed.length - 16));
  const copyOfA = new Uint8Array(Buffer.concat([d.update(packed.subarray(12, packed.length - 16)), d.final()]));
  assert.equal(hex(copyOfA), hex(state.parts.a), "the new device holds an identical copy of Part A");

  const tx = { ...fees, to: DEAD, amount: 7n };
  const { ok } = await approve(s2.token, auth2, { kind: "transfer", asset: "ETH", tx: forBank(tx) });
  assert.ok(ok.ticket, "the new device approves payments with its own passkey");

  const lost = await call(BANK, `/api/devices/${encodeURIComponent(joined.credentialId)}/report-lost`, { method: "POST", token: state.session1 });
  assert.equal(lost.ok, true);
  const after = await call(BANK, "/api/tx/prepare", { method: "POST", token: s2.token, body: { kind: "transfer", asset: "ETH", tx: forBank(tx) } });
  assert.ok(after.status === 401 || !after.options?.allowCredentials?.some((x) => x.id === joined.credentialId), "the removed device's session and passkey stop working");
  if (after.status === 200) assert.throws(() => auth2.assert(after.options), /none of the allowed/);
});

test("attacker with stolen password + phone/e-mail OTP is refused by identity check", async (t) => {
  if (state.skip) return t.skip();
  const atk = await login("attacker-phone");
  const r = await call(BANK, "/api/recovery/start", { method: "POST", token: atk.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "passkey", deviceLabel: "Attacker phone" } });
  assert.equal(r.recovery.status, "pending_kyc");
  const early = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: atk.token });
  assert.equal(early.status, 403, "no recovery ticket before identity verification");
  const decision = await operator(`/api/operator/recoveries/${r.recovery.id}/decision`, { decision: "reject", note: "face mismatch" });
  assert.equal(decision.recovery.status, "rejected");
  const after = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: atk.token });
  assert.equal(after.status, 403, "rejected recovery never yields a ticket");
  const forged = await call(VAULT, "/v1/recovery/start", { method: "POST", body: { lost: 0, ticket: `${b64(Buffer.from(JSON.stringify({ purpose: "recover", clientId: CLIENT, notBefore: 0, exp: Date.now() + 1e6, jti: "x" })))}.forgedmac` } });
  assert.equal(forged.status, 403, "vault refuses forged tickets");
  const noPasskey = await call(BANK, "/api/passkey/register/options", { method: "POST", token: atk.token });
  assert.equal(noPasskey.status, 403, "a password + SMS login can't add a passkey to an active wallet");
});

test("attacker who passes KYC is still stopped when the real client cancels during the delay", async (t) => {
  if (state.skip) return t.skip();
  const atk = await login("attacker-phone-2");
  const r = await call(BANK, "/api/recovery/start", { method: "POST", token: atk.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "Attacker phone 2" } });
  await operator(`/api/operator/recoveries/${r.recovery.id}/decision`, { decision: "approve" });
  const owner = await login("owner-laptop");
  const c = await call(BANK, `/api/recovery/${r.recovery.id}/cancel`, { method: "POST", token: owner.token });
  assert.equal(c.recovery.status, "cancelled");
  const t2 = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: atk.token });
  assert.equal(t2.status, 403);
  const again = await call(BANK, "/api/recovery/start", { method: "POST", token: atk.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "Attacker phone 2" } });
  assert.equal(again.status, 423, "recovery frozen after fraud report");
  const list = (await operator("/api/operator/recoveries")).recoveries;
  await operator(`/api/operator/clients/${CLIENT}/unfreeze`, {});
  assert.ok(list.length > 0);
});

test("transaction reports are validated and can't fake or double-credit a deposit", async (t) => {
  if (state.skip) return t.skip();
  const s = await login("phone-1");
  const cfg = await call(BANK, "/api/public/config");
  const bad = await call(BANK, "/api/tx/report", { method: "POST", token: s.token, body: { hash: "0x1234", to: cfg.treasuryAddress, amount: "1" } });
  assert.equal(bad.status, 400, "malformed hash rejected");
  const before = (await call(BANK, "/api/bank/overview", { token: s.token })).client.accounts.ethCustody;
  const fakeHash = "0x" + crypto.randomBytes(32).toString("hex");
  const body = { hash: fakeHash, to: cfg.treasuryAddress, asset: "ETH", amount: ethers.parseEther("1").toString(), tier: "standard" };
  assert.equal((await call(BANK, "/api/tx/report", { method: "POST", token: s.token, body })).ok, true);
  assert.equal((await call(BANK, "/api/tx/report", { method: "POST", token: s.token, body })).duplicate, true, "same hash reported twice is ignored");
  const after = await call(BANK, "/api/bank/overview", { token: s.token });
  assert.equal(after.client.accounts.ethCustody, before, "a claimed deposit that isn't on-chain is not credited");
});

test("the recovering device can abandon its recovery and start a new one", async (t) => {
  if (state.skip) return t.skip();
  const s = await login("abandon-phone");
  const r = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "data:image/jpeg;base64,AAAA", selfieSource: "camera", path: "paper", deviceLabel: "Abandon phone" } });
  assert.equal(r.recovery.status, "pending_kyc");
  const blocked = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper" } });
  assert.equal(blocked.status, 409, "only one recovery at a time");
  assert.match(blocked.error, /"Abandon phone".*expires at/, "the conflict says which device holds the open recovery and when it expires");
  const other = await login("other-device");
  const notMine = await call(BANK, `/api/recovery/${r.recovery.id}/abandon`, { method: "POST", token: other.token });
  assert.equal(notMine.status, 404, "another device logged in with password + SMS can't abandon it (it must use cancel + freeze)");
  const a = await call(BANK, `/api/recovery/${r.recovery.id}/abandon`, { method: "POST", token: s.token });
  assert.equal(a.recovery.status, "abandoned");

  // A recovery whose share was released but never finished can be discarded by the owner's passkey.
  const stuck = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "Abandon phone" } });
  await operator(`/api/operator/recoveries/${stuck.recovery.id}/decision`, { decision: "approve" });
  for (;;) {
    const t = await call(BANK, `/api/recovery/${stuck.recovery.id}/recover-ticket`, { method: "POST", token: s.token });
    if (t.ticket) break;
    assert.match(t.error, /Security delay/);
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const owner = await passkeyLogin(state.auth1, "owner-laptop");
  const shown = (await call(BANK, "/api/bank/overview", { token: owner.token })).recoveries.find((x) => x.id === stuck.recovery.id);
  assert.equal(shown.status, "released");
  const discarded = await call(BANK, `/api/recovery/${stuck.recovery.id}/abandon`, { method: "POST", token: owner.token });
  assert.equal(discarded.recovery.status, "abandoned", "the owner's passkey closes a stuck recovery from another device");
  const forgotten = await call(BANK, "/api/recovery/start", { method: "POST", token: other.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "Reset laptop" } });
  const closed = await operator(`/api/operator/recoveries/${forgotten.recovery.id}/close`, {});
  assert.equal(closed.recovery.status, "abandoned", "support can close an open recovery when the client calls");
  const again = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "Abandon phone" } });
  assert.equal(again.recovery.status, "pending_kyc");
  await call(BANK, `/api/recovery/${again.recovery.id}/abandon`, { method: "POST", token: s.token });
  const noPhoto = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "not-an-image", path: "paper" } });
  assert.equal(noPhoto.status, 400, "a real photo is required");
});

test("legit recovery with the paper card: KYC, time-lock, then C + B refresh all parts; same address, old parts refused by the vault", { timeout: 400_000 }, async (t) => {
  if (state.skip) return t.skip();
  const s = await login("new-phone");
  const r = await call(BANK, "/api/recovery/start", { method: "POST", token: s.token, body: { selfie: "data:image/jpeg;base64,AAAA", path: "paper", deviceLabel: "New phone" } });
  assert.equal(r.recovery.status, "pending_kyc");
  await operator(`/api/operator/recoveries/${r.recovery.id}/decision`, { decision: "approve" });
  const tooEarly = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: s.token });
  assert.equal(tooEarly.status, 403, "time-lock enforced");
  const other = await login("some-other-device");
  const wrongDevice = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: other.token });
  assert.equal(wrongDevice.status, 404, "only the device that started recovery can continue");

  let cur;
  do {
    await new Promise((res) => setTimeout(res, 2000));
    cur = (await call(BANK, "/api/recovery/current", { token: s.token })).recovery;
  } while (cur.secondsLeft > 0);

  // Released: this device may add its passkey now.
  assert.ok((await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: s.token })).ticket);
  const auth3 = softAuthenticator(ORIGIN);
  const regOptions = await call(BANK, "/api/passkey/register/options", { method: "POST", token: s.token });
  assert.equal((await call(BANK, "/api/passkey/register/verify", { method: "POST", token: s.token, body: { response: auth3.register(regOptions), deviceLabel: "New phone" } })).ok, true);

  const { ticket } = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: s.token });
  const badLost = await call(VAULT, "/v1/recovery/start", { method: "POST", body: { ticket, lost: 1 } });
  assert.equal(badLost.status, 403, "Swissquote's own part can't be declared lost");
  const { ticket: t2 } = await call(BANK, `/api/recovery/${r.recovery.id}/recover-ticket`, { method: "POST", token: s.token });
  const start = await call(VAULT, "/v1/recovery/start", { method: "POST", body: { ticket: t2, lost: PART_A } });
  assert.equal(start.status, 200, start.error);
  assert.equal(start.publicKey, hex(state.parts.publicKey));
  const pk = Uint8Array.from(Buffer.from(start.publicKey, "hex"));
  assert.throws(() => openPartC(start.encC, crypto.randomBytes(32), CLIENT, pk), /don't open/, "a wrong card doesn't open Part C");
  const partC = openPartC(start.encC, state.cardKey, CLIENT, pk);
  assert.equal(hex(partC), hex(state.parts.c), "the card opens the vault's copy of Part C");

  state.newCardKey = crypto.randomBytes(32);
  const lost = new Uint8Array([PART_A]);
  const fresh = await runKeygen(start, KeygenSession.initLostShareRecovery(3, 2, PART_A, pk, lost), KeygenSession.initKeyRecovery(Keyshare.fromBytes(partC), lost), (c, p) =>
    sealPartC(c, state.newCardKey, CLIENT, p)
  );
  assert.equal(hex(fresh.publicKey), hex(state.parts.publicKey), "same key, same address");
  assert.equal(fresh.version, 2);
  assert.notEqual(hex(fresh.a), hex(state.parts.a), "Part A was replaced");
  const done = await call(BANK, `/api/recovery/${r.recovery.id}/complete`, { method: "POST", token: s.token, body: { address: state.address } });
  assert.equal(done.ok, true, done.error);

  const p3 = await passkeyLogin(auth3, "new-phone");
  const tx = { ...fees, to: DEAD, amount: 42n };
  const input = ethInput(tx);
  const hash = preImage(input);
  const { ok } = await approve(p3.token, auth3, { kind: "transfer", asset: "ETH", tx: forBank(tx) }, { version: 2 });
  const full = finishSignature(hash, await vaultSign(fresh.a, ok.ticket, hash), state.address);
  assert.equal(ethers.Transaction.from(compile(input, full, fresh.publicKey)).from, state.address, "the recovered device pays from the same wallet");

  const old = await approve(p3.token, auth3, { kind: "transfer", asset: "ETH", tx: forBank(tx) }, { version: 1 });
  assert.equal((await call(VAULT, "/v1/sign/start", { method: "POST", body: { ticket: old.ok.ticket } })).status, 403, "the vault refuses a device holding an outdated part");
  const sneaky = await approve(p3.token, auth3, { kind: "transfer", asset: "ETH", tx: forBank(tx) }, { version: 2 });
  await assert.rejects(vaultSign(state.parts.a, sneaky.ok.ticket, hash), "the old Part A (lost device) no longer signs with the refreshed Part B");
  const loginOptions = await call(BANK, "/api/auth/passkey/options", { method: "POST", body: { clientId: CLIENT } });
  assert.throws(() => state.auth1.assert(loginOptions), /none of the allowed/, "the lost device's passkey was revoked");
  state.fresh = fresh;
});

test("emergency recovery without Swissquote: card + notary escrow, and card + backup file, sign for the wallet", { timeout: 120_000 }, async (t) => {
  if (state.skip || !state.fresh) return t.skip();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sq-emergency-"));
  try {
    const words = await wordsOfCardKey(state.newCardKey);
    const cardFile = path.join(tmp, "card.txt");
    fs.writeFileSync(cardFile, ["SWISSQUOTE WALLET — RECOVERY CARD", ...words.split(" ").map((w, i) => `${String(i + 1).padStart(2)}. ${w}`)].join("\n"));
    const env = { ...process.env };
    const out = execFileSync(process.execPath, [path.join(root, "tools/emergency-recover.mjs"), "--client", CLIENT, "--card", cardFile], { cwd: root, encoding: "utf8", env });
    assert.match(out, new RegExp(state.address));
    assert.match(out, /two parts sign together/);

    const pkHex = hex(state.fresh.publicKey);
    const backup = { kind: "swissquote-wallet/mpc-backup", version: 3, clientId: CLIENT, address: state.address, publicKey: pkHex, createdAt: new Date().toISOString(), partA: sealPartAWithPassword(state.fresh.a, "correct horse battery", CLIENT, pkHex), partC: sealPartC(state.fresh.c, state.newCardKey, CLIENT, state.fresh.publicKey) };
    const backupFile = path.join(tmp, "backup.json");
    fs.writeFileSync(backupFile, JSON.stringify(backup));
    const out2 = execFileSync(process.execPath, [path.join(root, "tools/emergency-recover.mjs"), "--backup", backupFile, "--password", "correct horse battery", "--card", cardFile, "--to", DEAD, "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    assert.match(out2, /encrypted backup file \(Part A\)/);
    assert.match(out2, /two parts sign together/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Runs last: it locks the test client's password login for 5 minutes.
test("repeated wrong passwords lock the login", async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call(BANK, "/api/auth/login", { method: "POST", body: { clientId: CLIENT, password: "wrong", deviceId: "brute" } });
  assert.equal(last.status, 429);
  const right = await call(BANK, "/api/auth/login", { method: "POST", body: { clientId: CLIENT, password: PASSWORD, deviceId: "brute" } });
  assert.equal(right.status, 429, "even the right password waits out the lock");
});
