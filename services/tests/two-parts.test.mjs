// Proof of the custody claim, with the same library and party layout the wallet uses (2-of-2: the
// client's device = party 0, Swissquote = party 1, the escrow agent holds a copy of party 1's part):
// only the client's part + Swissquote's part produce a valid signature. Swissquote alone, Swissquote
// with the escrow copy, or Swissquote with a forged client part cannot.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { KeygenSession, Keyshare, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import { secp256k1 } from '@noble/curves/secp256k1.js'

const others = (msgs, id) => msgs.filter((m) => m.from_id !== id).map((m) => m.clone())
const forParty = (msgs, id) => msgs.filter((m) => m.to_id === id).map((m) => m.clone())

function keygen() {
  const sessions = [0, 1].map((id) => new KeygenSession(2, 2, id))
  const msg1 = sessions.map((s) => s.createFirstMessage())
  const msg2 = sessions.flatMap((s, i) => s.handleMessages(others(msg1, i)))
  const commitments = sessions.map((s) => s.calculateChainCodeCommitment())
  const msg3 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg2, i)))
  const msg4 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg3, i), commitments))
  sessions.forEach((s, i) => s.handleMessages(others(msg4, i)))
  const shares = sessions.map((s) => s.keyshare())
  return { client: shares[0].toBytes(), swissquote: shares[1].toBytes(), publicKey: shares[0].publicKey }
}

/** Runs the signing protocol between two holders; returns a 64-byte signature, or the error. */
function trySign(first, second, hash) {
  try {
    const parties = [first, second].map((bytes) => new SignSession(Keyshare.fromBytes(bytes), 'm'))
    const ids = [first, second].map((bytes) => Keyshare.fromBytes(bytes).partyId)
    const m1 = parties.map((p) => p.createFirstMessage())
    const m2 = parties.flatMap((p, i) => p.handleMessages(others(m1, ids[i])))
    const m3 = parties.flatMap((p, i) => p.handleMessages(forParty(m2, ids[i])))
    parties.forEach((p, i) => p.handleMessages(forParty(m3, ids[i])))
    const m4 = parties.map((p) => p.lastMessage(hash))
    const [r, s] = parties[0].combine(others(m4, ids[0]))
    return { signature: new Uint8Array([...r, ...s]) }
  } catch (error) {
    return { error: String(error.message ?? error) }
  }
}

const valid = (result, hash, publicKey) => !!result.signature && secp256k1.verify(result.signature, hash, publicKey, { prehash: false, lowS: false })

const wallet = keygen()
const hash = createHash('sha256').update('send all funds to the attacker').digest()

test('the client part and the Swissquote part are different, and neither is the key', () => {
  assert.notDeepEqual(wallet.client, wallet.swissquote)
  assert.equal(Keyshare.fromBytes(wallet.client).partyId, 0)
  assert.equal(Keyshare.fromBytes(wallet.swissquote).partyId, 1)
})

test('client part + Swissquote part produce a valid signature', () => {
  assert.ok(valid(trySign(wallet.client, wallet.swissquote, hash), hash, wallet.publicKey))
})

test('Swissquote + the escrow copy of its own part cannot sign (still one part)', () => {
  const escrowCopy = new Uint8Array(wallet.swissquote)
  assert.ok(!valid(trySign(wallet.swissquote, escrowCopy, hash), hash, wallet.publicKey))
})

test('Swissquote + a forged client part cannot sign', () => {
  const forged = keygen().client // a well-formed client part, but of a different key
  assert.ok(!valid(trySign(forged, wallet.swissquote, hash), hash, wallet.publicKey))
})

test("an identical copy of the client's part on another device signs like the original", () => {
  const phoneCopy = new Uint8Array(wallet.client)
  assert.ok(valid(trySign(phoneCopy, wallet.swissquote, hash), hash, wallet.publicKey))
})
