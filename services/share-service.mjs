// Swissquote share service (MOCK of the bank's backend): MPC party B.
// Holds Share B in its own storage, never sends it out, and only co-signs transactions it has
// decoded and checked itself. Runs as a separate process, as the challenge requires.
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
import { backupTypedData, chainHash, CHUNK_BYTES, InputError, MAILBOX, MAX_PIECE_BYTES, piecesHashOf } from './backup-mailbox.mjs'

const PORT = Number(process.env.SHARE_PORT ?? 8790)
const HUB_URL = process.env.HUB_URL ?? 'http://localhost:8787'
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, 'data', 'share-service')
const RECOVERY_DELAY_MS = Number(process.env.RECOVERY_DELAY_SEC ?? 30) * 1000 // production: 48 h
const HIGH_VALUE_USDC = 1000
// MOCK independent escrow agent (escrow-agent.mjs): receives a copy of Share B after every key
// generation, for the case "Swissquote is gone and the client lost their phone".
const ESCROW_URL = process.env.ESCROW_URL ?? 'http://localhost:8791'
const ESCROW_DEPOSIT_TOKEN = process.env.ESCROW_DEPOSIT_TOKEN ?? 'demo-escrow-deposit-token'
const RELAYS_PER_DAY = Number(process.env.RELAYS_PER_DAY ?? 10) // gasless USDC transfers Swissquote pays for, per wallet
if (!Number.isSafeInteger(RELAYS_PER_DAY) || RELAYS_PER_DAY < 0) throw new Error('RELAYS_PER_DAY must be a non-negative integer')
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
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
const recoveryProofs = new Map() // one-time, domain-separated proofs of kit possession

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

function requireRecovery(wallet, recoveryToken) {
  if (wallet.recovery?.state !== 'ready' || !recoveryToken || wallet.recovery.token !== recoveryToken)
    throw new HttpError(403, 'approved recovery session required')
}

function revokeTokens(walletId) {
  for (const [token, entry] of tokens) if (entry.walletId === walletId) tokens.delete(token)
}

