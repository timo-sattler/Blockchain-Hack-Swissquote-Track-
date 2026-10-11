// What this device keeps: public info, MPC Part A encrypted under the passkey's PRF key (or the
// wallet password on devices without PRF), and Part C encrypted under the paper Recovery Card
// (only the card opens it; it lets the device sign without Swissquote).
import type { EncC } from "./card";
import { kdfOf, type Envelope } from "./envelope";

// The client's own copy of their parts, to recover without this device. Part A needs the passkey
// or wallet password, Part C needs the paper card.
export interface BackupFile {
  kind: "swissquote-wallet/mpc-backup";
  version: 3;
  clientId: string;
  address: string;
  publicKey: string;
  createdAt: string;
  partA: Envelope;
  partC: EncC;
}

export interface Profile {
  clientId: string;
  name: string;
  address: string;
  btcAddress: string;
  publicKey: string; // hex, compressed
  credentialId: string;
  encA: Envelope;
  encC: EncC;
  keyVersion: number; // version of Part B at the vault this Part A belongs to
  createdAt: string;
}

export function backupFileOf(p: Profile): BackupFile {
  return { kind: "swissquote-wallet/mpc-backup", version: 3, clientId: p.clientId, address: p.address, publicKey: p.publicKey, createdAt: new Date().toISOString(), partA: p.encA, partC: p.encC };
}

export type KeyMode = "prf" | "password";
export const keyModeOf = (p: Profile): KeyMode => (kdfOf(p.encA) === "pbkdf2-sha256" ? "password" : "prf");

const KEY = "sq.wallet.profile.mpc.v1";

export function loadProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    throw new Error("This browser has no room to store your wallet (its two encrypted key parts need about 1 MB). Free up site storage and try again.");
  }
}

export function wipeDevice() {
  localStorage.removeItem(KEY);
  localStorage.removeItem("sq.deviceId");
  sessionStorage.clear();
}

export function deviceId(): string {
  let id = localStorage.getItem("sq.deviceId");
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem("sq.deviceId", id);
  }
  return id;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux PC"
                : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export const partAAad = (clientId: string, publicKey: string) => `part-a|${clientId}|${publicKey.toLowerCase()}`;
