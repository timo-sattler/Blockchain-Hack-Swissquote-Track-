// Node side of the wallet's MPC key, without Swissquote: two parts signing together locally, and
// the same encryption the app uses for Part C (paper Recovery Card) and Part A (backup file with a
// wallet password). Used by the offline emergency tool and the tests.
import crypto from "node:crypto";
import wc from "@trustwallet/wallet-core";
import { ethers } from "ethers";
import { KeygenSession, Keyshare, Message, SignSession } from "@silencelaboratories/dkls-wasm-ll-node";

export const PART_A = 0;
export const PART_B = 1;
export const PART_C = 2;
export { KeygenSession, Keyshare, Message, SignSession };

let corePromise;
export const core = () => (corePromise ??= wc.initWasm());

export const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
export const unb64 = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));
export const hex = (bytes) => Buffer.from(bytes).toString("hex");
export const toWire = (m) => ({ from: m.from_id, to: m.to_id ?? null, payload: b64(m.payload) });
export const fromWire = (w) => new Message(unb64(w.payload), w.from, w.to ?? undefined);
export const others = (msgs, party) => msgs.filter((m) => m.from !== party).map(fromWire);
export const forParty = (msgs, party) => msgs.filter((m) => m.to === party).map(fromWire);

export function partyOf(share) {
  const k = Keyshare.fromBytes(share);
  const out = { party: k.partyId, publicKey: new Uint8Array(k.publicKey) };
  k.free();
  return out;
}

/** Any two parts sign `hash` together, entirely in this process. */
export function signTogether(share1, share2, hash) {
  const parties = [new SignSession(Keyshare.fromBytes(share1), "m"), new SignSession(Keyshare.fromBytes(share2), "m")];
  const ids = [partyOf(share1).party, partyOf(share2).party];
  if (ids[0] === ids[1]) throw new Error("These are two copies of the same part; you need two different parts.");
  const msg1 = parties.map((p) => toWire(p.createFirstMessage()));
  const msg2 = parties.flatMap((p, i) => p.handleMessages(others(msg1, ids[i])).map(toWire));
  const msg3 = parties.flatMap((p, i) => p.handleMessages(forParty(msg2, ids[i])).map(toWire));
  parties.forEach((p, i) => p.handleMessages(forParty(msg3, ids[i])));
  const msg4 = parties.map((p) => toWire(p.lastMessage(hash)));
  const [r, s] = parties[0].combine(others(msg4, ids[0]));
  parties[1].free();
  return { r: new Uint8Array(r), s: new Uint8Array(s) };
}

/** (r, s) -> 65-byte r || s || recovery id in low-S form, checked against the wallet address. */
export function finishSignature(hash, sig, address) {
  let s = BigInt(ethers.hexlify(sig.s));
  if (s > ethers.N / 2n) s = ethers.N - s;
  for (const v of [0, 1]) {
    const full = ethers.getBytes(ethers.concat([ethers.zeroPadValue(ethers.hexlify(sig.r), 32), ethers.toBeHex(s, 32), new Uint8Array([v])]));
    const recovered = ethers.recoverAddress(hash, { r: ethers.hexlify(full.slice(0, 32)), s: ethers.hexlify(full.slice(32, 64)), v: 27 + v });
    if (recovered.toLowerCase() === address.toLowerCase()) return full;
  }
  throw new Error("The signature does not match the wallet address (are these parts from the same, current key?).");
}

export const addressOf = (publicKey) => ethers.computeAddress(`0x${hex(publicKey)}`);

// ---------------- Part C: encrypted under the paper Recovery Card ----------------
const hkdfKey = (ikm, info) => Buffer.from(crypto.hkdfSync("sha256", ikm, Buffer.alloc(32), info, 32));

export async function cardKeyOfWords(words) {
  const { HDWallet, Mnemonic } = await core();
  const norm = String(words).trim().toLowerCase().split(/\s+/).join(" ");
  if (!Mnemonic.isValid(norm)) throw new Error("Those 24 words are not valid (typo or wrong order?)");
  const w = HDWallet.createWithMnemonic(norm, "");
  const e = new Uint8Array(w.entropy());
  w.delete();
  return e;
}

export async function wordsOfCardKey(cardKey) {
  const { HDWallet } = await core();
  const w = HDWallet.createWithEntropy(cardKey, "");
  const m = w.mnemonic();
  w.delete();
  return m;
}

const partCAad = (clientId, publicKey) => Buffer.from(`part-c|${clientId}|${hex(publicKey)}`);

export function sealPartC(partC, cardKey, clientId, publicKey) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", hkdfKey(cardKey, "swissquote-wallet/part-c/v1"), iv);
  c.setAAD(partCAad(clientId, publicKey));
  const ct = Buffer.concat([c.update(partC), c.final(), c.getAuthTag()]);
  return { v: 1, alg: "AES-256-GCM/HKDF-SHA256(recovery-card)", iv: b64(iv), ct: b64(ct) };
}

export function openPartC(encC, cardKey, clientId, publicKey) {
  const data = Buffer.from(unb64(encC.ct));
  const d = crypto.createDecipheriv("aes-256-gcm", hkdfKey(cardKey, "swissquote-wallet/part-c/v1"), Buffer.from(unb64(encC.iv)));
  d.setAAD(partCAad(clientId, publicKey));
  d.setAuthTag(data.subarray(data.length - 16));
  try {
    return new Uint8Array(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]));
  } catch {
    throw new Error("These words don't open this recovery part (wrong card, or an older card replaced by a recovery).");
  }
}

// ---------------- Part A in a backup file (wallet-password mode) ----------------
export function openPartAWithPassword(env, password, clientId, publicKeyHex) {
  if (env.kdf !== "pbkdf2-sha256") throw new Error("This backup's Part A is protected by a passkey: it can only be opened in the app on a device with that passkey.");
  const ikm = crypto.pbkdf2Sync(Buffer.from(String(password).normalize("NFKC")), Buffer.from(unb64(env.salt)), env.iter || 600_000, 32, "sha256");
  const data = Buffer.from(unb64(env.ct));
  const d = crypto.createDecipheriv("aes-256-gcm", hkdfKey(ikm, `swissquote-wallet/${env.purpose}/v1`), Buffer.from(unb64(env.iv)));
  d.setAAD(Buffer.from(`part-a|${clientId}|${publicKeyHex.toLowerCase()}`));
  d.setAuthTag(data.subarray(data.length - 16));
  try {
    return new Uint8Array(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]));
  } catch {
    throw new Error("Wrong wallet password, or the backup file was modified.");
  }
}

// Same envelope the app writes (envelope.ts), for tests.
export function sealPartAWithPassword(partA, password, clientId, publicKeyHex, credentialId = "test") {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const ikm = crypto.pbkdf2Sync(Buffer.from(String(password).normalize("NFKC")), salt, 600_000, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", hkdfKey(ikm, "swissquote-wallet/part-a/v1"), iv);
  c.setAAD(Buffer.from(`part-a|${clientId}|${publicKeyHex.toLowerCase()}`));
  const ct = Buffer.concat([c.update(partA), c.final(), c.getAuthTag()]);
  return { v: 2, alg: "AES-256-GCM/HKDF-SHA256(PBKDF2-SHA256)", kdf: "pbkdf2-sha256", iter: 600_000, salt: b64(salt), purpose: "part-a", credentialId, iv: b64(iv), ct: b64(ct) };
}
