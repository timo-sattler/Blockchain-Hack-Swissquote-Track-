// Trust Wallet Core (WASM): addresses, transaction building, the hashes to sign, and compiling
// signed transactions. The key itself is an MPC key (see mpc.ts), so wallet-core never holds a
// private key: it produces the pre-image hash, the parts co-sign it, and wallet-core compiles the
// signature into the final transaction (TransactionCompiler).
import { initWasm, TW, type WalletCore } from "@trustwallet/wallet-core";
import { bigToBytes } from "./bytes";
import type { Signature } from "./mpc";

let corePromise: Promise<WalletCore> | null = null;
export function core(): Promise<WalletCore> {
  if (!corePromise) corePromise = initWasm();
  return corePromise;
}

const hex0x = (s: string) => (s.startsWith("0x") ? s : `0x${s}`);
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface Derived {
  address: string;
  btcAddress: string;
}

// The same public key gives an Ethereum and a Bitcoin address; both are controlled by the MPC parts.
export async function addressesOf(publicKey: Uint8Array): Promise<Derived> {
  const { PublicKey, PublicKeyType, AnyAddress, CoinType } = await core();
  const pk = PublicKey.createWithData(publicKey, publicKey.length === 33 ? PublicKeyType.secp256k1 : PublicKeyType.secp256k1Extended);
  const eth = AnyAddress.createWithPublicKey(pk, CoinType.ethereum);
  const btc = AnyAddress.createWithPublicKey(pk, CoinType.bitcoin);
  const out = { address: eth.description(), btcAddress: btc.description() };
  eth.delete();
  btc.delete();
  pk.delete();
  return out;
}

// 24 BIP39 words for 32 bytes (used for the paper Recovery Card's key) and back.
export async function mnemonicOf(entropy: Uint8Array): Promise<string> {
  const { HDWallet } = await core();
  const w = HDWallet.createWithEntropy(entropy, "");
  const m = w.mnemonic();
  w.delete();
  return m;
}

export async function entropyOfMnemonic(words: string): Promise<Uint8Array> {
  const { HDWallet, Mnemonic } = await core();
  const norm = words.trim().toLowerCase().split(/\s+/).join(" ");
  if (!Mnemonic.isValid(norm)) throw new Error("Those words are not valid (typo or wrong order?)");
  const w = HDWallet.createWithMnemonic(norm, "");
  const e = new Uint8Array(w.entropy());
  w.delete();
  return e;
}

export async function suggestWord(prefix: string): Promise<string> {
  const { Mnemonic } = await core();
  return prefix.length >= 2 ? Mnemonic.suggest(prefix.toLowerCase()) : "";
}

// ---------------- Hashes the MPC parts sign ----------------

// EIP-191 personal message (the Travel Rule ownership proof).
export async function personalMessageHash(message: string): Promise<Uint8Array> {
  const { Hash } = await core();
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix);
  all.set(body, prefix.length);
  return new Uint8Array(Hash.keccak256(all));
}

// EIP-712 typed data (gasless USDC / EURC authorizations).
export async function typedDataHash(json: string): Promise<Uint8Array> {
  const { EthereumAbi } = await core();
  return new Uint8Array(EthereumAbi.encodeTyped(json));
}

export interface EthTx {
  chainId: number;
  nonce: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  to: string; // recipient (ETH) or the recipient inside the token transfer
  amount: bigint; // wei, or the token's smallest unit
  token?: string; // ERC-20 contract for token transfers
}

function signingInput(tx: EthTx): Uint8Array {
  const P = TW.Ethereum.Proto;
  const input = P.SigningInput.create({
    chainId: bigToBytes(BigInt(tx.chainId)),
    nonce: bigToBytes(tx.nonce),
    txMode: P.TransactionMode.Enveloped,
    gasLimit: bigToBytes(tx.gasLimit),
    maxInclusionFeePerGas: bigToBytes(tx.maxPriorityFeePerGas),
    maxFeePerGas: bigToBytes(tx.maxFeePerGas),
    toAddress: tx.token ?? tx.to,
    transaction: P.Transaction.create(
      tx.token
        ? { erc20Transfer: P.Transaction.ERC20Transfer.create({ to: tx.to, amount: bigToBytes(tx.amount) }) }
        : { transfer: P.Transaction.Transfer.create({ amount: bigToBytes(tx.amount) }) }
    ),
  });
  return P.SigningInput.encode(input).finish();
}

