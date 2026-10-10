// Swissquote share service (MOCK of the bank's backend): party B of the two-part wallet (2-of-2).
// Holds Swissquote's part in its own storage, never sends it out, and only co-signs payments it has
// decoded and screened itself. Runs as a separate process, as the challenge requires.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { KeygenSession, Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { p2wpkh, SigHash, TEST_NETWORK, Transaction, Address, OutScript } from '@scure/btc-signer'
import { decodeFunctionData, erc20Abi, formatUnits, getAddress, hashTypedData, hexToBytes, isAddress, isHex, keccak256, parseTransaction, recoverTypedDataAddress, toHex } from 'viem'
import { createTreasury } from './treasury.mjs'
import { reserveRelay } from './relay-quota.mjs'

const PORT = Number(process.env.SHARE_PORT ?? 8790)
const HUB_URL = process.env.HUB_URL ?? 'http://localhost:8787'
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, 'data', 'share-service')
const HIGH_VALUE_USDC = 1000
// MOCK independent escrow agent (escrow-agent.mjs): receives a copy of Swissquote's part when a wallet
// is created and hands it to the client's device only after the grace period (Swissquote gone).
const ESCROW_URL = process.env.ESCROW_URL ?? 'http://localhost:8791'
const ESCROW_DEPOSIT_TOKEN = process.env.ESCROW_DEPOSIT_TOKEN ?? 'demo-escrow-deposit-token'
const RELAYS_PER_DAY = Number(process.env.RELAYS_PER_DAY ?? 10) // gasless USDC/EURC transfers Swissquote pays for, per wallet
if (!Number.isSafeInteger(RELAYS_PER_DAY) || RELAYS_PER_DAY < 0) throw new Error('RELAYS_PER_DAY must be a non-negative integer')
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
// Stablecoins Swissquote co-signs and sponsors: Circle's FiatToken v2 on Base Sepolia (plain transfers
// and EIP-3009 transferWithAuthorization). The EIP-712 domain name equals the token name.
const STABLECOINS = {
  [USDC]: 'USDC',
  '0x808456652fdb597867f38412077a9182bf77359f': 'EURC',
}
// Clearly fake addresses standing in for a compliance provider's sanctions list and scam database (mock).
// Production: a chain-analytics provider (e.g. Chainalysis, Elliptic) queried before every co-signature.
const BLOCKLIST = new Map([
  ['0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e', 'on a sanctions list (mock OFAC entry)'],
  ['0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0', 'a known scam: a fake airdrop that drains wallets (mock)'],
  ['tb1qh2at4w46h2at4w46h2at4w46h2at4w46jvgsm3', 'a known ransomware payment address (mock)'],
])
const BLOCKLIST_UPDATED = '2026-10-10'

mkdirSync(join(DATA_DIR, 'wallets'), { recursive: true })
const treasury = createTreasury(DATA_DIR, (event) => emit(event))

// ---------- storage ----------

const walletPath = (id) => join(DATA_DIR, 'wallets', `${id}.json`)
const loadWallet = (id) => (/^[0-9a-f-]{36}$/.test(id) && existsSync(walletPath(id)) ? JSON.parse(readFileSync(walletPath(id), 'utf8')) : null)
const saveWallet = (wallet) => writeFileSync(walletPath(wallet.id), JSON.stringify(wallet, null, 2))

// ---------- helpers ----------

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'))
const toWire = (m) => ({ from: m.from_id, to: m.to_id ?? null, payload: b64(m.payload) })
const fromWire = (w) => new Message(unb64(w.payload), w.from, w.to ?? undefined)

function addressesFor(publicKey) {
  const point = secp256k1.Point.fromBytes(publicKey)
  const evm = getAddress(toHex(keccak_256(point.toBytes(false).slice(1)).slice(-20)))
  const btc = p2wpkh(point.toBytes(true), TEST_NETWORK).address
  return { evmAddress: evm, btcAddress: btc }
}