// Abandoned protocol runs expire, and their WASM state is freed.
setInterval(() => {
  for (const [id, proof] of recoveryProofs) if (proof.expires < Date.now()) recoveryProofs.delete(id)
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

function requireToken(walletId, token) {
  const entry = tokens.get(token)
  const wallet = loadWallet(walletId)
  if (!entry || entry.walletId !== walletId || entry.expires < Date.now() || entry.credentialId !== wallet?.credential?.id || entry.epoch !== (wallet?.epoch ?? 1))
    throw new HttpError(401, 'passkey login required')
}

// ---------- policy: decode what we are asked to sign ----------

function evmIntent(wallet, unsignedTx) {
  const tx = parseTransaction(unsignedTx)
  if (tx.chainId !== 84532) throw new HttpError(400, 'only Base Sepolia is supported')
  let to = tx.to?.toLowerCase()
  let amount = `${formatUnits(tx.value ?? 0n, 18)} ETH`
  let usdc = 0
  if (to === USDC && tx.data) {
    const call = decodeFunctionData({ abi: erc20Abi, data: tx.data })
    if (call.functionName !== 'transfer') throw new HttpError(403, 'only plain USDC transfers are allowed')
    to = call.args[0].toLowerCase()
    usdc = Number(formatUnits(call.args[1], 6))
    amount = `${usdc} USDC`
  } else if (tx.data && tx.data !== '0x') {
    throw new HttpError(403, 'contract calls need an approved dApp (not in this prototype)')
  }
  return { hash: hexToBytes(keccak256(unsignedTx)), recipients: [to], usdc, summary: `${amount} to ${to}` }
}

// Gasless USDC: the client signs an EIP-3009 TransferWithAuthorization instead of a transaction, and
// Swissquote's relayer submits it and pays the network fee. Same policy checks as a normal transfer.
function usdcAuthorizationTypedData(from, auth) {
  return {
    domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: getAddress(USDC) },
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
  if (!auth || !isAddress(auth.to) || !isHex(auth.nonce) || auth.nonce.length !== 66) throw new HttpError(400, 'invalid USDC authorization')
  for (const field of ['value', 'validAfter', 'validBefore']) {
    if (typeof auth[field] !== 'string' || !/^\d{1,78}$/.test(auth[field]) || BigInt(auth[field]) >= 2n ** 256n)
      throw new HttpError(400, `invalid authorization ${field}`)
  }
  if (!(BigInt(auth.value) > 0n)) throw new HttpError(400, 'amount must be positive')
  if (Number(auth.validAfter) > now || Number(auth.validBefore) <= now || Number(auth.validBefore) > now + 3600)
    throw new HttpError(400, 'authorization must be valid now and for at most one hour')
  const usdc = Number(formatUnits(BigInt(auth.value), 6))
  const hash = hexToBytes(hashTypedData(usdcAuthorizationTypedData(wallet.evmAddress, auth)))
  return { hash, recipients: [auth.to.toLowerCase()], usdc, summary: `${usdc} USDC to ${auth.to} (gasless)` }
}

// On-chain kit backup: only the two mailbox messages (a friend's inbox key, a signed backup), never an
// arbitrary hash. The contract then checks this wallet's signature itself.
function backupIntent(wallet, request) {
  if (BigInt(MAILBOX) === 0n) throw new HttpError(503, 'on-chain backup is not configured (BACKUP_MAILBOX)')
  let typedData
  try {
    typedData = backupTypedData(wallet.evmAddress, request)
  } catch (error) {
    if (error instanceof InputError) throw new HttpError(400, error.message)
    throw error
  }
  const friends = request.kind === 'backup' ? request.friends.map((f) => f.toLowerCase()) : []
  const summary = request.kind === 'inbox' ? "an inbox key for holding friends' backups" : `an on-chain kit backup for ${friends.length} friends`
  return { hash: hexToBytes(hashTypedData(typedData)), recipients: friends, usdc: 0, summary, typedData }
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

  // Screening before a payment is built, for every path (also phone + kit, which the app checks
  // against its last copy of this list when Swissquote is offline). Co-signing enforces it again.
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
    saveWallet({ id, name, clientId: 'CH-1048-2231', origin, rpID, creationToken, createdAt: Date.now(), status: 'registering' })
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

  // A logged-in client on a device without Share A: passkey + recovery kit re-issue the phone share at once.
  'POST /wallets/:id/pair': (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    walletOrigin(req, wallet)
    wallet.pairing = { token: randomUUID(), expires: Date.now() + 5 * 60_000 }
    saveWallet(wallet)
    console.log(`[share] re-pairing a device for ${wallet.name ?? id}: passkey verified, waiting for the kit`)
    return { pairingToken: wallet.pairing.token }
  },

  // Kit lost or stolen: phone (A) + Swissquote (B) re-issue all three shares, so the old kit stops working.
  'POST /wallets/:id/kit/replace': (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    walletOrigin(req, wallet)
    if (wallet.recovery?.state === 'pending' || wallet.recovery?.state === 'ready')
      throw new HttpError(409, 'A recovery is in progress. Cancel it before replacing the kit.')
    wallet.kitReplace = { token: randomUUID(), expires: Date.now() + 5 * 60_000 }
    saveWallet(wallet)
    console.log(`[share] kit replacement for ${wallet.name ?? id}: passkey verified, phone + Swissquote re-issue the shares`)
    return { kitReplaceToken: wallet.kitReplace.token }
  },

  'POST /wallets/:id/passkey': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'registering' && wallet.recovery?.state !== 'ready') throw new HttpError(409, 'passkey already registered')
    const creating = wallet.status === 'registering'
    if (creating) {
      if (!body.creationToken || body.creationToken !== wallet.creationToken) throw new HttpError(403, 'wallet creation session required')
    } else requireRecovery(wallet, body.recoveryToken)
    const { origin, rpID } = walletOrigin(req, wallet)
    const challengeKey = creating ? `register:${id}` : `recover:${body.recoveryToken}`
    const expectedChallenge = takeChallenge(challengeKey)
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
    // Async verification must not resurrect a cancelled or superseded recovery.
    const latest = mustWallet(id)
    const registered = { id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter }
    if (creating) {
      if (latest.status !== 'registering') throw new HttpError(409, 'registration already completed')
      latest.credential = registered
      latest.status = 'keygen'
    } else {
      requireRecovery(latest, body.recoveryToken)
      latest.recovery.pendingCredential = registered
    }
    saveWallet(latest)
    return { ok: true }
  },

  // New passkey for the new phone, only once a recovery has passed its delay.
  'POST /wallets/:id/passkey/options': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    requireRecovery(wallet, body.recoveryToken)
    const { rpID } = walletOrigin(req, wallet)
    const options = await registrationOptions(rpID, wallet.name ?? 'Swissquote client')
    requireRecovery(mustWallet(id), body.recoveryToken)
    saveChallenge(`recover:${body.recoveryToken}`, options.challenge)
    return { options }
  },

  // 2. Distributed key generation (new wallet) or lost-share recovery: Swissquote is party 1.
  'POST /wallets/:id/keygen/start': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if ([...sessions.values()].some((s) => s.walletId === id && s.kind !== 'sign')) throw new HttpError(409, 'a key generation session is already running')
    let session
    let kind
    if (wallet.status === 'keygen' && wallet.credential) {
      if (!body.creationToken || body.creationToken !== wallet.creationToken) throw new HttpError(403, 'wallet creation session required')
      kind = 'create'
      session = new KeygenSession(3, 2, 1)
    } else if (wallet.recovery?.state === 'ready' && wallet.recovery.pendingCredential) {
      requireRecovery(wallet, body.recoveryToken)
      kind = 'recover'
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(wallet.shareB)), new Uint8Array([0]))
    } else if (wallet.pairing && wallet.pairing.expires > Date.now()) {
      if (!body.pairingToken || body.pairingToken !== wallet.pairing.token) throw new HttpError(403, 'device pairing session required')
      kind = 'pair'
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(wallet.shareB)), new Uint8Array([0]))
    } else if (wallet.kitReplace && wallet.kitReplace.expires > Date.now()) {
      if (!body.kitReplaceToken || body.kitReplaceToken !== wallet.kitReplace.token) throw new HttpError(403, 'kit replacement session required')
      kind = 'replace-kit'
      // Party 2 (the kit) is the lost share; phone and Swissquote rebuild it and refresh their own.
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(wallet.shareB)), new Uint8Array([2]))
    } else {
      throw new HttpError(409, 'wallet is not ready for key generation')
    }
    const sid = randomUUID()
    const first = session.createFirstMessage()
    sessions.set(sid, { kind, walletId: id, session, stage: 1, created: Date.now(), epoch: wallet.epoch ?? 1, recoveryToken: body.recoveryToken, pairingToken: body.pairingToken, kitReplaceToken: body.kitReplaceToken })
    return { sessionId: sid, kind, messages: [toWire(first)] }
  },

  'POST /mpc/:sid': (req, { sid }, body) => {
    const state = sessions.get(sid)
    if (!state) throw new HttpError(404, 'unknown or finished session')
    walletOrigin(req, mustWallet(state.walletId))
    if (state.kind === 'recover') requireRecovery(mustWallet(state.walletId), state.recoveryToken)
    const incoming = (body.messages ?? []).map(fromWire)
    if (state.proofId && incoming.some((m) => m.from_id !== 2)) throw new HttpError(403, 'recovery proof requires the kit party')
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

  // 3. Log in with the passkey before co-signing (short-lived token).
  'POST /wallets/:id/auth/options': async (req, { id }) => {
    const wallet = mustWallet(id)
    if (!wallet.credential) throw new HttpError(409, 'no passkey registered')
    const { rpID } = walletOrigin(req, wallet)
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [{ id: wallet.credential.id }],
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
    if ((body.epoch ?? 1) !== (wallet.epoch ?? 1)) {
      emit({ type: 'replaced_device_refused', name: wallet.name })
      throw new HttpError(409, 'This phone was replaced by a recovery or a newly paired device. Its key share is no longer valid.')
    }
    const intent =
      body.chain === 'bitcoin'
        ? btcIntent(wallet, body.psbt, body.inputIndex ?? 0)
        : body.chain === 'base-gasless'
          ? gaslessIntent(wallet, body.authorization)
          : body.chain === 'backup'
            ? backupIntent(wallet, body.backup)
            : evmIntent(wallet, body.unsignedTx)
    screenRecipients(wallet, intent.recipients)
    if (intent.usdc > HIGH_VALUE_USDC && !body.confirmHighValue)
      throw new HttpError(428, `transfers above ${HIGH_VALUE_USDC} USDC need an extra confirmation`)
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

  // Only a fixed, random recovery challenge can be signed with B + C here. Never an arbitrary hash.
  'POST /wallets/:id/recovery/proof/start': (req, { id }) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    const proofId = randomUUID()
    const hash = new Uint8Array(createHash('sha256').update(`Swissquote recovery proof v1:${id}:${wallet.epoch ?? 1}:${proofId}`).digest())
    recoveryProofs.set(proofId, { walletId: id, hash, epoch: wallet.epoch ?? 1, expires: Date.now() + 120_000 })
    const session = new SignSession(Keyshare.fromBytes(unb64(wallet.shareB)), 'm')
    const sid = randomUUID()
    sessions.set(sid, { kind: 'sign', walletId: id, session, stage: 1, hash, created: Date.now(), proofId })
    return { proofId, sessionId: sid, hash: b64(hash), messages: [toWire(session.createFirstMessage())] }
  },

  // 5. Recovery: actual kit possession + mock re-KYC + owner-vetoable delay.
  'POST /wallets/:id/recovery/request': (req, { id }, body) => {
    const wallet = mustWallet(id)
    walletOrigin(req, wallet)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    const attacker = body.kyc !== 'match'
    emit({ type: 'recovery_requested', by: attacker ? 'attacker' : 'client' })
    if (attacker) {
      emit({ type: 'recovery_refused', reason: 'Liveness selfie does not match the KYC profile' })
      throw new HttpError(403, 'Identity check failed: the selfie does not match the client on file. Recovery refused and the client was alerted.')
    }
    const proof = recoveryProofs.get(body.proofId)
    recoveryProofs.delete(body.proofId)
    if (!proof || !proof.signed || proof.walletId !== id || proof.expires < Date.now() || proof.epoch !== (wallet.epoch ?? 1))
      throw new HttpError(403, 'a fresh recovery-kit possession proof is required')
    let valid = false
    try {
      valid = secp256k1.verify(unb64(body.signature), proof.hash, unb64(wallet.publicKey), { prehash: false, lowS: false })
    } catch {}
    if (!valid) throw new HttpError(403, 'invalid recovery-kit possession proof')
    // A page reload may lose its bearer token. A new valid kit proof can resume, but never reset,
    // an existing delay or replace its pending credential.
    if (wallet.recovery?.state === 'pending' || wallet.recovery?.state === 'ready') {
      wallet.recovery.token ??= randomUUID() // allow an earlier prototype request to resume safely
      saveWallet(wallet)
      return { ...publicView(wallet), recoveryToken: wallet.recovery.token }
    }
    const recoveryToken = randomUUID()
    wallet.recovery = { state: 'pending', token: recoveryToken, requestedAt: Date.now(), readyAt: Date.now() + RECOVERY_DELAY_MS }
    saveWallet(wallet)
    console.log(`[share] recovery requested for ${id}, ready in ${RECOVERY_DELAY_MS / 1000}s; alerts sent to all client channels (mock)`)
    return { ...publicView(wallet), recoveryToken }
  },

  // 6. Owner veto: whoever still holds the current passkey can stop a recovery during the delay
  //    (and after it, until MPC recovery completes and commits the pending passkey).
  'POST /wallets/:id/recovery/cancel': (req, { id }, body) => {
    const wallet = mustWallet(id)
    requireToken(id, body.token)
    const r = wallet.recovery
    if (!r || !(r.state === 'pending' || r.state === 'ready'))
      throw new HttpError(409, 'There is no recovery to cancel.')
    wallet.recovery = { state: 'cancelled', requestedAt: r.requestedAt, readyAt: r.readyAt, cancelledAt: Date.now() }
    for (const [sid, state] of sessions) if (state.walletId === id && state.kind === 'recover') {
      sessions.delete(sid)
      try { state.session.free() } catch {}
    }
    saveWallet(wallet)
    emit({ type: 'recovery_cancelled', name: wallet.name })
    console.log(`[share] recovery for ${wallet.name ?? id} cancelled by the owner's passkey`)
    return publicView(wallet)
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
      hash = await treasury.relayUsdcAuthorization(typedData.message, body.signature)
    } catch (error) {
      if (treasuryEmpty(error)) throw new HttpError(409, `Free transfers are unavailable: Swissquote's fee account is empty (top up ${treasury.address}). Tick "Pay it myself" to use your own ETH.`)
      // e.g. "transfer amount exceeds balance": USDC already accepted the signature at that point.
      throw new HttpError(400, `USDC rejected the transfer: ${error.cause?.reason ?? error.shortMessage ?? error.message}`)
    }
    console.log(`[share] relayed gasless ${formatUnits(typedData.message.value, 6)} USDC for ${wallet.name ?? id}: ${hash}`)
    return { hash, sponsoredBy: treasury.address, remainingToday: reservation.remaining }
  },

  // 8. On-chain kit backup (contracts/src/KitBackupMailbox.sol). The treasury pays the gas, only for
  //    messages this wallet signed with phone + Swissquote in the same passkey session.
  'POST /wallets/:id/backup/inbox': async (req, { id }, body) => {
    const { wallet, typedData } = await approvedBackup(req, id, body, 'inbox')
    const hash = await relayBackup(() => treasury.backup.registerInboxKey(typedData.message.owner, typedData.message.key, body.signature))
    emit({ type: 'inbox_registered', name: wallet.name, hash })
    console.log(`[share] ${wallet.name ?? id} can now hold friends' backups: ${hash}`)
    return { hash }
  },

  'POST /wallets/:id/backup/create': async (req, { id }, body) => {
    const { wallet, typedData } = await approvedBackup(req, id, body, 'backup')
    const m = typedData.message
    const { pieces, chunks } = body
    if (!Array.isArray(pieces) || pieces.length !== m.friends.length || !pieces.every((p) => isHex(p) && p.length > 2 && p.length <= 2 + 2 * MAX_PIECE_BYTES))
      throw new HttpError(400, 'one encrypted piece per friend is required')
    if (piecesHashOf(pieces) !== m.piecesHash.toLowerCase()) throw new HttpError(400, 'the pieces do not match the signed backup')
    if (!Array.isArray(chunks) || chunks.length !== m.kitChunks || !chunks.every((c) => isHex(c) && c.length > 2 && c.length <= 2 + 2 * CHUNK_BYTES))
      throw new HttpError(400, 'invalid kit chunks')
    if (chainHash(chunks) !== m.kitHash.toLowerCase()) throw new HttpError(400, 'the kit chunks do not match the signed backup')
    const args = [m.wallet, m.setId, m.kitHash, m.kitChunks, m.friends, pieces, body.signature]
    const { create, uploads } = await relayBackup(() => treasury.backup.createBackup(args, chunks))
    emit({ type: 'backup_onchain', name: wallet.name, friends: m.friends.length, hash: create })
    console.log(`[share] on-chain kit backup for ${wallet.name ?? id} with ${m.friends.length} friends: ${create} + ${uploads.length} kit chunks`)
    return { hash: create, uploads }
  },

  // A friend gives a piece back to the client's new phone. No login: the piece is encrypted to that
  // phone's one-time key, and the contract caps the returns per request. Rate-limited because the
  // treasury pays.
  'POST /backup/return': async (req, params, body) => {
    if (!isHex(body.requestId) || body.requestId.length !== 66) throw new HttpError(400, 'invalid request id')
    if (!isHex(body.sealed) || body.sealed.length <= 2 || body.sealed.length > 2 + 2 * MAX_PIECE_BYTES) throw new HttpError(400, 'invalid piece')
    if (!takeReturnSlot()) throw new HttpError(429, 'too many pieces given back in the last hour; try again later')
    const hash = await relayBackup(() => treasury.backup.returnPiece(body.requestId, body.sealed))
    emit({ type: 'piece_returned', hash, name: typeof body.from === 'string' ? body.from.slice(0, 40) : undefined })
    console.log(`[share] a friend gave back a backup piece: ${hash}`)
    return { hash }
  },
}

