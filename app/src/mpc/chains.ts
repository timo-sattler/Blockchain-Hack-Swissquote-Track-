// Building, finishing and broadcasting transactions for the MPC key on Base Sepolia and Bitcoin testnet4.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { p2wpkh, SigHash, TEST_NETWORK, Transaction } from '@scure/btc-signer'
import {
  encodeFunctionData,
  erc20Abi,
  hashTypedData,
  isAddress,
  keccak256,
  parseEther,
  parseTransaction,
  parseUnits,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { MEMPOOL_API, USDC } from '../config'
import { publicClient } from '../wallet'
import { toB64 } from './bytes'
import type { Signature } from './protocol'

export type Asset = 'USDC' | 'ETH' | 'BTC'

const Fn = secp256k1.Point.Fn

/** Bitcoin and Ethereum both require the low-S form of an ECDSA signature. */
function lowS(sig: Signature) {
  const s = Fn.fromBytes(sig.s)
  return { r: Fn.fromBytes(sig.r), s: s > Fn.ORDER / 2n ? Fn.ORDER - s : s }
}

export const compressedKey = (publicKey: Uint8Array) => secp256k1.Point.fromBytes(publicKey).toBytes(true)

// ---------- EVM (Base Sepolia) ----------

export async function buildEvmTx(from: Address, asset: 'USDC' | 'ETH', to: string, amount: string): Promise<Hex> {
  if (!isAddress(to)) throw new Error('Recipient is not a valid 0x address.')
  const call =
    asset === 'ETH'
      ? { to: to as Address, value: parseEther(amount), data: undefined }
      : { to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as Address, parseUnits(amount, 6)] }) }
  const [nonce, fees] = await Promise.all([
    publicClient.getTransactionCount({ address: from, blockTag: 'pending' }),
    publicClient.estimateFeesPerGas(),
  ])
  let gas: bigint
  try {
    gas = ((await publicClient.estimateGas({ account: from, ...call })) * 12n) / 10n
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/insufficient funds|exceeds balance/i.test(message))
      throw new Error(asset === 'USDC' ? 'Not enough USDC, or no ETH to pay the network fee.' : 'Not enough ETH for this amount plus the network fee.')
    throw e
  }
  return serializeTransaction({
    chainId: 84532,
    type: 'eip1559',
    nonce,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    ...call,
  })
}

export const evmHash = (unsignedTx: Hex) => keccak256(unsignedTx)

// ---------- Gasless USDC (EIP-3009 transferWithAuthorization, relayed by Swissquote) ----------

export type UsdcAuthorization = { to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex }

/** "Move this much of my USDC to `to`", valid for 10 minutes, usable exactly once (random nonce). */
export function buildUsdcAuthorization(to: string, amount: string): UsdcAuthorization {
  if (!isAddress(to)) throw new Error('Recipient is not a valid 0x address.')
  const now = Math.floor(Date.now() / 1000)
  return {
    to,
    value: parseUnits(amount, 6).toString(),
    validAfter: '0',
    validBefore: String(now + 600),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  }
}

/** The same EIP-712 hash Swissquote computes; the phone compares both before co-signing. */
export function usdcAuthorizationHash(from: Address, auth: UsdcAuthorization): Hex {
  return hashTypedData({
    domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: USDC },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from, to: auth.to, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce },
  })
}

/** Turns the MPC signature (r, s) into a 65-byte Ethereum signature by finding the recovery bit. */
export async function finishEvmSignature(hash: Hex, sig: Signature, from: Address): Promise<Hex> {
  const { r, s } = lowS(sig)
  for (const yParity of [0, 1] as const) {
    const signature = { r: toHex(r, { size: 32 }), s: toHex(s, { size: 32 }), yParity }
    if ((await recoverAddress({ hash, signature })).toLowerCase() === from.toLowerCase()) return serializeSignature(signature)
  }
  throw new Error('Signature does not match the wallet address.')
}

