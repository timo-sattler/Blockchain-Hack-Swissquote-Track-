// The paper Recovery Card. Part C of the MPC key is a few hundred KB, too big for paper, so the card
// holds the 256-bit key that encrypts it, written as 24 BIP39 words (Trust Wallet Core adds a
// checksum word, so typos are caught). The encrypted Part C is kept by the vault (and its notary
// escrow), in the client's backup file and on each device; only the card decrypts it.
import { fromB64url, toB64url, wipe } from "./bytes";
import { entropyOfMnemonic, mnemonicOf } from "./walletcore";
import { hexOf } from "./mpc";

export interface EncC {
  v: 1;
  alg: string;
  iv: string;
  ct: string;
}

const aad = (clientId: string, publicKey: Uint8Array) => new TextEncoder().encode(`part-c|${clientId}|${hexOf(publicKey)}`);

async function aesKey(cardKey: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", cardKey as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("swissquote-wallet/part-c/v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export const newCardKey = () => crypto.getRandomValues(new Uint8Array(32));

export async function sealPartC(partC: Uint8Array, cardKey: Uint8Array, clientId: string, publicKey: Uint8Array): Promise<EncC> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(clientId, publicKey) }, await aesKey(cardKey), partC as BufferSource);
  return { v: 1, alg: "AES-256-GCM/HKDF-SHA256(recovery-card)", iv: toB64url(iv), ct: toB64url(ct) };
}

export async function openPartC(encC: EncC, words: string, clientId: string, publicKey: Uint8Array): Promise<Uint8Array> {
  const cardKey = await entropyOfMnemonic(words);
  try {
    if (cardKey.length !== 32) throw new Error("A Recovery Card has exactly 24 words");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(encC.iv) as BufferSource, additionalData: aad(clientId, publicKey) },
      await aesKey(cardKey),
      fromB64url(encC.ct) as BufferSource
    );
    return new Uint8Array(pt);
  } catch (e) {
    if ((e as Error).message.includes("24 words")) throw e;
    throw new Error("These words don't open your recovery part. Check the order, or use your newest Recovery Card (every recovery issues a new one).");
  } finally {
    wipe(cardKey);
  }
}

export interface PaperCard {
  words: string[];
}

export async function cardOf(cardKey: Uint8Array): Promise<PaperCard> {
  return { words: (await mnemonicOf(cardKey)).split(" ") };
}

export function cardText(card: PaperCard, clientId: string, address: string): string {
  return [
    "SWISSQUOTE WALLET — RECOVERY CARD",
    "=================================",
    `Client: ${clientId}`,
    `Wallet: ${address}`,
    "",
    ...card.words.map((w, i) => `${String(i + 1).padStart(2, " ")}. ${w}`),
    "",
    "These words unlock Part C, one of the three parts of your wallet's key. On their own they can't move your funds.",
    "Together with Swissquote (after an identity check) or with one of your devices, they restore your wallet.",
    "Keep the card offline, e.g. in a safe. Do not photograph it. Never type it anywhere except the Swissquote Wallet app or the open-source recovery tool.",
  ].join("\n");
}

export function parseCardText(text: string): string | null {
  const words = [...text.matchAll(/^\s*\d+\.\s+([a-z]+)\s*$/gim)].map((m) => m[1]);
  return words.length === 24 ? words.join(" ") : null;
}
