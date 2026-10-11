// Real WebAuthn (passkey) verification using @simplewebauthn/server.
import crypto from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const challenges = new Map(); // challenge -> { clientId, purpose, intentHash, exp, rpID, origin }

// The RP ID follows whatever HTTPS host the app is served from (localhost, LAN tunnel, ...).
// Production pins this to wallet.swissquote.com.
export function rpFromRequest(req) {
  const origin = req.headers.origin;
  if (!origin) throw new Error("missing Origin header");
  const url = new URL(origin);
  if (/^[\d.]+$|^\[/.test(url.hostname)) throw new Error("Passkeys don't work on an IP address. Open the app via http://localhost:5173 or its https link.");
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !local) throw new Error(`Passkeys need https or http://localhost (this page is ${origin}).`);
  return { origin, rpID: url.hostname };
}

function remember(challenge, data) {
  challenges.set(challenge, { ...data, exp: Date.now() + 5 * 60_000 });
}

function take(challenge) {
  const c = challenges.get(challenge);
  challenges.delete(challenge);
  if (!c || Date.now() > c.exp) throw new Error("challenge unknown or expired");
  return c;
}

function challengeOf(response) {
  const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
  return clientData.challenge;
}

export async function registrationOptions(req, client) {
  const { rpID, origin } = rpFromRequest(req);
  const options = await generateRegistrationOptions({
    rpName: "Swissquote Wallet",
    rpID,
    userName: client.id,
    userDisplayName: `${client.name} (${client.id})`,
    userID: new TextEncoder().encode(client.id),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // No excludeCredentials: re-protecting a wallet (retry after a failed setup, or after a
    // recovery on a device that still holds the old synced passkey) must be able to replace the
    // passkey on the same authenticator instead of failing with InvalidStateError.
  });
  remember(options.challenge, { clientId: client.id, purpose: "register", rpID, origin });
  return options;
}

export async function verifyRegistration(req, client, response, deviceLabel) {
  const { rpID, origin } = rpFromRequest(req);
  const ch = take(challengeOf(response));
  if (ch.clientId !== client.id || ch.purpose !== "register") throw new Error("challenge mismatch");
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: (c) => c === challengeOf(response),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new Error("passkey registration not verified");
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  const rec = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports || response.response.transports || [],
    rpID,
    deviceLabel: String(deviceLabel || "Unknown device").slice(0, 80),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt: new Date().toISOString(),
  };
  client.credentials.push(rec);
  return rec;
}

export function intentHash(intent) {
  return crypto.createHash("sha256").update(JSON.stringify(intent)).digest("base64url");
}

export async function authenticationOptions(req, client, purpose, intent) {
  const { rpID, origin } = rpFromRequest(req);
  const allow = client.credentials.filter((k) => !k.revoked && k.rpID === rpID);
  if (!allow.length) {
    const elsewhere = client.credentials.some((k) => !k.revoked);
    throw Object.assign(
      new Error(
        elsewhere
          ? `No passkey for this client was created on ${rpID}. Passkeys are tied to the web address they were made on: open the app on the same address, or recover the wallet here.`
          : "No active passkey is registered for this client. Recover the wallet to set up a new one."
      ),
      { status: 409 }
    );
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: allow.map((k) => ({ id: k.id, transports: k.transports })),
  });
  remember(options.challenge, { clientId: client.id, purpose, intentHash: intent ? intentHash(intent) : null, rpID, origin });
  return options;
}

export async function verifyAuthentication(req, client, response, purpose) {
  const { rpID, origin } = rpFromRequest(req);
  const ch = take(challengeOf(response));
  if (ch.clientId !== client.id || ch.purpose !== purpose) throw new Error("challenge mismatch");
  const cred = client.credentials.find((k) => k.id === response.id);
  if (!cred) throw new Error("unknown passkey");
  if (cred.revoked) throw new Error("this passkey/device was reported lost and is revoked");
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: (c) => c === challengeOf(response),
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, "base64url"), counter: cred.counter, transports: cred.transports },
    requireUserVerification: true,
  });
  if (!v.verified) throw new Error("passkey assertion not verified");
  cred.counter = v.authenticationInfo.newCounter;
  cred.lastUsedAt = new Date().toISOString();
  return { cred, intentHash: ch.intentHash };
}
