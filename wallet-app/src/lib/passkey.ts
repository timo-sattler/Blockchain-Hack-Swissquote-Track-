// WebAuthn passkeys with the PRF extension. Face ID / Touch ID / Windows Hello / fingerprint
// unlocks the passkey; the passkey's PRF output (never leaves the authenticator unless user
// verification succeeded) is the root of the AES keys that protect the seed on this device and
// Share A in the bank's backup storage. Providers without PRF fall back to a wallet password.
import { fromB64url, toB64url } from "./bytes";

export class PrfUnsupportedError extends Error {
  constructor() {
    super("This passkey can't derive an encryption key (no WebAuthn PRF support). Use the wallet password instead, or another passkey provider.");
  }
}

let saltCache: Uint8Array | null = null;
async function prfSalt(): Promise<Uint8Array> {
  if (!saltCache) saltCache = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("swissquote-wallet/prf-salt/v1")));
  return saltCache;
}

type CredDescriptorJSON = { id: string; type?: string; transports?: string[] };

export interface PasskeyResult {
  json: Record<string, unknown>;
  prf: Uint8Array | null;
  credentialId: string;
}

export interface CreatedPasskey extends PasskeyResult {
  // false: the provider said it can't do PRF. undefined: unknown until we try a get().
  prfEnabled: boolean | undefined;
}

function prfOf(cred: PublicKeyCredential): Uint8Array | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (cred.getClientExtensionResults() as any)?.prf?.results?.first;
  return r ? new Uint8Array(r) : null;
}

function descriptors(list: CredDescriptorJSON[] = []): PublicKeyCredentialDescriptor[] {
  return list.map((c) => ({ id: fromB64url(c.id) as BufferSource, type: "public-key", transports: c.transports as AuthenticatorTransport[] }));
}

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
}

// What the user will see when the passkey prompt appears on this device.
export function authName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "Face ID";
  if (/iPad/.test(ua)) return "Touch ID / Face ID";
  if (/Android/.test(ua)) return "fingerprint";
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Mac OS X/.test(ua)) return "Touch ID";
  return "your passkey";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createPasskey(opts: any): Promise<CreatedPasskey> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: opts.rp,
    user: { ...opts.user, id: fromB64url(opts.user.id) as BufferSource },
    challenge: fromB64url(opts.challenge) as BufferSource,
    pubKeyCredParams: opts.pubKeyCredParams,
    timeout: opts.timeout,
    attestation: opts.attestation,
    authenticatorSelection: opts.authenticatorSelection,
    excludeCredentials: descriptors(opts.excludeCredentials),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensions: { prf: { eval: { first: await prfSalt() } } } as any,
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw Object.assign(new Error("Passkey creation was cancelled"), { name: "NotAllowedError" });
  const resp = cred.response as AuthenticatorAttestationResponse;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = cred.getClientExtensionResults() as any;
  return {
    credentialId: cred.id,
    prf: prfOf(cred),
    prfEnabled: typeof ext?.prf?.enabled === "boolean" ? ext.prf.enabled : undefined,
    json: {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toB64url(resp.clientDataJSON),
        attestationObject: toB64url(resp.attestationObject),
        transports: resp.getTransports?.() ?? [],
      },
    },
  };
}

// Authenticate with a passkey and evaluate PRF in the same ceremony (one biometric prompt).
// Pass server options for bank-verified logins/approvals, or just credential IDs for local use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPasskey(args: { serverOptions?: any; credentialIds?: string[] }): Promise<PasskeyResult> {
  const o = args.serverOptions;
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: (o ? fromB64url(o.challenge) : crypto.getRandomValues(new Uint8Array(32))) as BufferSource,
    rpId: o?.rpId ?? location.hostname,
    timeout: o?.timeout ?? 60000,
    userVerification: "required",
    allowCredentials: descriptors(o?.allowCredentials ?? (args.credentialIds || []).map((id) => ({ id, type: "public-key" }))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensions: { prf: { eval: { first: await prfSalt() } } } as any,
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw Object.assign(new Error("The passkey prompt was cancelled"), { name: "NotAllowedError" });
  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    credentialId: cred.id,
    prf: prfOf(cred),
    json: {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toB64url(resp.clientDataJSON),
        authenticatorData: toB64url(resp.authenticatorData),
        signature: toB64url(resp.signature),
        userHandle: resp.userHandle ? toB64url(resp.userHandle) : undefined,
      },
    },
  };
}

export function requirePrf(r: PasskeyResult): Uint8Array {
  if (!r.prf) throw new PrfUnsupportedError();
  return r.prf;
}