function emit(event) {
  fetch(`${HUB_URL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }).catch(() => {})
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details // extra fields for the client, e.g. why a payment was blocked
  }
}

// Swissquote screens every recipient before it co-signs; a match is refused and nothing is signed.
function screenRecipients(wallet, recipients) {
  for (const recipient of recipients) {
    const reason = BLOCKLIST.get(recipient?.toLowerCase())
    if (!reason) continue
    emit({ type: 'payment_blocked', name: wallet.name, to: recipient, reason })
    console.log(`[share] BLOCKED a payment from ${wallet.name ?? wallet.id} to ${recipient}: ${reason}`)
    throw new HttpError(403, `Blocked by Swissquote: ${recipient} is ${reason}. Nothing was signed.`, { blocked: true, reason })
  }
}

const originOf = (req) => {
  const origin = req.headers.origin
  if (!origin) throw new HttpError(400, 'missing Origin header')
  return { origin, rpID: new URL(origin).hostname }
}

// ---------- in-memory protocol state ----------

const challenges = new Map() // isolated one-time WebAuthn challenges, expiring after five minutes
const tokens = new Map() // token -> { walletId, expires }
const sessions = new Map() // sessionId -> { kind, walletId, session, stage, hash?, created }

function saveChallenge(id, challenge) {
  challenges.set(id, { challenge, expires: Date.now() + 5 * 60_000 })
}

function takeChallenge(id) {
  const entry = challenges.get(id)
  challenges.delete(id)
  return entry && entry.expires > Date.now() ? entry.challenge : undefined
}

function walletOrigin(req, wallet) {
  const context = originOf(req)
  if (wallet.origin && context.origin !== wallet.origin) throw new HttpError(403, 'wallet belongs to a different app origin')
  return { origin: wallet.origin ?? context.origin, rpID: wallet.rpID ?? context.rpID }
}

// Abandoned protocol runs expire, and their WASM state is freed.
setInterval(() => {
  for (const [id, token] of tokens) if (token.expires < Date.now()) tokens.delete(id)
  for (const [id, challenge] of challenges) if (challenge.expires < Date.now()) challenges.delete(id)
  for (const [sid, state] of sessions)
    if (Date.now() - state.created > 120_000) {
      sessions.delete(sid)
      try {
        state.session.free()
      } catch {
        // already consumed
      }
    }
}, 30_000)

// A wallet's passkeys: the first device's, plus one per device added later (identical copies of the client's part).
const credentialsOf = (wallet) => [wallet?.credential, ...(wallet?.devices ?? [])].filter(Boolean)

function requireToken(walletId, token) {
  const entry = tokens.get(token)
  const wallet = loadWallet(walletId)
  if (!entry || entry.walletId !== walletId || entry.expires < Date.now() || !credentialsOf(wallet).some((c) => c.id === entry.credentialId) || entry.epoch !== (wallet?.epoch ?? 1))
    throw new HttpError(401, 'passkey login required')
}

// ---------- policy: decode what we are asked to sign ----------

function evmIntent(wallet, unsignedTx) {
  const tx = parseTransaction(unsignedTx)
  if (tx.chainId !== 84532) throw new HttpError(400, 'only Base Sepolia is supported')
  let to = tx.to?.toLowerCase()
  let amount = `${formatUnits(tx.value ?? 0n, 18)} ETH`
  let usdc = 0
  if (STABLECOINS[to] && tx.data) {
    const symbol = STABLECOINS[to]
    const call = decodeFunctionData({ abi: erc20Abi, data: tx.data })
    if (call.functionName !== 'transfer') throw new HttpError(403, `only plain ${symbol} transfers are allowed`)
    to = call.args[0].toLowerCase()
    usdc = Number(formatUnits(call.args[1], 6))
    amount = `${usdc} ${symbol}`
  } else if (tx.data && tx.data !== '0x') {
    throw new HttpError(403, 'contract calls need an approved dApp (not in this prototype)')
  }
  return { hash: hexToBytes(keccak256(unsignedTx)), recipients: [to], usdc, summary: `${amount} to ${to}` }
}

// Gasless USDC: the client signs an EIP-3009 TransferWithAuthorization instead of a transaction, and
// Swissquote's relayer submits it and pays the network fee. Same policy checks as a normal transfer.
function usdcAuthorizationTypedData(from, auth) {
  const token = (auth.token ?? USDC).toLowerCase() // USDC unless the client names another stablecoin
  if (!STABLECOINS[token]) throw new HttpError(403, 'only USDC and EURC transfers can be sponsored')
  return {
    domain: { name: STABLECOINS[token], version: '2', chainId: 84532, verifyingContract: getAddress(token) },
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
    message: {
      from: getAddress(from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  }
}

function gaslessIntent(wallet, auth) {
  const now = Math.floor(Date.now() / 1000)
  if (!auth || !isAddress(auth.to) || !isHex(auth.nonce) || auth.nonce.length !== 66) throw new HttpError(400, 'invalid stablecoin authorization')
  if (auth.token !== undefined && (!isAddress(auth.token) || !STABLECOINS[auth.token.toLowerCase()])) throw new HttpError(403, 'only USDC and EURC transfers can be sponsored')
  for (const field of ['value', 'validAfter', 'validBefore']) {
    if (typeof auth[field] !== 'string' || !/^\d{1,78}$/.test(auth[field]) || BigInt(auth[field]) >= 2n ** 256n)
      throw new HttpError(400, `invalid authorization ${field}`)
  }
  if (!(BigInt(auth.value) > 0n)) throw new HttpError(400, 'amount must be positive')
  if (Number(auth.validAfter) > now || Number(auth.validBefore) <= now || Number(auth.validBefore) > now + 3600)
    throw new HttpError(400, 'authorization must be valid now and for at most one hour')
  const usdc = Number(formatUnits(BigInt(auth.value), 6))
  const typedData = usdcAuthorizationTypedData(wallet.evmAddress, auth)
  const hash = hexToBytes(hashTypedData(typedData))
  return { hash, recipients: [auth.to.toLowerCase()], usdc, summary: `${usdc} ${typedData.domain.name} to ${auth.to} (gasless)` }
}

function btcIntent(wallet, psbtBase64, inputIndex) {
  const tx = Transaction.fromPSBT(unb64(psbtBase64))
  const input = tx.getInput(inputIndex)
  const own = p2wpkh(unb64(wallet.publicKeyCompressed), TEST_NETWORK)
  if (!input.witnessUtxo || b64(input.witnessUtxo.script) !== b64(own.script)) throw new HttpError(403, 'input does not belong to this wallet')
  const scriptCode = new Uint8Array([0x76, 0xa9, 0x14, ...own.script.slice(2), 0x88, 0xac])
  const hash = tx.preimageWitnessV0(inputIndex, scriptCode, SigHash.ALL, input.witnessUtxo.amount)
  const recipients = []
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i)
    const address = Address(TEST_NETWORK).encode(OutScript.decode(out.script))
    if (address !== own.address) recipients.push(address)
  }
  return { hash, recipients, usdc: 0, summary: `BTC to ${recipients.join(', ')}` }
}

// ---------- routes ----------

const routes = {
  'GET /health': () => ({ ok: true }),

  // Demo directory of all clients' wallets (names + public addresses) for the live network graph.
  'GET /wallets': () =>
    readdirSync(join(DATA_DIR, 'wallets'))
      .map((file) => JSON.parse(readFileSync(join(DATA_DIR, 'wallets', file), 'utf8')))
      .filter((w) => w.status === 'active' && w.name)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((w) => ({ walletId: w.id, name: w.name, evmAddress: w.evmAddress, btcAddress: w.btcAddress, createdAt: w.createdAt })),

  'GET /treasury': () => treasury.status(),

  // Screening before a payment is built. The app keeps a copy of the list for after a takeover, when
  // Swissquote is gone. Co-signing enforces it again.
  'GET /blocklist': () => ({ updated: BLOCKLIST_UPDATED, entries: [...BLOCKLIST].map(([address, reason]) => ({ address, reason })) }),
  'POST /screen': (req, params, body) => {
    if (typeof body.to !== 'string' || body.to.length > 100) throw new HttpError(400, 'recipient required')
    const reason = BLOCKLIST.get(body.to.trim().toLowerCase())
    if (!reason) return { blocked: false }
    const wallet = typeof body.walletId === 'string' ? loadWallet(body.walletId) : null
    emit({ type: 'payment_blocked', name: wallet?.name, to: body.to.trim(), reason })
    console.log(`[share] BLOCKED a payment${wallet ? ` from ${wallet.name}` : ''} to ${body.to.trim()}: ${reason}`)
    return { blocked: true, reason }
  },

  // 1. A client starts creating a wallet: register the passkey that will authorise co-signing.
  'POST /wallets': async (req, params, body) => {
    const { origin, rpID } = originOf(req)
    const name = String(body.name ?? '').trim()
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Please enter your name (2–60 characters).')
    const id = randomUUID()
    const options = await registrationOptions(rpID, name)
    const creationToken = randomUUID()
    saveChallenge(`register:${id}`, options.challenge)
    // Two parts (2-of-2): the client's part (identical copies on their devices) + Swissquote's part.
    saveWallet({ id, name, clientId: 'CH-1048-2231', origin, rpID, creationToken, createdAt: Date.now(), status: 'registering', scheme: '2of2' })
    return { walletId: id, options, creationToken }
  },

  // Log in with an existing passkey: no wallet id needed, the browser offers the passkeys it has for this site.
  'POST /login/options': async (req) => {
    const { rpID } = originOf(req)
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
    const challengeId = randomUUID()
    saveChallenge(challengeId, options.challenge)
    return { challengeId, options }
  },

  'POST /login': async (req, params, body) => {
    const wallet = findWalletByCredential(body.response?.id)
    if (!wallet) throw new HttpError(404, 'This passkey does not belong to any wallet on this server. Create a new wallet instead.')
    const expectedChallenge = takeChallenge(body.challengeId)
    const token = await verifyLogin(req, wallet, body.response, expectedChallenge)
    return { token, ...publicView(wallet) }
  },

  // ---------- more devices with an identical copy of the client's part ----------
  // The logged-in device uploads its part encrypted with a one-time key that travels only inside the
  // link / QR code (URL fragment), so Swissquote relays a copy it cannot read. The new device registers
  // its own passkey (Face ID); from then on Swissquote accepts either device. Single use, 10 minutes.
  'POST /wallets/:id/devices/invite': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    if (typeof body.sealedShare !== 'string' || body.sealedShare.length < 100 || body.sealedShare.length > 600_000) throw new HttpError(400, 'encrypted key part required')
    wallet.invite = { token: randomUUID(), sealedShare: body.sealedShare, expires: Date.now() + 10 * 60_000 }
    saveWallet(wallet)
    return { inviteToken: wallet.invite.token, expires: wallet.invite.expires }
  },

  'POST /wallets/:id/devices/options': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    const invite = mustInvite(wallet, body.inviteToken)
    const { rpID } = walletOrigin(req, wallet)
    const options = await registrationOptions(rpID, wallet.name ?? 'Swissquote wallet')
    saveChallenge(`device:${id}:${invite.token}`, options.challenge)
    return { options, name: wallet.name ?? null }
  },

  'POST /wallets/:id/devices/register': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    const invite = mustInvite(wallet, body.inviteToken)
    const { origin, rpID } = walletOrigin(req, wallet)
    const expectedChallenge = takeChallenge(`device:${id}:${invite.token}`)
    if (!expectedChallenge) throw new HttpError(400, 'registration expired, open the link again')
    const result = await verifyRegistrationResponse({ response: body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true })
    if (!result.verified) throw new HttpError(401, 'passkey registration failed')
    const latest = mustWallet(id)
    if (latest.invite?.token !== invite.token) throw new HttpError(409, 'This link was already used. Create a new one on your other device.')
    const { credential } = result.registrationInfo
    const deviceName = String(body.deviceName ?? '').trim().slice(0, 40) || 'Another device'
    latest.devices = [...(latest.devices ?? []), { id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter, name: deviceName, addedAt: Date.now() }]
    const { sealedShare } = latest.invite
    delete latest.invite
    saveWallet(latest)
    emit({ type: 'device_added', name: latest.name, device: deviceName })
    console.log(`[share] ${latest.name ?? id} added a device: ${deviceName}`)
    return { sealedShare, publicKey: latest.publicKey, ...publicView(latest) }
  },

  // A lost device: Swissquote stops accepting its passkey, so its copy of the client's part is useless.
  'POST /wallets/:id/devices/remove': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    requireToken(id, body.token)
    const all = credentialsOf(wallet)
    if (!all.some((c) => c.id === body.credentialId)) throw new HttpError(404, 'unknown device')
    if (all.length < 2) throw new HttpError(409, 'You cannot remove your only device.')
    if (tokens.get(body.token).credentialId === body.credentialId) throw new HttpError(409, 'Remove this device from one of your other devices.')
    const removed = all.find((c) => c.id === body.credentialId)
    const remaining = all.filter((c) => c.id !== body.credentialId)
    wallet.credential = { name: remaining[0].name ?? 'First device', ...remaining[0] }
    wallet.devices = remaining.slice(1)
    for (const [token, entry] of tokens) if (entry.credentialId === body.credentialId) tokens.delete(token)
    saveWallet(wallet)
    emit({ type: 'device_removed', name: wallet.name, device: removed.name ?? 'First device' })
    console.log(`[share] ${wallet.name ?? id} removed a device: ${removed.name ?? 'First device'}`)
    return publicView(wallet)
  },

  'POST /wallets/:id/passkey': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'registering') throw new HttpError(409, 'passkey already registered')
    if (!body.creationToken || body.creationToken !== wallet.creationToken) throw new HttpError(403, 'wallet creation session required')
    const { origin, rpID } = walletOrigin(req, wallet)
    const expectedChallenge = takeChallenge(`register:${id}`)
    if (!expectedChallenge) throw new HttpError(400, 'registration expired, request new options')
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
    if (!result.verified) throw new HttpError(401, 'passkey registration failed')
    const { credential } = result.registrationInfo
    const latest = mustWallet(id)
    if (latest.status !== 'registering') throw new HttpError(409, 'registration already completed')
    latest.credential = { id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter, name: 'First device', addedAt: Date.now() }
    latest.status = 'keygen'
    saveWallet(latest)
    return { ok: true }
  },

  // 2. Distributed key generation of a new wallet: the client's device is party 0, Swissquote party 1.
  'POST /wallets/:id/keygen/start': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if ([...sessions.values()].some((s) => s.walletId === id && s.kind !== 'sign')) throw new HttpError(409, 'a key generation session is already running')
    if (wallet.status !== 'keygen' || !wallet.credential) throw new HttpError(409, 'wallet is not ready for key generation')
    if (!body.creationToken || body.creationToken !== wallet.creationToken) throw new HttpError(403, 'wallet creation session required')
    const kind = 'create'
    const session = new KeygenSession(2, 2, 1)
    const sid = randomUUID()
    const first = session.createFirstMessage()
    sessions.set(sid, { kind, walletId: id, session, stage: 1, created: Date.now(), epoch: wallet.epoch ?? 1 })
    return { sessionId: sid, kind, messages: [toWire(first)] }
  },

  'POST /mpc/:sid': (req, { sid }, body) => {
    const state = sessions.get(sid)
    if (!state) throw new HttpError(404, 'unknown or finished session')
    walletOrigin(req, mustWallet(state.walletId))
    const incoming = (body.messages ?? []).map(fromWire)
    try {
      return state.kind === 'sign' ? signStep(sid, state, incoming) : keygenStep(sid, state, incoming, body)
    } catch (error) {
      // DKLs rounds consume state. Retrying a failed round is unsafe; discard it so a retry can
      // start a fresh session immediately instead of blocking the wallet for two minutes.
      sessions.delete(sid)
      try { state.session.free() } catch {}
      throw error
    }
  },

  'GET /wallets/:id': (req, { id }) => publicView(mustWallet(id)),

  // For the client's "How my key works" view: a fingerprint (SHA-256) and size of Swissquote's part,
  // never the part itself.
  'GET /wallets/:id/parts': (req, { id }) => {
    const wallet = mustWallet(id)
    if (!wallet.shareB) throw new HttpError(409, 'wallet not active')
    const shareB = unb64(wallet.shareB)
    return { publicKey: wallet.publicKey, swissquote: { party: 1, bytes: shareB.length, fingerprint: createHash('sha256').update(shareB).digest('hex').slice(0, 16) } }
  },

  // 3. Log in with the passkey before co-signing (short-lived token).
  'POST /wallets/:id/auth/options': async (req, { id }) => {
    const wallet = mustWallet(id)
    if (!wallet.credential) throw new HttpError(409, 'no passkey registered')
    const { rpID } = walletOrigin(req, wallet)
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentialsOf(wallet).map((c) => ({ id: c.id })),
      userVerification: 'required',
    })
    const challengeId = randomUUID()
    saveChallenge(`auth:${id}:${challengeId}`, options.challenge)
    return { options, challengeId }
  },

  'POST /wallets/:id/login': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    const challengeKey = `auth:${id}:${body.challengeId}`
    const expectedChallenge = takeChallenge(challengeKey)
    return { token: await verifyLogin(req, wallet, body.response, expectedChallenge) }
  },

  // 4. Co-sign: decode the transaction, apply policy, then run the signing protocol on our own hash.
  'POST /wallets/:id/sign/start': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    const intent =
      body.chain === 'bitcoin'
        ? btcIntent(wallet, body.psbt, body.inputIndex ?? 0)
        : body.chain === 'base-gasless'
          ? gaslessIntent(wallet, body.authorization)
          : evmIntent(wallet, body.unsignedTx)
    screenRecipients(wallet, intent.recipients)
    if (intent.usdc > HIGH_VALUE_USDC && !body.confirmHighValue)
      throw new HttpError(428, `transfers above ${HIGH_VALUE_USDC} USDC or EURC need an extra confirmation`)
    const entry = tokens.get(body.token)
    const signingIntent = body.chain === 'bitcoin' ? createHash('sha256').update(body.psbt).digest('hex') : b64(intent.hash)
    if (entry.signingIntent && entry.signingIntent !== signingIntent) throw new HttpError(401, 'a new transfer requires a fresh passkey login')
    entry.signingIntent = signingIntent // all Bitcoin inputs share one PSBT; one login cannot authorize another payment
    const session = new SignSession(Keyshare.fromBytes(unb64(wallet.shareB)), 'm')
    const sid = randomUUID()
    const first = session.createFirstMessage()
    sessions.set(sid, { kind: 'sign', walletId: id, session, stage: 1, hash: intent.hash, created: Date.now() })
    console.log(`[share] co-signing ${intent.summary}`)
    return { sessionId: sid, messages: [toWire(first)], hash: b64(intent.hash) }
  },

  // 7. Gasless USDC: submit a signed EIP-3009 authorization; the treasury pays the network fee.
  //    Abuse limits: logged-in client only, only this wallet's own USDC, RELAYS_PER_DAY per wallet.
  'POST /wallets/:id/relay': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    const intent = gaslessIntent(wallet, body.authorization)
    screenRecipients(wallet, intent.recipients)
    // Only relay the precise intent approved during this passkey session. Offline A + C signatures
    // may bypass bank screening for self-funded sends, but cannot bypass it at the bank's expense.
    if (tokens.get(body.token).signingIntent !== b64(intent.hash)) throw new HttpError(403, 'authorization must be approved by Swissquote in this passkey session')
    const typedData = usdcAuthorizationTypedData(wallet.evmAddress, body.authorization)
    let signer
    try { signer = await recoverTypedDataAddress({ ...typedData, signature: body.signature }) }
    catch { throw new HttpError(401, 'invalid authorization signature') }
    if (signer !== getAddress(wallet.evmAddress)) throw new HttpError(401, 'authorization is not signed by this wallet')
    const latest = mustWallet(id) // signature verification is asynchronous; avoid saving a stale wallet record
    requireToken(id, body.token)
    const reservation = reserveRelay(latest, body.authorization.nonce, RELAYS_PER_DAY)
    if (reservation.error === 'limit') throw new HttpError(429, `daily limit of ${RELAYS_PER_DAY} sponsored transfer attempts reached; send with your own ETH instead`)
    if (reservation.error === 'duplicate') throw new HttpError(409, 'this authorization was already submitted')
    saveWallet(latest)
    let hash
    try {
      hash = await treasury.relayUsdcAuthorization(typedData.message, body.signature, typedData.domain.verifyingContract)
    } catch (error) {
      if (treasuryEmpty(error)) throw new HttpError(409, `Free transfers are unavailable: Swissquote's fee account is empty (top up ${treasury.address}). Tick "Pay it myself" to use your own ETH.`)
      // e.g. "transfer amount exceeds balance": USDC already accepted the signature at that point.
      throw new HttpError(400, `${typedData.domain.name} rejected the transfer: ${error.cause?.reason ?? error.shortMessage ?? error.message}`)
    }
    console.log(`[share] relayed gasless ${formatUnits(typedData.message.value, 6)} ${typedData.domain.name} for ${wallet.name ?? id}: ${hash}`)
    return { hash, sponsoredBy: treasury.address, remainingToday: reservation.remaining }
  },

}

