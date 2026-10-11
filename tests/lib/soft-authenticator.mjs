// A software passkey authenticator for the API tests: real ES256 credentials, "none" attestation,
// user verification flagged. The bank verifies its responses with the same SimpleWebAuthn code it
// uses for browsers. Node has no PRF, so the tests keep Part A in memory instead.
import crypto from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64url");

// Minimal CBOR encoder: unsigned/negative ints, byte strings, text, maps (string or int keys).
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export function softAuthenticator(origin = "http://localhost:5173") {
  const rpId = new URL(origin).hostname;
  const rpIdHash = crypto.createHash("sha256").update(rpId).digest();
  const creds = new Map(); // id -> { privateKey, counter, userHandle }

  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    origin,
    ids: () => [...creds.keys()],
    forget(id) {
      creds.delete(id);
    },

    register(options) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = publicKey.export({ format: "jwk" });
      const id = crypto.randomBytes(16);
      creds.set(b64(id), { privateKey, counter: 0, userHandle: options.user.id });
      const cose = new Map([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
      ]);
      const counter = Buffer.alloc(4);
      const idLen = Buffer.from([0, id.length]);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x45]), counter, Buffer.alloc(16), idLen, id, cbor(cose)]); // UP | UV | AT
      const attestationObject = cbor({ fmt: "none", attStmt: {}, authData: new Uint8Array(authData) });
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData("webauthn.create", options.challenge)), attestationObject: b64(attestationObject), transports: ["internal"] },
      };
    },

    assert(options) {
      const allowed = (options.allowCredentials || []).map((c) => c.id);
      const id = allowed.find((a) => creds.has(a)) ?? (allowed.length ? null : [...creds.keys()][0]);
      if (!id) throw new Error("this authenticator holds none of the allowed passkeys");
      const cred = creds.get(id);
      cred.counter++;
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(cred.counter);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), counter]); // UP | UV
      const cd = clientData("webauthn.get", options.challenge);
      const signature = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(cd).digest()]), cred.privateKey);
      return {
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: { clientDataJSON: b64(cd), authenticatorData: b64(authData), signature: b64(signature), userHandle: cred.userHandle },
      };
    },
  };
}