export async function sendEvmTx(unsignedTx: Hex, sig: Signature, from: Address): Promise<Hex> {
  const { r, s } = lowS(sig)
  const hash = keccak256(unsignedTx)
  const tx = parseTransaction(unsignedTx)
  for (const yParity of [0, 1] as const) {
    const signature = { r: toHex(r, { size: 32 }), s: toHex(s, { size: 32 }), yParity }
    if ((await recoverAddress({ hash, signature })).toLowerCase() === from.toLowerCase()) {
      return publicClient.sendRawTransaction({ serializedTransaction: serializeTransaction(tx, signature) })
    }
  }
  throw new Error('Signature does not match the wallet address.')
}

export async function evmBalances(address: Address) {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ])
  return { eth, usdc }
}

// ---------- Bitcoin testnet4 ----------

type Utxo = { txid: string; vout: number; value: number }

export async function btcBalance(address: string): Promise<bigint> {
  const res = await fetch(`${MEMPOOL_API}/address/${address}`)
  if (!res.ok) throw new Error('Bitcoin explorer unavailable')
  const { chain_stats: c, mempool_stats: m } = await res.json()
  return BigInt(c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum)
}

/** Builds an unsigned SegWit transaction; returns it with one sighash per input. */
export async function buildBtcTx(publicKey: Uint8Array, to: string, amountBtc: string) {
  const pub = compressedKey(publicKey)
  const own = p2wpkh(pub, TEST_NETWORK)
  const amount = BigInt(Math.round(Number(amountBtc) * 1e8))
  if (!(amount > 0n)) throw new Error('Enter an amount.')

  const [utxos, fees] = await Promise.all([
    fetch(`${MEMPOOL_API}/address/${own.address}/utxo`).then((r) => r.json() as Promise<Utxo[]>),
    fetch(`${MEMPOOL_API}/v1/fees/recommended`)
      .then((r) => r.json() as Promise<{ halfHourFee: number }>)
      .catch(() => ({ halfHourFee: 2 })),
  ])
  const feeRate = BigInt(Math.max(1, Math.ceil(fees.halfHourFee)))
  const selected: Utxo[] = []
  let total = 0n
  let fee = 0n
  for (const utxo of [...utxos].sort((a, b) => b.value - a.value)) {
    selected.push(utxo)
    total += BigInt(utxo.value)
    fee = feeRate * BigInt(11 + 68 * selected.length + 31 * 2) // P2WPKH vbytes estimate
    if (total >= amount + fee) break
  }
  if (total < amount + fee) throw new Error('Not enough BTC for this amount plus the network fee.')

  const tx = new Transaction()
  for (const u of selected) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: own.script, amount: BigInt(u.value) } })
  try {
    tx.addOutputAddress(to, amount, TEST_NETWORK)
  } catch {
    throw new Error('Recipient is not a valid Bitcoin testnet address.')
  }
  const change = total - amount - fee
  if (change >= 546n) tx.addOutputAddress(own.address!, change, TEST_NETWORK)

  const scriptCode = new Uint8Array([0x76, 0xa9, 0x14, ...own.script.slice(2), 0x88, 0xac])
  const sighashes = selected.map((u, i) => tx.preimageWitnessV0(i, scriptCode, SigHash.ALL, BigInt(u.value)))
  return { tx, psbt: toB64(tx.toPSBT()), sighashes, pub }
}

export async function sendBtcTx(tx: Transaction, pub: Uint8Array, sigs: Signature[]): Promise<string> {
  sigs.forEach((sig, i) => {
    const { r, s } = lowS(sig)
    const der = new secp256k1.Signature(r, s).toBytes('der')
    tx.updateInput(i, { partialSig: [[pub, new Uint8Array([...der, SigHash.ALL])]] })
  })
  tx.finalize()
  const res = await fetch(`${MEMPOOL_API}/tx`, { method: 'POST', body: tx.hex })
  const text = await res.text()
  if (!res.ok) throw new Error(`Bitcoin network rejected the transaction: ${text}`)
  return text.trim()
}

export const sameHash = (a: Uint8Array, b: Uint8Array) => toB64(a) === toB64(b)
