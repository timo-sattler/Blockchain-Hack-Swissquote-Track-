import crypto from "node:crypto";
import { hashPassword, sendMock } from "./store.mjs";

export const TICKET_SECRET = process.env.SQ_VAULT_TICKET_SECRET || "dev-only-shared-ticket-secret-change-me";
export const SHOW_OTP_IN_APP = process.env.DEMO_SHOW_OTP !== "0";

export function checkPassword(client, password) {
  const { hash } = hashPassword(String(password || ""), client.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(client.passwordHash, "hex"));
}

// ---- Password brute-force protection ----
const failures = new Map(); // clientId -> { count, lockedUntil }
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

export function loginLockedFor(clientId) {
  const f = failures.get(clientId);
  return f && f.lockedUntil > Date.now() ? Math.ceil((f.lockedUntil - Date.now()) / 1000) : 0;
}

export function recordLoginFailure(clientId) {
  const f = failures.get(clientId) || { count: 0, lockedUntil: 0 };
  f.count++;
  if (f.count >= MAX_FAILURES) {
    f.count = 0;
    f.lockedUntil = Date.now() + LOCK_MS;
  }
  failures.set(clientId, f);
}

export const clearLoginFailures = (clientId) => failures.delete(clientId);

// ---- One-time codes (MOCK SMS gateway) ----
const otps = new Map(); // key -> { code, exp, attempts }

export function issueOtp(key, client, purpose) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  otps.set(key, { code, exp: Date.now() + 5 * 60_000, attempts: 0 });
  sendMock("sms", client.phone, `Swissquote: your code for ${purpose} is ${code}. Never share it.`, client.id);
  return SHOW_OTP_IN_APP ? { channel: "sms", to: client.phone.replace(/\d(?=(?:\D*\d){4})/g, "•"), code } : { channel: "sms" };
}

export function checkOtp(key, code) {
  const rec = otps.get(key);
  if (!rec || Date.now() > rec.exp) return false;
  rec.attempts++;
  if (rec.attempts > 5) {
    otps.delete(key);
    return false;
  }
  const ok = rec.code === String(code || "").trim();
  if (ok) otps.delete(key);
  return ok;
}

// ---- Sessions (expire after 30 minutes without activity) ----
const sessions = new Map(); // token -> { clientId, kind, deviceId, lastSeen, credentialId }
const SESSION_IDLE_MS = 30 * 60_000;

export function createSession(clientId, kind, deviceId, extra = {}) {
  const token = crypto.randomBytes(24).toString("base64url");
  sessions.set(token, { clientId, kind, deviceId: String(deviceId || "unknown-device"), createdAt: Date.now(), lastSeen: Date.now(), ...extra });
  return token;
}

export function getSession(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(token);
    return null;
  }
  s.lastSeen = Date.now();
  return s;
}

export function revokeSessionsForCredential(credentialId) {
  for (const [t, s] of sessions) if (s.credentialId === credentialId) sessions.delete(t);
}

// ---- Tickets for the Share Vault (HMAC, same format the vault verifies) ----
export function signTicket(payload) {
  const body = Buffer.from(JSON.stringify({ jti: crypto.randomUUID(), ...payload })).toString("base64url");
  const mac = crypto.createHmac("sha256", TICKET_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
