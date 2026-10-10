// MPC spike: 2-of-3 DKLs23 key across phone (0), Swissquote (1) and recovery kit (2).
// Runs every party in one process to validate the library before splitting it into real processes.
import { KeygenSession, Keyshare, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer'
import { keccak256, recoverAddress, serializeTransaction, toHex, hexToBytes } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'

const PHONE = 0, SWISSQUOTE = 1, KIT = 2
const names = ['phone', 'swissquote', 'kit']
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

const others = (msgs, party) => msgs.filter((m) => m.from_id !== party).map((m) => m.clone())
const forParty = (msgs, party) => msgs.filter((m) => m.to_id === party).map((m) => m.clone())

function runKeygen(sessions) {
  const ids = sessions.map((_, i) => i)
  const msg1 = sessions.map((s) => s.createFirstMessage())
  const msg2 = sessions.flatMap((s, i) => s.handleMessages(others(msg1, ids[i])))
  const commitments = sessions.map((s) => s.calculateChainCodeCommitment())
  const msg3 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg2, ids[i])))
  const msg4 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg3, ids[i]), commitments))
  sessions.forEach((s, i) => s.handleMessages(others(msg4, ids[i])))
  return sessions.map((s) => s.keyshare())
}

/** Two parties jointly sign a 32-byte hash. Shares are passed as bytes because SignSession consumes them. */
function sign(shareBytes, hash) {
  const parties = shareBytes.map((b) => new SignSession(Keyshare.fromBytes(b), 'm'))
  const ids = shareBytes.map((b) => Keyshare.fromBytes(b).partyId)
  const msg1 = parties.map((p) => p.createFirstMessage())
  const msg2 = parties.flatMap((p, i) => p.handleMessages(others(msg1, ids[i])))
  const msg3 = parties.flatMap((p, i) => p.handleMessages(forParty(msg2, ids[i])))
  parties.forEach((p, i) => p.handleMessages(forParty(msg3, ids[i])))
  const msg4 = parties.map((p) => p.lastMessage(hash))
  const [r, s] = parties.map((p, i) => p.combine(others(msg4, ids[i])))[0]
  return { r: new Uint8Array(r), s: new Uint8Array(s) }
}

const verify = (sig, hash, pub) =>
  secp256k1.verify(new Uint8Array([...sig.r, ...sig.s]), hash, pub, { prehash: false, lowS: false })

// 1. Distributed key generation: the private key never exists in one place.
let t = Date.now()
const shares = runKeygen([0, 1, 2].map((id) => new KeygenSession(3, 2, id)))
const bytes = shares.map((s) => s.toBytes())
const pub = shares[0].publicKey
console.log(`keygen 2-of-3 in ${Date.now() - t} ms, public key ${pub.length} bytes, share sizes ${bytes.map((b) => b.length).join('/')} bytes`)
ok('all parties derive the same public key', shares.every((s) => toHex(s.publicKey) === toHex(pub)))

// 2. Any two shares can sign; one share alone cannot.
const hash = sha256(new TextEncoder().encode('pay 20 USDC to Tom'))
for (const [a, b] of [[PHONE, SWISSQUOTE], [PHONE, KIT], [SWISSQUOTE, KIT]]) {
  t = Date.now()
  const sig = sign([bytes[a], bytes[b]], hash)
  ok(`${names[a]} + ${names[b]} produce a valid signature (${Date.now() - t} ms)`, verify(sig, hash, pub))
}

// 3. Same key, many chains.
const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false)
const ethAddress = publicKeyToAddress(toHex(uncompressed))
const compressed = secp256k1.Point.fromBytes(pub).toBytes(true)
const btcAddress = p2wpkh(compressed, TEST_NETWORK).address
console.log(`EVM address (Ethereum, Base, …): ${ethAddress}`)
console.log(`Bitcoin testnet address (P2WPKH): ${btcAddress}`)