async function approvedBackup(req, id, body, kind) {
  const wallet = mustWallet(id)
  walletOrigin(req, wallet)
  if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
  requireToken(id, body.token)
  if (body.backup?.kind !== kind) throw new HttpError(400, `expected a ${kind} message`)
  const intent = backupIntent(wallet, body.backup)
  // Same rule as the gasless relay: the treasury only pays for the message approved in this passkey session.
  if (tokens.get(body.token).signingIntent !== b64(intent.hash)) throw new HttpError(403, 'the backup must be approved by Swissquote in this passkey session')
  let signer
  try {
    signer = await recoverTypedDataAddress({ ...intent.typedData, signature: body.signature })
  } catch {
    throw new HttpError(401, 'invalid backup signature')
  }
  if (signer !== getAddress(wallet.evmAddress)) throw new HttpError(401, 'the backup is not signed by this wallet')
  return { wallet, typedData: intent.typedData }
}

async function relayBackup(task) {
  try {
    return await task()
  } catch (error) {
    const reason = error.cause?.reason ?? error.cause?.data?.errorName ?? error.shortMessage ?? error.message
    if (treasuryEmpty(error)) throw new HttpError(409, `Swissquote's fee account is empty, so it cannot pay the network fee. Top up ${treasury.address} with Base Sepolia ETH.`)
    throw new HttpError(400, `The backup contract refused: ${reason}`)
  }
}

