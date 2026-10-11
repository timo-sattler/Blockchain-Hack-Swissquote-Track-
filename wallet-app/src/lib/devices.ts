// More devices: identical copies of Part A. The device that has the wallet encrypts Part A with a
// one-time key; Swissquote relays the ciphertext, and the key travels only inside the link's URL
// fragment (never sent to a server), so Swissquote relays a copy it cannot read. Whoever opens the
// link within 10 minutes and logs in as the client can add one device: show it only as a QR code.
import { bank } from "./api";
import { fromB64url, toB64url, wipe } from "./bytes";
import type { EncC } from "./card";
import type { KeySource } from "./envelope";
import { openPartA, wipeSource } from "./keys";
import type { Profile } from "./profile";

export interface DeviceLink {
  clientId: string;
  inviteToken: string;
  key: Uint8Array;
}

export async function createInvite(profile: Profile, src: KeySource): Promise<{ link: string; expires: number }> {
  let partA: Uint8Array;
  try {
    partA = await openPartA(profile, src);
  } finally {
    wipeSource(src);
  }
  const key = crypto.getRandomValues(new Uint8Array(32));
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, partA as BufferSource));
    const packed = new Uint8Array(12 + sealed.length);
    packed.set(iv);
    packed.set(sealed, 12);
    const { inviteToken, expires } = await bank<{ inviteToken: string; expires: number }>("/devices/invite", "POST", {
      sealedShare: toB64url(packed),
      encC: profile.encC,
      version: profile.keyVersion,
      publicKey: profile.publicKey,
    });
    return { link: `${location.origin}${location.pathname}#add-device=${profile.clientId}.${inviteToken}.${toB64url(key)}`, expires };
  } finally {
    wipe(partA, key);
  }
}

export function parseDeviceLink(hash: string): DeviceLink | null {
  const m = /^#add-device=([A-Z0-9-]+)\.([0-9a-f-]{36})\.([\w-]{43})$/i.exec(hash);
  if (!m) return null;
  try {
    return { clientId: m[1].toUpperCase(), inviteToken: m[2], key: fromB64url(m[3]) };
  } catch {
    return null;
  }
}

export interface JoinResult {
  sealedShare: string;
  encC: EncC;
  version: number;
  publicKey: string;
  wallet: { address: string };
}

export async function openInvite(link: DeviceLink, joined: JoinResult): Promise<Uint8Array> {
  const packed = fromB64url(joined.sealedShare);
  const aes = await crypto.subtle.importKey("raw", link.key as BufferSource, "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, aes, packed.slice(12)));
  } catch {
    throw new Error("The link is incomplete: copy the whole link, or scan the QR code again.");
  }
}