// What Swissquote rebuilds and checks: the EIP-1559 fields as decimal strings plus call data.
export async function txForBank(tx: EthTx) {
  const { EthereumAbi, EthereumAbiFunction, HexCoding } = await core();
  let data = "0x";
  if (tx.token) {
    const fn = EthereumAbiFunction.createWithString("transfer");
    fn.addParamAddress(HexCoding.decode(tx.to), false);
    fn.addParamUInt256(bigToBytes(tx.amount), false);
    data = hex0x(HexCoding.encode(EthereumAbi.encode(fn)));
    fn.delete();
  }
  return {
    nonce: tx.nonce.toString(),
    gasLimit: tx.gasLimit.toString(),
    maxFeePerGas: tx.maxFeePerGas.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
    to: tx.token ?? tx.to,
    value: tx.token ? "0" : tx.amount.toString(),
    data,
  };
}

export async function preImageHash(tx: EthTx): Promise<Uint8Array> {
  const { TransactionCompiler, CoinType } = await core();
  const out = TW.TxCompiler.Proto.PreSigningOutput.decode(TransactionCompiler.preImageHashes(CoinType.ethereum, signingInput(tx)));
  if (out.errorMessage) throw new Error(`wallet-core: ${out.errorMessage}`);
  return new Uint8Array(out.dataHash);
}

// The MPC signature (r, s) -> the 65-byte Ethereum signature r || s || recovery id, in low-S form.
export async function finishSignature(hash: Uint8Array, sig: Signature, address: string): Promise<Uint8Array> {
  const { PublicKey, AnyAddress, CoinType } = await core();
  const toBig = (b: Uint8Array) => BigInt(`0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") || "0"}`);
  const pad32 = (n: bigint) => {
    const h = n.toString(16).padStart(64, "0");
    return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  };
  let s = toBig(sig.s);
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s;
  for (const v of [0, 1]) {
    const full = new Uint8Array(65);
    full.set(pad32(toBig(sig.r)));
    full.set(pad32(s), 32);
    full[64] = v;
    const pk = PublicKey.recover(full, hash);
    if (!pk) continue;
    const a = AnyAddress.createWithPublicKey(pk, CoinType.ethereum);
    const match = a.description().toLowerCase() === address.toLowerCase();
    a.delete();
    pk.delete();
    if (match) return full;
  }
  throw new Error("The co-signed signature does not match your wallet address.");
}

// The 0x signature string for EIP-191 / EIP-712 verifiers (v = 27 / 28).
export function signatureHex(full: Uint8Array): string {
  const out = new Uint8Array(full);
  out[64] += 27;
  return `0x${Array.from(out, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export async function compileTx(tx: EthTx, full: Uint8Array, publicKey: Uint8Array): Promise<string> {
  const { TransactionCompiler, CoinType, DataVector, HexCoding, PublicKey, PublicKeyType } = await core();
  const pk = PublicKey.createWithData(publicKey, publicKey.length === 33 ? PublicKeyType.secp256k1 : PublicKeyType.secp256k1Extended);
  const sigs = DataVector.create();
  const pubs = DataVector.create();
  sigs.add(full);
  pubs.add(pk.uncompressed().data());
  const out = TW.Ethereum.Proto.SigningOutput.decode(TransactionCompiler.compileWithSignatures(CoinType.ethereum, signingInput(tx), sigs, pubs));
  sigs.delete();
  pubs.delete();
  pk.delete();
  if (out.error) throw new Error(`wallet-core compile error: ${out.errorMessage}`);
  return hex0x(HexCoding.encode(out.encoded));
}

// Transaction hash = keccak256 of the signed raw transaction.
export async function txHashOf(raw: string): Promise<string> {
  const { Hash, HexCoding } = await core();
  return hex0x(HexCoding.encode(Hash.keccak256(HexCoding.decode(raw))));
}

export async function isValidEthAddress(a: string): Promise<boolean> {
  const { AnyAddress, CoinType } = await core();
  return AnyAddress.isValid(a, CoinType.ethereum);
}
