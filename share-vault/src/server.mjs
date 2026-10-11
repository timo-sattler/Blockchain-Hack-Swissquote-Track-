// MOCK Swissquote Share Vault: holder of Part B of the client's MPC key (2-of-3 threshold ECDSA,
// DKLs23). Runs as its own process with its own storage. In production this would be an HSM-backed
// service operated by a separate team; the bank backend never sees Part B.
//
// The private key never exists anywhere. The vault takes part in three protocols, each only with a
// one-time ticket the bank signs after its own checks:
//   keygen   create the key together with the client's device (parts A and C stay on the device)
//   sign     co-sign exactly the hash in the ticket (the bank screened the payment it belongs to)
//   recover  refresh all three parts after a KYC-approved recovery; the time-lock and fraud freeze
//            are enforced here with the vault's own clock, independent of the bank
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KeygenSession, Keyshare, Message, SignSession } from "@silencelaboratories/dkls-wasm-ll-node";

const PORT = Number(process.env.VAULT_PORT || 4100);
const TICKET_SECRET = process.env.SQ_VAULT_TICKET_SECRET || "dev-only-shared-ticket-secret-change-me";
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.VAULT_DATA_DIR || path.resolve(here, "../data"));
const DB_FILE = path.join(DATA_DIR, "vault.json");
const ESCROW_FILE = path.join(DATA_DIR, "notary-escrow.json");
const SWISSQUOTE = 1; // MPC party id of Part B. The device runs party 0 (Part A) and party 2 (Part C).
const SESSION_TTL_MS = 10 * 60_000;

fs.mkdirSync(DATA_DIR, { recursive: true });

// A missing file starts empty. An unreadable one stops the vault instead of being overwritten:
// it may hold the only copy of a client's Part B.
function load(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[vault] ${file} is unreadable (${e.message}). Refusing to start so no share is lost. Fix or move the file, then restart.`);
    process.exit(1);
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.rmSync(tmp, { force: true });
  }
}
const db = load(DB_FILE, { shares: {}, usedTickets: [], frozen: {}, audit: [] });
const escrow = load(ESCROW_FILE, {
  note: "MOCK independent Swiss notary escrow copy of Part B (and the card-encrypted Part C). Released only on a court-confirmed cessation of Swissquote.",
  shares: {},
});

// Shares from the earlier Shamir version of the wallet have no public key: they can't take part in
// MPC signing. Such wallets must be created again after `npm run reset`.
const legacy = Object.entries(db.shares).filter(([, r]) => !r.publicKey).map(([id]) => id);
if (legacy.length) {
  console.warn(`[vault] ⚠️  ${legacy.join(", ")}: stored by the earlier Shamir version of the wallet, not usable with the MPC wallet. Stop the demo and run \`npm run reset\`, then create the wallets again.`);
}

function save() {
  writeJsonAtomic(DB_FILE, db);
  writeJsonAtomic(ESCROW_FILE, escrow);
}

function audit(event, clientId, detail = {}) {
  db.audit.unshift({ at: new Date().toISOString(), event, clientId, ...detail });
  db.audit = db.audit.slice(0, 200);
  save();
  console.log(`[vault] ${event} ${clientId ?? ""} ${JSON.stringify(detail)}`);
}

function verifyTicket(ticket, purpose) {
  if (!ticket || typeof ticket !== "string" || !ticket.includes(".")) throw new Error("missing ticket");
  const [body, mac] = ticket.split(".");
  const expected = crypto.createHmac("sha256", TICKET_SECRET).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    throw new Error("ticket signature invalid");
  }
  const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (t.purpose !== purpose) throw new Error("ticket purpose mismatch");
  if (Date.now() > t.exp) throw new Error("ticket expired");
  if (db.usedTickets.includes(t.jti)) throw new Error("ticket already used");
  return t;
}

function consume(t) {
  db.usedTickets.push(t.jti);
  db.usedTickets = db.usedTickets.slice(-1000);
}

// ---------------- MPC sessions ----------------
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const unb64 = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));
const toWire = (m) => ({ from: m.from_id, to: m.to_id ?? null, payload: b64(m.payload) });
// Only messages from the device's parties that are broadcast or addressed to Part B.
const incoming = (wires) =>
  (Array.isArray(wires) ? wires : [])
    .filter((w) => w.from !== SWISSQUOTE && (w.to === null || w.to === undefined || w.to === SWISSQUOTE))
    .map((w) => new Message(unb64(w.payload), w.from, w.to ?? undefined));

const sessions = new Map(); // sid -> { kind, clientId, session, stage, hash?, recoveryId?, oldShare?, exp }

function openSession(state) {
  const sid = crypto.randomUUID();
  sessions.set(sid, { ...state, stage: 1, exp: Date.now() + SESSION_TTL_MS });
  return sid;
}

