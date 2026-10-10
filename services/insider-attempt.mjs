// "Can Swissquote steal?" Run as Swissquote: with everything in Swissquote's own database (and the
// escrow agent's copy), try to sign a payment that drains a client's wallet. Prints no secrets.
//   node insider-attempt.mjs              the newest two-part wallet
//   node insider-attempt.mjs Grace        a wallet by name
//   node insider-attempt.mjs Grace --scan also search Swissquote's part for the private key (about a minute)
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeygenSession, Keyshare, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import { secp256k1 } from '@noble/curves/secp256k1.js'

const SHARE_DATA = process.env.DATA_DIR ?? join(import.meta.dirname, 'data', 'share-service')
const ESCROW_DATA = process.env.ESCROW_DATA_DIR ?? join(import.meta.dirname, 'data', 'escrow-agent')
const wallets = readdirSync(join(SHARE_DATA, 'wallets'))
  .map((f) => JSON.parse(readFileSync(join(SHARE_DATA, 'wallets', f), 'utf8')))
  .filter((w) => w.status === 'active' && w.scheme === '2of2' && w.shareB)
  .sort((a, b) => b.createdAt - a.createdAt)
const args = process.argv.slice(2)
const scan = args.includes('--scan')
const wanted = args.find((a) => !a.startsWith('--'))?.toLowerCase()
const wallet = wanted ? wallets.find((w) => w.name?.toLowerCase().includes(wanted)) : wallets[0]
if (!wallet) {
  console.log('No two-part wallet found. Create one in the app first.')
  process.exit(1)
}

const others = (msgs, id) => msgs.filter((m) => m.from_id !== id).map((m) => m.clone())
const forParty = (msgs, id) => msgs.filter((m) => m.to_id === id).map((m) => m.clone())
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const publicKey = new Uint8Array(Buffer.from(wallet.publicKey, 'base64'))
const shareB = new Uint8Array(Buffer.from(wallet.shareB, 'base64'))
const escrowFile = join(ESCROW_DATA, `${wallet.id}.json`)
const escrowCopy = existsSync(escrowFile) ? new Uint8Array(Buffer.from(JSON.parse(readFileSync(escrowFile, 'utf8')).shareB, 'base64')) : null
const hash = createHash('sha256').update(`send everything from ${wallet.evmAddress} to the insider`).digest()

function trySign(first, second) {
  try {
    const parties = [first, second].map((bytes) => new SignSession(Keyshare.fromBytes(bytes), 'm'))
    const ids = [first, second].map((bytes) => Keyshare.fromBytes(bytes).partyId)
    const m1 = parties.map((p) => p.createFirstMessage())
    const m2 = parties.flatMap((p, i) => p.handleMessages(others(m1, ids[i])))
    const m3 = parties.flatMap((p, i) => p.handleMessages(forParty(m2, ids[i])))
    parties.forEach((p, i) => p.handleMessages(forParty(m3, ids[i])))
    const m4 = parties.map((p) => p.lastMessage(hash))
    const [r, s] = parties[0].combine(others(m4, ids[0]))
    const ok = secp256k1.verify(new Uint8Array([...r, ...s]), hash, publicKey, { prehash: false, lowS: false })
    return ok ? 'SIGNED (this must never happen)' : 'FAILED: the signature is not valid for this wallet'
  } catch (error) {
    return `FAILED: the parts do not form the key (${String(error.message ?? error).slice(0, 40)})`
  }
}

function forgedClientPart() {
  const sessions = [0, 1].map((id) => new KeygenSession(2, 2, id))
  const msg1 = sessions.map((s) => s.createFirstMessage())
  const msg2 = sessions.flatMap((s, i) => s.handleMessages(others(msg1, i)))
  const commitments = sessions.map((s) => s.calculateChainCodeCommitment())
  const msg3 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg2, i)))
  const msg4 = sessions.flatMap((s, i) => s.handleMessages(forParty(msg3, i), commitments))
  sessions.forEach((s, i) => s.handleMessages(others(msg4, i)))
  return sessions[0].keyshare().toBytes()
}

let step = 0
const line = (label, result) => console.log(`  ${`${++step}. ${label}`.padEnd(46, '.')} ${result}`)
console.log(`\nInsider attempt on ${wallet.name ?? wallet.id}'s wallet ${wallet.evmAddress}`)
console.log(`Using only Swissquote's own database${escrowCopy ? " and the escrow agent's copy" : ''}. Nothing from the client.\n`)
console.log(`  Swissquote's part: ${(shareB.length / 1024).toFixed(1)} KB, party ${Keyshare.fromBytes(shareB).partyId}, fingerprint ${fingerprint(shareB)}`)
if (escrowCopy) console.log(`  Escrow agent's copy: fingerprint ${fingerprint(escrowCopy)} (${fingerprint(escrowCopy) === fingerprint(shareB) ? 'the same part' : 'different'})`)
console.log(`  Goal: a valid signature for "send everything to the insider"\n`)

line('Swissquote alone', 'IMPOSSIBLE: the protocol needs the client part')
if (escrowCopy) line("Swissquote + the escrow agent's copy", trySign(shareB, escrowCopy))
line('Swissquote + a forged client part', trySign(forgedClientPart(), shareB))

// Sanity check: is the private key itself stored anywhere in Swissquote's part?
if (scan) {
const started = Date.now()
let checked = 0
let found = false
const target = Buffer.from(publicKey).toString('hex')
for (let i = 0; i + 32 <= shareB.length && !found; i++) {
  try {
    if (Buffer.from(secp256k1.getPublicKey(shareB.subarray(i, i + 32), true)).toString('hex') === target) found = true
  } catch {
    // not a valid scalar
  }
  checked++
}
line(`Private key inside Swissquote's part?`, found ? 'FOUND (this must never happen)' : `NO: none of ${checked.toLocaleString('en')} values is the key (${((Date.now() - started) / 1000).toFixed(1)} s)`)
}
console.log(`\nResult: with everything Swissquote holds, it cannot move ${wallet.name ?? 'the client'}'s funds.\n`)