// "insufficient funds" when sending, "gas required exceeds allowance (0)" when estimating gas.
const treasuryEmpty = (error) => /insufficient funds|exceeds allowance \(0\)/i.test(`${error?.message} ${error?.cause?.message ?? ''} ${error?.shortMessage ?? ''}`)

const returnTimes = []
function takeReturnSlot() {
  const hourAgo = Date.now() - 3_600_000
  while (returnTimes.length && returnTimes[0] < hourAgo) returnTimes.shift()
  if (returnTimes.length >= 60) return false
  returnTimes.push(Date.now())
  return true
}

function mustWallet(id) {
  const wallet = loadWallet(id)
  if (!wallet) throw new HttpError(404, 'unknown wallet')
  if (wallet.recovery?.state === 'pending' && Date.now() >= wallet.recovery.readyAt) {
    wallet.recovery.state = 'ready'
    saveWallet(wallet)
  }
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
    if (wallet.credential?.id === credentialId) return mustWallet(wallet.id)
  }
  return null
}

async function verifyLogin(req, wallet, response, expectedChallenge) {
  if (!wallet.credential) throw new HttpError(409, 'no passkey registered')
  if (!expectedChallenge) throw new HttpError(400, 'login expired, please try again')
  const { origin, rpID } = walletOrigin(req, wallet)
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: wallet.credential.id, publicKey: unb64(wallet.credential.publicKey), counter: wallet.credential.counter },
    requireUserVerification: true,
  })
  if (!result.verified) throw new HttpError(401, 'passkey check failed')
  const latest = mustWallet(wallet.id)
  if (latest.credential?.id !== wallet.credential.id || (latest.epoch ?? 1) !== (wallet.epoch ?? 1)) throw new HttpError(401, 'wallet changed during login; authenticate again')
  latest.credential.counter = result.authenticationInfo.newCounter
  latest.origin ??= origin
  latest.rpID ??= rpID
  saveWallet(latest)
  const token = randomUUID()
  tokens.set(token, { walletId: wallet.id, credentialId: latest.credential.id, epoch: latest.epoch ?? 1, expires: Date.now() + 5 * 60_000 })
  return token
}