// "insufficient funds" when sending, "gas required exceeds allowance (0)" when estimating gas.
const treasuryEmpty = (error) => /insufficient funds|exceeds allowance \(0\)/i.test(`${error?.message} ${error?.cause?.message ?? ''} ${error?.shortMessage ?? ''}`)

function mustInvite(wallet, inviteToken) {
  if (!wallet.invite || !inviteToken || wallet.invite.token !== inviteToken || wallet.invite.expires < Date.now())
    throw new HttpError(403, 'This link has expired or was already used. Create a new one on your other device.')
  return wallet.invite
}

function mustWallet(id) {
  const wallet = loadWallet(id)
  if (!wallet) throw new HttpError(404, 'unknown wallet')
  return wallet
}

async function registrationOptions(rpID, name) {
  return generateRegistrationOptions({
    rpName: 'Swissquote Wallet',
    rpID,
    userName: name,
    userDisplayName: name,
    attestationType: 'none',
    supportedAlgorithmIDs: [-7],
    // Discoverable, so the client can later log in without typing anything.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
}

function findWalletByCredential(credentialId) {
  if (!credentialId) return null
  for (const file of readdirSync(join(DATA_DIR, 'wallets'))) {
    const wallet = JSON.parse(readFileSync(join(DATA_DIR, 'wallets', file), 'utf8'))
    if (credentialsOf(wallet).some((c) => c.id === credentialId)) return mustWallet(wallet.id)
  }
  return null
}

async function verifyLogin(req, wallet, response, expectedChallenge) {
  if (!wallet.credential) throw new HttpError(409, 'no passkey registered')
  const used = credentialsOf(wallet).find((c) => c.id === response?.id)
  if (!used) throw new HttpError(401, 'This passkey is not (or no longer) allowed for this wallet.')
  if (!expectedChallenge) throw new HttpError(400, 'login expired, please try again')
  const { origin, rpID } = walletOrigin(req, wallet)
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: used.id, publicKey: unb64(used.publicKey), counter: used.counter },
    requireUserVerification: true,
  })
  if (!result.verified) throw new HttpError(401, 'passkey check failed')
  const latest = mustWallet(wallet.id)
  const current = credentialsOf(latest).find((c) => c.id === used.id)
  if (!current || (latest.epoch ?? 1) !== (wallet.epoch ?? 1)) throw new HttpError(401, 'wallet changed during login; authenticate again')
  current.counter = result.authenticationInfo.newCounter
  latest.origin ??= origin
  latest.rpID ??= rpID
  saveWallet(latest)
  const token = randomUUID()
  tokens.set(token, { walletId: wallet.id, credentialId: used.id, epoch: latest.epoch ?? 1, expires: Date.now() + 5 * 60_000 })
  return token
}