function dropSession(sid) {
  const s = sessions.get(sid);
  sessions.delete(sid);
  try {
    s?.session.free();
  } catch {
    /* already consumed */
  }
}

setInterval(() => {
  for (const [sid, s] of sessions) if (Date.now() > s.exp) dropSession(sid);
}, 60_000).unref();

const shareOf = (clientId) => {
  const rec = db.shares[clientId];
  if (!rec?.share) throw new Error("no share on file");
  if (!rec.publicKey) throw new Error("this wallet was created with the earlier Shamir version; reset the demo data and create it again");
  return rec;
};

// Stores the new Part B (and the client's card-encrypted Part C, which the vault cannot read) and
// mirrors both to the notary escrow.
function storeShare(clientId, keyshare, encC, event, detail = {}) {
  const prev = db.shares[clientId];
  const rec = {
    share: b64(keyshare.toBytes()),
    publicKey: Buffer.from(keyshare.publicKey).toString("hex"),
    encC,
    depositedAt: new Date().toISOString(),
    version: (prev?.version || 0) + 1,
  };
  db.shares[clientId] = rec;
  escrow.shares[clientId] = { share: rec.share, publicKey: rec.publicKey, encC, depositedAt: rec.depositedAt };
  audit(event, clientId, { version: rec.version, ...detail });
  return rec;
}

function checkEncC(encC) {
  if (!encC || typeof encC !== "object" || typeof encC.ct !== "string" || typeof encC.iv !== "string" || encC.ct.length > 2_000_000) {
    throw new Error("missing card-encrypted Part C");
  }
  return { v: encC.v, alg: String(encC.alg || ""), iv: encC.iv, ct: encC.ct };
}

// Keygen and recovery share the same four rounds; signing has its own three.
function keygenRound(sid, state, body) {
  const msgs = incoming(body.messages);
  switch (state.stage++) {
    case 1:
      return { messages: state.session.handleMessages(msgs).map(toWire), commitment: b64(state.session.calculateChainCodeCommitment()) };
    case 2:
      return { messages: state.session.handleMessages(msgs).map(toWire) };
    case 3: {
      if (!Array.isArray(body.commitments) || body.commitments.length !== 3) throw new Error("expected 3 chain-code commitments");
      return { messages: state.session.handleMessages(msgs, body.commitments.map(unb64)).map(toWire) };
    }
    case 4: {
      const encC = checkEncC(body.encC);
      state.session.handleMessages(msgs);
      const keyshare = state.session.keyshare();
      dropSession(sid);
      if (state.kind === "keygen") {
        const rec = storeShare(state.clientId, keyshare, encC, db.shares[state.clientId] ? "share-replaced" : "share-created");
        return { publicKey: rec.publicKey, version: rec.version };
      }
      if (Buffer.from(keyshare.publicKey).toString("hex") !== state.publicKey) throw new Error("refreshed share has a different public key");
      const rec = storeShare(state.clientId, keyshare, encC, "share-refreshed", { recoveryId: state.recoveryId, lost: state.lost });
      return { publicKey: rec.publicKey, version: rec.version };
    }
    default:
      throw new Error("protocol already finished");
  }
}

function signRound(sid, state, body) {
  const msgs = incoming(body.messages);
  switch (state.stage++) {
    case 1:
    case 2:
      return { messages: state.session.handleMessages(msgs).map(toWire) };
    case 3: {
      state.session.handleMessages(msgs);
      const last = state.session.lastMessage(unb64(state.hash)); // single use: the session ends here
      dropSession(sid);
      audit("co-signed", state.clientId, { hash: Buffer.from(unb64(state.hash)).toString("hex").slice(0, 16), purpose: state.what });
      return { messages: [toWire(last)] };
    }
    default:
      throw new Error("protocol already finished");
  }
}

const app = express();
app.use(express.json({ limit: "8mb" })); // DKLs keygen rounds and the encrypted Part C are a few hundred KB

app.get("/health", (_req, res) => res.json({ ok: true, service: "share-vault (MOCK, MPC party B)", shares: Object.keys(db.shares).length }));

// Public key of the client's wallet, so the bank can check the address it links.
app.get("/v1/keys/:clientId", (req, res) => {
  const rec = db.shares[req.params.clientId];
  if (!rec) return res.status(404).json({ error: "no key on file" });
  res.json({ publicKey: rec.publicKey, version: rec.version });
});

