// The same key on other networks. Every address below is derived from the wallet's one public key, so
// the same two parts control it. This demo shows balances and sends only on Base Sepolia (USDC, EURC,
// ETH) and Bitcoin testnet4; enabling another network only needs Swissquote's signing policy to allow it.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createBase58check } from '@scure/base'
import { p2pkh, p2wpkh } from '@scure/btc-signer'
import { hexToBytes, keccak256 } from 'viem'

/** Ethereum-type networks: one address everywhere, no contract to deploy first. */
export const EVM_NETWORKS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche']

const LITECOIN = { bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }
const DOGECOIN = { bech32: 'doge', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }

export function otherNetworkAddresses(publicKey: Uint8Array) {
  const point = secp256k1.Point.fromBytes(publicKey)
  const compressed = point.toBytes(true)
  // Tron: 0x41 + the last 20 bytes of keccak256(uncompressed key), Base58Check.
  const tronBody = new Uint8Array([0x41, ...hexToBytes(keccak256(point.toBytes(false).slice(1))).slice(12)])
  return {
    litecoin: p2wpkh(compressed, LITECOIN).address!,
    dogecoin: p2pkh(compressed, DOGECOIN).address!,
    tron: createBase58check(sha256).encode(tronBody),
  }
}
