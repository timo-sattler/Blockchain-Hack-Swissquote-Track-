// MOCK core-banking store. A JSON file stands in for Swissquote's client database.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.BANK_DATA_DIR || path.resolve(here, "../data"));
const DB_FILE = path.join(DATA_DIR, "bank.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

function seedClient(id, name, password, phone, email, chf, ethCustody) {
  const { salt, hash } = hashPassword(password);
  return {
    id,
    name,
    salt,
    passwordHash: hash,
    phone,
    email,
    kycPhoto: null,
    accounts: { chf, ethCustody },
    credentials: [],
    wallet: null,
    backupA: null,
    recoveryFrozenUntil: 0,
    createdAt: new Date().toISOString(),
  };
}

function seed() {
  return {
    clients: {
      "SQ-100234": seedClient("SQ-100234", "Anna Keller", "Demo-1234", "+41 79 555 12 34", "anna.keller@example.ch", 25000, 0.5),
      "SQ-100777": seedClient("SQ-100777", "Marco Rossi", "Demo-5678", "+41 78 555 77 77", "marco.rossi@example.ch", 8000, 0.2),
    },
    recoveries: {},
    notifications: [],
    outbox: [],
    activity: [],
  };
}

// Writes go to a temp file first and are then renamed over the real one, so a crash mid-write
// can never leave a half-written database behind.
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse the rename while another process (antivirus, editor) has the file open.
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.rmSync(tmp, { force: true });
  }
}

// Loads a JSON store. A missing file is seeded; an unreadable one is kept aside (never overwritten)
// so no client data is silently lost.
export function loadJson(file, makeDefault) {
  if (!fs.existsSync(file)) {
    const fresh = makeDefault();
    writeJsonAtomic(file, fresh);
    return fresh;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    const aside = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, aside);
    console.error(`[store] ${file} is unreadable (${e.message}). A copy was saved to ${aside}; starting from a fresh store.`);
    const fresh = makeDefault();
    writeJsonAtomic(file, fresh);
    return fresh;
  }
}

const db = loadJson(DB_FILE, seed);

export function getDb() {
  return db;
}

export function save() {
  writeJsonAtomic(DB_FILE, db);
}

export function getClient(id) {
  return db.clients[String(id || "").trim().toUpperCase()] || null;
}

export function notify(clientId, title, body, extra = {}) {
  const n = { id: crypto.randomUUID(), clientId, at: new Date().toISOString(), title, body, read: false, ...extra };
  db.notifications.unshift(n);
  db.notifications = db.notifications.slice(0, 500);
  const c = db.clients[clientId];
  if (c) {
    sendMock("push", "Swissquote app (all registered devices)", `${title}: ${body}`, clientId);
    sendMock("email", c.email, `${title}\n\n${body}`, clientId);
  }
  save();
  return n;
}

export function sendMock(channel, to, text, clientId) {
  const m = { id: crypto.randomUUID(), at: new Date().toISOString(), channel, to, text, clientId };
  db.outbox.unshift(m);
  db.outbox = db.outbox.slice(0, 300);
  console.log(`[bank][MOCK ${channel.toUpperCase()} -> ${to}] ${text.split("\n")[0]}`);
  save();
  return m;
}

export function logActivity(clientId, type, detail) {
  db.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), clientId, type, ...detail });
  db.activity = db.activity.slice(0, 500);
  save();
}

export function publicClient(c) {
  return {
    id: c.id,
    name: c.name,
    phoneMasked: c.phone.replace(/\d(?=(?:\D*\d){4})/g, "•"),
    emailMasked: c.email.replace(/^(.).*(@.*)$/, "$1•••$2"),
    accounts: c.accounts,
    wallet: c.wallet,
    hasKycPhoto: Boolean(c.kycPhoto),
    hasBackupA: Boolean(c.backupA),
    credentials: c.credentials.map((k) => ({ id: k.id, deviceLabel: k.deviceLabel, createdAt: k.createdAt, revoked: Boolean(k.revoked), lastUsedAt: k.lastUsedAt })),
    recoveryFrozenUntil: c.recoveryFrozenUntil,
  };
}