// What a device restoring the wallet with its synced passkey needs besides the bank's encrypted
// Part A: the public key, the current version and the card-encrypted Part C (only the card opens it).
app.post("/v1/keys/:clientId/restore", (req, res) => {
  try {
    const t = verifyTicket(req.body.ticket, "restore");
    if (t.clientId !== req.params.clientId) throw new Error("ticket is for another client");
    const rec = shareOf(t.clientId);
    res.json({ publicKey: rec.publicKey, version: rec.version, encC: rec.encC });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

// Create the key with the client's device. Allowed only with a keygen ticket (wallet not active yet).
app.post("/v1/keygen/start", (req, res) => {
  try {
    const t = verifyTicket(req.body.ticket, "keygen");
    consume(t);
    const session = new KeygenSession(3, 2, SWISSQUOTE);
    const first = toWire(session.createFirstMessage());
    const sessionId = openSession({ kind: "keygen", clientId: t.clientId, session });
    audit("keygen-started", t.clientId);
    res.json({ sessionId, messages: [first] });
  } catch (e) {
    audit("keygen-refused", undefined, { reason: e.message });
    res.status(403).json({ error: e.message });
  }
});

// Co-sign one hash. The bank only issues the ticket after it rebuilt that hash from the payment it
// screened and the client approved it with their passkey.
app.post("/v1/sign/start", (req, res) => {
  let clientId;
  try {
    const t = verifyTicket(req.body.ticket, "sign");
    clientId = t.clientId;
    const rec = shareOf(clientId);
    if (t.version && t.version !== rec.version) throw new Error("this device holds an outdated part: the wallet was recovered elsewhere");
    consume(t);
    const session = new SignSession(Keyshare.fromBytes(unb64(rec.share)), "m");
    const first = toWire(session.createFirstMessage());
    const sessionId = openSession({ kind: "sign", clientId, session, hash: t.hash, what: t.what });
    save();
    res.json({ sessionId, messages: [first], hash: t.hash });
  } catch (e) {
    audit("sign-refused", clientId, { reason: e.message });
    res.status(403).json({ error: e.message });
  }
});

// Refresh all three parts after a recovery. `lost` is the client part the device no longer has:
// [0] when it recovers with the paper card (Part C), [2] when it has Part A (passkey or backup file).
// Same public key, same address; every old part stops working with the new Part B.
app.post("/v1/recovery/start", (req, res) => {
  let clientId;
  try {
    const t = verifyTicket(req.body.ticket, "recover");
    clientId = t.clientId;
    const frozenUntil = db.frozen[clientId];
    if (frozenUntil && Date.now() < frozenUntil) throw new Error(`recovery frozen until ${new Date(frozenUntil).toISOString()}`);
    if (Date.now() < t.notBefore) throw new Error(`time-lock active for another ${Math.ceil((t.notBefore - Date.now()) / 1000)}s`);
    const lost = Number(req.body.lost);
    if (lost !== 0 && lost !== 2) throw new Error("lost must be 0 (device part) or 2 (card part)");
    const rec = shareOf(clientId);
    consume(t);
    const session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(rec.share)), new Uint8Array([lost]));
    const first = toWire(session.createFirstMessage());
    const sessionId = openSession({ kind: "recover", clientId, session, recoveryId: t.recoveryId, publicKey: rec.publicKey, lost });
    audit("recovery-started", clientId, { recoveryId: t.recoveryId, lost });
    // The card-encrypted Part C goes back to the device: only the paper card can decrypt it.
    res.json({ sessionId, messages: [first], publicKey: rec.publicKey, encC: rec.encC });
  } catch (e) {
    audit("recovery-refused", clientId, { reason: e.message });
    res.status(403).json({ error: e.message });
  }
});

app.post("/v1/mpc/:sid", (req, res) => {
  const state = sessions.get(req.params.sid);
  if (!state) return res.status(404).json({ error: "unknown or finished session" });
  try {
    res.json(state.kind === "sign" ? signRound(req.params.sid, state, req.body) : keygenRound(req.params.sid, state, req.body));
  } catch (e) {
    // DKLs rounds consume state: a failed round can't be retried, the device starts over.
    dropSession(req.params.sid);
    audit(`${state.kind}-failed`, state.clientId, { reason: e.message });
    res.status(400).json({ error: e.message });
  }
});

// Freeze recovery after the client reports fraud (bank-signed instruction).
app.post("/v1/freeze", (req, res) => {
  try {
    const t = verifyTicket(req.body.ticket, "freeze");
    consume(t);
    db.frozen[t.clientId] = t.until;
    audit("recovery-frozen", t.clientId, { until: new Date(t.until).toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

app.get("/v1/audit", (_req, res) => res.json({ audit: db.audit.slice(0, 50) }));

const server = app.listen(PORT, () => console.log(`[vault] MOCK Share Vault (MPC party B) listening on http://localhost:${PORT} (storage: ${DB_FILE})`));
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[vault] Port ${PORT} is already in use. Another copy of the demo is probably still running: stop it (Ctrl+C in its window) or start this one with VAULT_PORT=<other port>.`);
    process.exit(1);
  }
  throw e;
});