// 4. A real EVM transaction signed by phone + Swissquote, checked by recovering the sender.
const tx = { chainId: 84532, type: 'eip1559', nonce: 0, to: '0x000000000000000000000000000000000000dEaD', value: 1n, gas: 21000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1_000_000n }
const txHash = keccak256(serializeTransaction(tx))
const raw = sign([bytes[PHONE], bytes[SWISSQUOTE]], hexToBytes(txHash))
let s = secp256k1.Point.Fn.fromBytes(raw.s)
if (s > secp256k1.Point.Fn.ORDER / 2n) s = secp256k1.Point.Fn.ORDER - s // Ethereum requires low-S
const sTop = toHex(secp256k1.Point.Fn.toBytes(s))
let signedTx = null
for (const yParity of [0, 1]) {
  const signature = { r: toHex(raw.r), s: sTop, yParity }
  if ((await recoverAddress({ hash: txHash, signature })) === ethAddress) signedTx = serializeTransaction(tx, signature)
}
ok('EVM transaction signature recovers to the wallet address', signedTx !== null)

// 5. Phone lost: Swissquote + kit rebuild a fresh phone share. Same public key, same addresses.
t = Date.now()
const lost = new Uint8Array([PHONE])
const recovered = runKeygen([
  KeygenSession.initLostShareRecovery(3, 2, PHONE, pub, lost),
  KeygenSession.initKeyRecovery(Keyshare.fromBytes(bytes[SWISSQUOTE]), lost),
  KeygenSession.initKeyRecovery(Keyshare.fromBytes(bytes[KIT]), lost),
])
const newBytes = recovered.map((r) => r.toBytes())
console.log(`lost-share recovery in ${Date.now() - t} ms`)
ok('recovered shares keep the same public key', recovered.every((r) => toHex(r.publicKey) === toHex(pub)))
ok('new phone + Swissquote can sign', verify(sign([newBytes[PHONE], newBytes[SWISSQUOTE]], hash), hash, pub))
let oldStillWorks = false
try {
  oldStillWorks = verify(sign([bytes[PHONE], newBytes[SWISSQUOTE]], hash), hash, pub)
} catch {
  oldStillWorks = false
}
ok('the old (stolen) phone share no longer works with the refreshed Swissquote share', !oldStillWorks)

// 6. Old phone + old kit are still a consistent pair: after recovery the client must store the
//    NEW kit and destroy the old one, otherwise a thief holding both old shares could still sign.
let oldPairWorks = false
try {
  oldPairWorks = verify(sign([bytes[PHONE], bytes[KIT]], hash), hash, pub)
} catch {
  oldPairWorks = false
}
console.log(`INFO  old phone + old kit can still sign: ${oldPairWorks} (=> replace the kit during recovery)`)

// 7. A Bitcoin (SegWit v0) transaction signed by phone + Swissquote.
const { Transaction, SigHash } = await import('@scure/btc-signer')
const btcTx = new Transaction()
const script = p2wpkh(compressed, TEST_NETWORK).script
btcTx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { script, amount: 50_000n } })
btcTx.addOutputAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 40_000n, TEST_NETWORK)
const scriptCode = new Uint8Array([0x76, 0xa9, 0x14, ...script.slice(2), 0x88, 0xac]) // P2PKH template for BIP143
const sighash = btcTx.preimageWitnessV0(0, scriptCode, SigHash.ALL, 50_000n)
const btcRaw = sign([bytes[PHONE], bytes[SWISSQUOTE]], sighash)
const Fn = secp256k1.Point.Fn
const btcS = Fn.fromBytes(btcRaw.s)
const btcSig = new secp256k1.Signature(Fn.fromBytes(btcRaw.r), btcS > Fn.ORDER / 2n ? Fn.ORDER - btcS : btcS) // Bitcoin requires low-S
btcTx.updateInput(0, { partialSig: [[compressed, new Uint8Array([...btcSig.toBytes('der'), SigHash.ALL])]] })
btcTx.finalize()
ok('Bitcoin transaction finalizes with the MPC signature', btcTx.isFinal)
ok('Bitcoin signature verifies against the BIP143 sighash', secp256k1.verify(btcSig.toBytes('compact'), sighash, compressed, { prehash: false }))
console.log(`signed BTC tx: ${btcTx.hex.length / 2} bytes`)
