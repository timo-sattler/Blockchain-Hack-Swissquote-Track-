// Sending from the MPC wallet. Trust Wallet Core builds the transaction (or, for gasless stablecoin
// transfers, the EIP-3009 authorization) and computes the hash; Swissquote rebuilds the same hash,
// screens the recipient and, after the client's passkey approval, lets the vault co-sign it with
// Part A. Without Swissquote, Part A and the card-protected Part C sign on the device instead.
import { bank, type MockDelivery, type PublicConfig } from "./api";
import { wipe } from "./bytes";
import { openPartC } from "./card";
import type { KeySource } from "./envelope";
import { broadcast, prepareFees } from "./eth";
import { openPartA, wipeSource } from "./keys";
import { hexOf, signLocally, signWithVault } from "./mpc";
import type { Profile } from "./profile";
import { compileTx, finishSignature, preImageHash, signatureHex, txForBank, typedDataHash, type EthTx } from "./walletcore";

export type Asset = "ETH" | "USDC" | "EURC";

export interface Authorization {
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface Draft {
  asset: Asset;
  to: string;
  amount: bigint;
  gasless: boolean;
  tx?: EthTx;
  maxFeeWei?: bigint; // what the client pays in ETH (0 when Swissquote pays)
  authorization?: Authorization;
  hash: Uint8Array;
}

const pkBytes = (profile: Profile) => Uint8Array.from(profile.publicKey.match(/../g)!.map((h) => parseInt(h, 16)));

// Builds the transaction or authorization and its hash; nothing is signed yet.
export async function draftPayment(profile: Profile, cfg: PublicConfig, asset: Asset, to: string, amount: bigint, gasless: boolean): Promise<Draft> {
  const token = asset === "ETH" ? null : cfg.tokens[asset];
  if (asset !== "ETH" && !token) throw new Error(`${asset} is not available on ${cfg.network.name}.`);
  if (gasless && token) {
    const now = Math.floor(Date.now() / 1000);
    const authorization: Authorization = {
      to,
      value: amount.toString(),
      validAfter: "0",
      validBefore: String(now + 600), // valid for 10 minutes, usable once (random nonce)
      nonce: `0x${hexOf(crypto.getRandomValues(new Uint8Array(32)))}`,
    };
    const json = JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      domain: { name: token.name, version: token.version, chainId: cfg.chainId, verifyingContract: token.address },
      message: { from: profile.address, ...authorization },
    });
    return { asset, to, amount, gasless: true, authorization, maxFeeWei: 0n, hash: await typedDataHash(json) };
  }
  const tx: EthTx = { chainId: cfg.chainId, to, amount, nonce: 0n, gasLimit: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, ...(token ? { token: token.address } : {}) };
  const data = token ? (await txForBank(tx)).data : undefined;
  const fees = await prepareFees(profile.address, token ? token.address : to, token ? 0n : amount, data);
  Object.assign(tx, { nonce: fees.nonce, gasLimit: fees.gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  return { asset, to, amount, gasless: false, tx, maxFeeWei: fees.maxFeeWei, hash: await preImageHash(tx) };
}

export interface Prepared {
  options: unknown;
  intent: { hash: string; to: string; amount: string; asset: string; kind: string };
  otpRequired: boolean;
  mockDelivery: MockDelivery | null;
}

// Swissquote rebuilds the hash from what it was sent, screens the recipient and binds both into
// the passkey challenge. The device refuses if Swissquote's hash differs from its own.
export async function prepareWithBank(draft: Draft): Promise<Prepared> {
  const body = draft.gasless
    ? { kind: "gasless", asset: draft.asset, authorization: draft.authorization }
    : { kind: "transfer", asset: draft.asset, tx: await txForBank(draft.tx!) };
  const r = await bank<Prepared>("/tx/prepare", "POST", body);
  if (r.intent.hash.toLowerCase() !== `0x${hexOf(draft.hash)}`) throw new Error("Swissquote computed a different transaction than this device. Aborted.");
  return r;
}

export interface Sent {
  hash: string;
  sponsored: boolean;
}

// After the passkey approval (and SMS code for high-value payments): ticket, co-sign, send.
export async function approveAndSend(profile: Profile, draft: Draft, approval: { response: unknown; otp?: string }, src: KeySource, onStatus: (s: string) => void, tier: string): Promise<Sent> {
  onStatus("Swissquote is checking your approval…");
  let ticket: string;
  try {
    ticket = (await bank<{ ticket: string }>("/tx/approve", "POST", { response: approval.response, otp: approval.otp, version: profile.keyVersion })).ticket;
  } catch (e) {
    wipeSource(src);
    throw e;
  }
  onStatus("Decrypting Part A on this device…");
  let partA: Uint8Array;
  try {
    partA = await openPartA(profile, src);
  } finally {
    wipeSource(src);
  }
  let full: Uint8Array;
  try {
    onStatus("Co-signing with Swissquote's Share Vault (MPC)…");
    full = await finishSignature(draft.hash, await signWithVault(partA, ticket, draft.hash), profile.address);
  } finally {
    wipe(partA);
  }
  return submit(profile, draft, full, onStatus, tier);
}

// Self-custody without Swissquote: Part A + Part C (opened with the paper card), on this device.
export async function signOffline(profile: Profile, draft: Draft, src: KeySource, words: string, onStatus: (s: string) => void): Promise<Sent> {
  if (draft.gasless) throw new Error("Free transfers need Swissquote. Pay the network fee yourself.");
  onStatus("Opening your parts with your passkey and Recovery Card…");
  let partA: Uint8Array | null = null;
  let partC: Uint8Array | null = null;
  try {
    partA = await openPartA(profile, src);
    partC = await openPartC(profile.encC, words, profile.clientId, pkBytes(profile));
    onStatus("Signing with Part A + Part C on this device…");
    const full = await finishSignature(draft.hash, await signLocally(partA, partC, draft.hash), profile.address);
    return await submit(profile, draft, full, onStatus, "standard", true);
  } finally {
    wipeSource(src);
    wipe(partA, partC);
  }
}

async function submit(profile: Profile, draft: Draft, full: Uint8Array, onStatus: (s: string) => void, tier: string, offline = false): Promise<Sent> {
  if (draft.gasless) {
    onStatus("Swissquote submits your transfer and pays the network fee…");
    const r = await bank<{ hash: string }>("/relay", "POST", { hash: `0x${hexOf(draft.hash)}`, signature: signatureHex(full) });
    return { hash: r.hash, sponsored: true };
  }
  onStatus("Compiling the transaction with Trust Wallet Core…");
  const raw = await compileTx(draft.tx!, full, pkBytes(profile));
  onStatus("Broadcasting…");
  const hash = await broadcast(raw);
  if (!offline) bank("/tx/report", "POST", { hash, to: draft.to, asset: draft.asset, amount: draft.amount.toString(), tier }).catch(() => {});
  return { hash, sponsored: false };
}