function publicView(wallet) {
  return {
    walletId: wallet.id,
    name: wallet.name ?? null,
    status: wallet.status,
    btcAddress: wallet.btcAddress,
    evmAddress: wallet.evmAddress,
    // Bumped whenever recovery or pairing issues new shares: a device holding an older share was replaced.
    epoch: wallet.epoch ?? 1,
    recovery: wallet.recovery
      ? {
          state: wallet.recovery.state,
          readyAt: wallet.recovery.readyAt,
          cancelledAt: wallet.recovery.cancelledAt ?? null,
          // Registering a new passkey only stages it; the owner can veto until recovery commits.
          canCancel: wallet.recovery.state === 'pending' || wallet.recovery.state === 'ready',
        }
      : null,
  }
}

// Production: Share B encrypted to the escrow agent's HSM key, under a contract with the agent.
function depositWithEscrow(wallet, announce) {
  const body = { token: ESCROW_DEPOSIT_TOKEN, walletId: wallet.id, name: wallet.name ?? null, epoch: wallet.epoch ?? 1, publicKey: wallet.publicKey, shareB: wallet.shareB }
  fetch(`${ESCROW_URL}/deposit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`)
      if (announce) emit({ type: 'escrow_deposited', name: wallet.name })
    })
    .catch((error) => console.log(`[share] escrow agent not reached (${error.message}); Share B not deposited for ${wallet.name ?? wallet.id}`))
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
      if ((wallet.epoch ?? 1) !== state.epoch) throw new HttpError(409, 'wallet shares changed during key generation')
      if (state.kind === 'recover') requireRecovery(wallet, state.recoveryToken)
      if (state.kind === 'pair' && (wallet.pairing?.token !== state.pairingToken || wallet.pairing.expires < Date.now())) throw new HttpError(403, 'device pairing expired')
      if (state.kind === 'replace-kit' && (wallet.kitReplace?.token !== state.kitReplaceToken || wallet.kitReplace.expires < Date.now()))
        throw new HttpError(403, 'kit replacement expired')
      const publicKey = share.publicKey
      if (state.kind !== 'create' && b64(publicKey) !== wallet.publicKey) throw new HttpError(500, 'recovery produced a different key')
      Object.assign(wallet, {
        shareB: b64(share.toBytes()),
        publicKey: b64(publicKey),
        publicKeyCompressed: b64(secp256k1.Point.fromBytes(publicKey).toBytes(true)),
        ...addressesFor(publicKey),
        status: 'active',
        // New shares for everyone: Share B changed, so the replaced device's Share A no longer pairs with it.
        epoch: state.kind === 'create' ? 1 : (wallet.epoch ?? 1) + 1,
      })
      if (state.kind === 'recover') {
        wallet.credential = wallet.recovery.pendingCredential
        wallet.recovery = { state: 'completed', completedAt: Date.now() }
      }
      if (state.kind === 'pair') delete wallet.pairing
      if (state.kind === 'replace-kit') delete wallet.kitReplace
      delete wallet.creationToken
      if (state.kind !== 'create') {
        revokeTokens(wallet.id)
        for (const [pendingSid, pending] of sessions) if (pending.walletId === wallet.id) {
          sessions.delete(pendingSid)
          try { pending.session.free() } catch {}
        }
      }
      saveWallet(wallet)
      depositWithEscrow(wallet, state.kind === 'create')
      if (state.kind === 'create') {
        emit({ type: 'wallet_created', name: wallet.name, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress })
        treasury.enqueue(wallet) // welcome bonus: test USDC + gas
      }
      else if (state.kind === 'pair') emit({ type: 'device_paired', name: wallet.name })
      else if (state.kind === 'replace-kit') emit({ type: 'kit_replaced', name: wallet.name })
      else emit({ type: 'recovery_completed' })
      console.log(`[share] ${state.kind} done for ${wallet.name ?? wallet.id}: ${wallet.btcAddress} / ${wallet.evmAddress}`)
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
      if (state.proofId) {
        const proof = recoveryProofs.get(state.proofId)
        if (proof) proof.signed = true
      } else emit({ type: 'signing', parties: ['A', 'B'] })
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