function publicView(wallet) {
  return {
    walletId: wallet.id,
    name: wallet.name ?? null,
    status: wallet.status,
    btcAddress: wallet.btcAddress,
    evmAddress: wallet.evmAddress,
    devices: credentialsOf(wallet).map((c, i) => ({ id: c.id, name: c.name ?? (i === 0 ? 'First device' : 'Another device'), addedAt: c.addedAt ?? wallet.createdAt })),
    epoch: wallet.epoch ?? 1,
  }
}

// A copy of Swissquote's part for the grace period. Production: encrypted to the escrow agent's HSM
// key, under a contract with the agent.
function depositWithEscrow(wallet) {
  const body = { token: ESCROW_DEPOSIT_TOKEN, walletId: wallet.id, name: wallet.name ?? null, epoch: wallet.epoch ?? 1, publicKey: wallet.publicKey, shareB: wallet.shareB }
  fetch(`${ESCROW_URL}/deposit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`)
      emit({ type: 'escrow_deposited', name: wallet.name })
    })
    .catch((error) => console.log(`[share] escrow agent not reached (${error.message}); Swissquote's part not deposited for ${wallet.name ?? wallet.id}`))
}

function keygenStep(sid, state, incoming, body) {
  const { session } = state
  switch (state.stage++) {
    case 1: {
      const out = session.handleMessages(incoming)
      return { messages: out.map(toWire), commitment: b64(session.calculateChainCodeCommitment()) }
    }
    case 2:
      return { messages: session.handleMessages(incoming).map(toWire) }
    case 3:
      return { messages: session.handleMessages(incoming, body.commitments.map(unb64)).map(toWire) }
    case 4: {
      session.handleMessages(incoming)
      sessions.delete(sid)
      const share = session.keyshare()
      const wallet = loadWallet(state.walletId)
      if (wallet.status !== 'keygen') throw new HttpError(409, 'wallet already created')
      const publicKey = share.publicKey
      Object.assign(wallet, {
        shareB: b64(share.toBytes()),
        publicKey: b64(publicKey),
        publicKeyCompressed: b64(secp256k1.Point.fromBytes(publicKey).toBytes(true)),
        ...addressesFor(publicKey),
        status: 'active',
        epoch: 1,
      })
      delete wallet.creationToken
      saveWallet(wallet)
      depositWithEscrow(wallet)
      emit({ type: 'wallet_created', name: wallet.name, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress })
      treasury.enqueue(wallet) // welcome bonus: test USDC + gas
      console.log(`[share] created ${wallet.name ?? wallet.id}: ${wallet.btcAddress} / ${wallet.evmAddress}`)
      return { publicKey: b64(publicKey), ...publicView(wallet) }
    }
    default:
      throw new HttpError(409, 'protocol already finished')
  }
}

