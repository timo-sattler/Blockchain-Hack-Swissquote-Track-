// The client's side of the MPC key (2-of-3 threshold ECDSA, DKLs23, Silence Laboratories).
//   Part A  party 0  on this device (and identical copies on the client's other devices)
//   Part B  party 1  Swissquote's Share Vault (separate service)
//   Part C  party 2  the recovery part, encrypted under the client's paper Recovery Card
// Any two parts sign together; the private key never exists in one place. Only protocol messages
// travel to the vault ({from, to, payload}); the parts never leave their holders.
import init, { KeygenSession, Keyshare, Message, SignSession } from "@silencelaboratories/dkls-wasm-ll-web";
import wasmUrl from "@silencelaboratories/dkls-wasm-ll-web/dkls-wasm-ll-web_bg.wasm?url";
import { vault } from "./api";
import { fromB64url, toB64url } from "./bytes";
import type { EncC } from "./card";

export const PART_A = 0;
export const PART_B = 1;
export const PART_C = 2;

type Wire = { from: number; to: number | null; payload: string };
export interface Signature {
  r: Uint8Array;
  s: Uint8Array;
}
export interface KeyParts {
  a: Uint8Array;
  c: Uint8Array;
  publicKey: Uint8Array; // 33-byte compressed secp256k1
  version: number; // Part B version at the vault; a device with an older one was replaced by a recovery
}

let ready: Promise<unknown> | null = null;
export const initMpc = () => (ready ??= init(wasmUrl));

const toWire = (m: Message): Wire => ({ from: m.from_id, to: m.to_id ?? null, payload: toB64url(m.payload) });
const fromWire = (w: Wire) => new Message(fromB64url(w.payload), w.from, w.to ?? undefined);
const others = (msgs: Wire[], party: number) => msgs.filter((m) => m.from !== party).map(fromWire);
const forParty = (msgs: Wire[], party: number) => msgs.filter((m) => m.to === party).map(fromWire);
const mpc = <T>(sid: string, body: unknown) => vault<T>(`/v1/mpc/${sid}`, "POST", body);

// Four rounds between the device's two parties (A and C) and the vault (B). Used to create the key
// and, with recovery sessions, to refresh all three parts after a loss.
async function runKeygen(
  start: { sessionId: string; messages: Wire[] },
  a: KeygenSession,
  c: KeygenSession,
  sealC: (c: Uint8Array, publicKey: Uint8Array) => Promise<EncC>,
  onStep?: (step: number) => void
): Promise<KeyParts> {
  const sid = start.sessionId;
  const handle = (s: KeygenSession, msgs: Message[], commitments?: Uint8Array[]) => s.handleMessages(msgs, commitments).map(toWire);
  const msg1 = [toWire(a.createFirstMessage()), toWire(c.createFirstMessage()), ...start.messages];
  onStep?.(1);
  const msg2Local = [...handle(a, others(msg1, PART_A)), ...handle(c, others(msg1, PART_C))];
  const r1 = await mpc<{ messages: Wire[]; commitment: string }>(sid, { messages: msg1.filter((m) => m.from !== PART_B) });
  const commitments = [a.calculateChainCodeCommitment(), fromB64url(r1.commitment), c.calculateChainCodeCommitment()];
  const msg2 = [...msg2Local, ...r1.messages];
  onStep?.(2);
  const msg3Local = [...handle(a, forParty(msg2, PART_A)), ...handle(c, forParty(msg2, PART_C))];
  const r2 = await mpc<{ messages: Wire[] }>(sid, { messages: msg2.filter((m) => m.to === PART_B) });
  const msg3 = [...msg3Local, ...r2.messages];
  onStep?.(3);
  const msg4Local = [...handle(a, forParty(msg3, PART_A), commitments), ...handle(c, forParty(msg3, PART_C), commitments)];
  const r3 = await mpc<{ messages: Wire[] }>(sid, { messages: msg3.filter((m) => m.to === PART_B), commitments: commitments.map(toB64url) });
  const msg4 = [...msg4Local, ...r3.messages];
  handle(a, others(msg4, PART_A));
  handle(c, others(msg4, PART_C));
  const shareA = a.keyshare();
  const shareC = c.keyshare();
  const parts = { a: shareA.toBytes(), c: shareC.toBytes(), publicKey: new Uint8Array(shareA.publicKey) };
  shareA.free();
  shareC.free();
  // Part C leaves the device only encrypted under the paper card; the vault and its notary escrow
  // keep that ciphertext for the card-only recovery paths.
  const encC = await sealC(parts.c, parts.publicKey);
  const done = await mpc<{ publicKey: string; version: number }>(sid, { messages: msg4Local, encC });
  if (done.publicKey !== hexOf(parts.publicKey)) throw new Error("The Share Vault ended up with a different key. Aborted.");
  onStep?.(4);
  return { ...parts, version: done.version };
}

