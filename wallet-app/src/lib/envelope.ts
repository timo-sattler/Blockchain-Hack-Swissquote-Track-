// AES-256-GCM envelopes. The key comes from one of two sources (WebCrypto only):
//   - "webauthn-prf": HKDF-SHA256 over the passkey's PRF output (Face ID / Touch ID / Windows Hello
//     with PRF support). Nothing to remember, nothing to brute-force.
//   - "pbkdf2-sha256": PBKDF2-SHA256 (600k iterations) over a wallet password, then the same HKDF.
//     Used when the device's passkey provider has no PRF extension (e.g. many Windows Hello setups).
import { fromB64url, toB64url, wipe } from "./bytes";

export type KeyPurpose = "part-a";
export type Kdf = "webauthn-prf" | "pbkdf2-sha256";
export type KeySource = { kind: "prf"; prf: Uint8Array } | { kind: "password"; password: string };

export interface Envelope {
  v: 1 | 2;
  alg: string;
  kdf?: Kdf; // absent on v1 envelopes, which are always webauthn-prf
  iter?: number;
  salt?: string;
  purpose: KeyPurpose;
  credentialId: string;
  iv: string;
  ct: string;
}

export const PBKDF2_ITERATIONS = 600_000;
export const kdfOf = (env: Envelope): Kdf => env.kdf ?? "webauthn-prf";

async function passwordIkm(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256));
}

async function keyFor(ikmBytes: Uint8Array, purpose: KeyPurpose): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", ikmBytes as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(`swissquote-wallet/${purpose}/v1`) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function seal(src: KeySource, purpose: KeyPurpose, credentialId: string, plaintext: Uint8Array, aad: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(aad);
  if (src.kind === "prf") {
    const key = await keyFor(src.prf, purpose);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext as BufferSource);
    return { v: 2, alg: "AES-256-GCM/HKDF-SHA256(WebAuthn-PRF)", kdf: "webauthn-prf", purpose, credentialId, iv: toB64url(iv), ct: toB64url(ct) };
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await passwordIkm(src.password, salt, PBKDF2_ITERATIONS);
  try {
    const key = await keyFor(ikm, purpose);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext as BufferSource);
    return {
      v: 2,
      alg: "AES-256-GCM/HKDF-SHA256(PBKDF2-SHA256)",
      kdf: "pbkdf2-sha256",
      iter: PBKDF2_ITERATIONS,
      salt: toB64url(salt),
      purpose,
      credentialId,
      iv: toB64url(iv),
      ct: toB64url(ct),
    };
  } finally {
    wipe(ikm);
  }
}

export async function open(src: KeySource, env: Envelope, aad: string): Promise<Uint8Array> {
  const kdf = kdfOf(env);
  if (kdf === "webauthn-prf" && src.kind !== "prf") throw new Error("This data is protected by a passkey, not a password.");
  if (kdf === "pbkdf2-sha256" && src.kind !== "password") throw new Error("This data is protected by a wallet password, not a passkey.");
  const ikm = src.kind === "prf" ? src.prf : await passwordIkm(src.password, fromB64url(env.salt || ""), env.iter || PBKDF2_ITERATIONS);
  try {
    const key = await keyFor(ikm, env.purpose);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(env.iv) as BufferSource, additionalData: new TextEncoder().encode(aad) },
      key,
      fromB64url(env.ct) as BufferSource
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error(src.kind === "prf" ? "Could not decrypt: this passkey does not match the one that protected this data." : "Wrong wallet password.");
  } finally {
    if (src.kind === "password") wipe(ikm);
  }
}