function signStep(sid, state, incoming) {
  const { session } = state
  switch (state.stage++) {
    case 1:
      return { messages: session.handleMessages(incoming).map(toWire) }
    case 2:
      return { messages: session.handleMessages(incoming).map(toWire) }
    case 3: {
      session.handleMessages(incoming)
      const last = session.lastMessage(state.hash) // single use: the session is dropped right after
      sessions.delete(sid)
      emit({ type: 'signing', parties: ['A', 'B'] })
      return { messages: [toWire(last)] }
    }
    default:
      throw new HttpError(409, 'protocol already finished')
  }
}

// ---------- tiny router ----------

function match(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ')
    if (m !== method) continue
    const names = []
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`)
    const found = pathname.match(regex)
    if (found) return { handler, params: Object.fromEntries(names.map((n, i) => [n, found[i + 1]])) }
  }
  return null
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 5_000_000) reject(new HttpError(413, 'body too large'))
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new HttpError(400, 'invalid JSON'))
      }
    })
  })
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  const route = match(req.method, pathname)
  if (!route) return res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
  try {
    const body = req.method === 'POST' ? await readJson(req) : {}
    const result = await route.handler(req, route.params, body)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('[share]', error)
    else console.log(`[share] ${req.method} ${pathname} -> ${status}: ${error.message}`)
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ...error.details, error: error.message }))
  }
}).listen(PORT, () => {
  console.log(`[share] Swissquote share service (MOCK) on http://localhost:${PORT}, storage ${DATA_DIR}`)
  console.log(`[treasury] welcome bonus account: ${treasury.address}`)
})