export const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** New wallet: Part A and Part C are created on this device, Part B in the vault. */
export async function createKey(ticket: string, sealC: (c: Uint8Array, publicKey: Uint8Array) => Promise<EncC>, onStep?: (step: number) => void) {
  await initMpc();
  const start = await vault<{ sessionId: string; messages: Wire[] }>("/v1/keygen/start", "POST", { ticket });
  return runKeygen(start, new KeygenSession(3, 2, PART_A), new KeygenSession(3, 2, PART_C), sealC, onStep);
}

/**
 * After a KYC-approved recovery: the part the client still has (A from a passkey/backup file, or C
 * from the paper card) and the vault's Part B rebuild the missing one and refresh all three. Same
 * public key and address; the old parts (also those on a lost device) stop working with Swissquote.
 * `have` may need the vault's card-encrypted Part C first (paper card path), so it gets it.
 */
export async function refreshKey(
  ticket: string,
  lost: typeof PART_A | typeof PART_C,
  have: (encC: EncC, publicKey: Uint8Array) => Promise<Uint8Array>,
  sealC: (c: Uint8Array, publicKey: Uint8Array) => Promise<EncC>,
  onStep?: (step: number) => void
) {
  await initMpc();
  const start = await vault<{ sessionId: string; messages: Wire[]; publicKey: string; encC: EncC }>("/v1/recovery/start", "POST", { ticket, lost });
  const publicKey = Uint8Array.from(start.publicKey.match(/../g)!.map((h) => parseInt(h, 16)));
  const share = await have(start.encC, publicKey);
  const lostSet = new Uint8Array([lost]);
  const fresh = KeygenSession.initLostShareRecovery(3, 2, lost, publicKey, lostSet);
  const kept = KeygenSession.initKeyRecovery(Keyshare.fromBytes(share), lostSet);
  share.fill(0);
  const [a, c] = lost === PART_A ? [fresh, kept] : [kept, fresh];
  const parts = await runKeygen(start, a, c, sealC, onStep);
  if (hexOf(parts.publicKey) !== start.publicKey) throw new Error("The refreshed key has a different public key. Aborted.");
  return parts;
}

/**
 * Part A + the vault's Part B. The vault signs only the hash in the bank's ticket; the device checks
 * it is the hash it computed itself before taking part.
 */
export async function signWithVault(partA: Uint8Array, ticket: string, expected: Uint8Array): Promise<Signature> {
  await initMpc();
  const start = await vault<{ sessionId: string; messages: Wire[]; hash: string }>("/v1/sign/start", "POST", { ticket });
  const hash = fromB64url(start.hash);
  if (hexOf(hash) !== hexOf(expected)) throw new Error("Swissquote approved a different transaction than this device built. Aborted.");
  const sid = start.sessionId;
  const me = new SignSession(Keyshare.fromBytes(partA), "m");
  const m1 = toWire(me.createFirstMessage());
  const msg2 = me.handleMessages(start.messages.map(fromWire)).map(toWire);
  const r1 = await mpc<{ messages: Wire[] }>(sid, { messages: [m1] });
  const msg3 = me.handleMessages(forParty(r1.messages, PART_A)).map(toWire);
  const r2 = await mpc<{ messages: Wire[] }>(sid, { messages: msg2 });
  me.handleMessages(forParty(r2.messages, PART_A));
  const r3 = await mpc<{ messages: Wire[] }>(sid, { messages: msg3 });
  me.lastMessage(hash).free(); // must run before combine; consumes the pre-signature
  const [r, s] = me.combine(r3.messages.map(fromWire)) as [Uint8Array, Uint8Array];
  return { r: new Uint8Array(r), s: new Uint8Array(s) };
}

/** Part A + Part C, entirely on this device: self-custody without Swissquote (paper card needed). */
export async function signLocally(partA: Uint8Array, partC: Uint8Array, hash: Uint8Array): Promise<Signature> {
  await initMpc();
  const parties = [new SignSession(Keyshare.fromBytes(partA), "m"), new SignSession(Keyshare.fromBytes(partC), "m")];
  const ids = [PART_A, PART_C];
  const msg1 = parties.map((p) => toWire(p.createFirstMessage()));
  const msg2 = parties.flatMap((p, i) => p.handleMessages(others(msg1, ids[i])).map(toWire));
  const msg3 = parties.flatMap((p, i) => p.handleMessages(forParty(msg2, ids[i])).map(toWire));
  parties.forEach((p, i) => p.handleMessages(forParty(msg3, ids[i])));
  const msg4 = parties.map((p) => toWire(p.lastMessage(hash)));
  const [r, s] = parties[0].combine(others(msg4, PART_A)) as [Uint8Array, Uint8Array];
  parties[1].free();
  return { r: new Uint8Array(r), s: new Uint8Array(s) };
}

export async function publicKeyOfPart(part: Uint8Array): Promise<Uint8Array> {
  await initMpc();
  const k = Keyshare.fromBytes(part);
  const pk = new Uint8Array(k.publicKey);
  k.free();
  return pk;
}
