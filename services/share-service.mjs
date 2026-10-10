// Swissquote share service (MOCK of the bank's backend): MPC party B.
// Holds Share B in its own storage, never sends it out, and only co-signs transactions it has
// decoded and checked itself. Runs as a separate process, as the challenge requires.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
import { decodeFunctionData, erc20Abi, formatUnits, getAddress, hexToBytes, keccak256, parseTransaction, toHex } from 'viem'

const PORT = Number(process.env.SHARE_PORT ?? 8790)
const HUB_URL = process.env.HUB_URL ?? 'http://localhost:8787'
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, 'data', 'share-service')
const RECOVERY_DELAY_MS = Number(process.env.RECOVERY_DELAY_SEC ?? 30) * 1000 // production: 48 h
const HIGH_VALUE_USDC = 1000
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
// Clearly fake addresses standing in for a sanctions list (mock compliance provider).
const SANCTIONED = new Set(['0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e'])

mkdirSync(join(DATA_DIR, 'wallets'), { recursive: true })

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
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const originOf = (req) => {
  const origin = req.headers.origin
  if (!origin) throw new HttpError(400, 'missing Origin header')
  return { origin, rpID: new URL(origin).hostname }
}

// ---------- in-memory protocol state ----------

const challenges = new Map() // walletId -> expected WebAuthn challenge
const tokens = new Map() // token -> { walletId, expires }
const sessions = new Map() // sessionId -> { kind, walletId, session, stage, hash?, created }

// Abandoned protocol runs expire, and their WASM state is freed.
setInterval(() => {
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
  if (!entry || entry.walletId !== walletId || entry.expires < Date.now()) throw new HttpError(401, 'passkey login required')
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

  // 1. A client starts creating a wallet: register the passkey that will authorise co-signing.
  'POST /wallets': async (req, params, body) => {
    const { rpID } = originOf(req)
    const name = String(body.name ?? '').trim()
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Please enter your name (2–60 characters).')
    const id = randomUUID()
    const options = await registrationOptions(rpID, name)
    challenges.set(id, options.challenge)
    saveWallet({ id, name, clientId: 'CH-1048-2231', createdAt: Date.now(), status: 'registering' })
    return { walletId: id, options }
  },

  // Log in with an existing passkey: no wallet id needed, the browser offers the passkeys it has for this site.
  'POST /login/options': async (req) => {
    const { rpID } = originOf(req)
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
    const challengeId = randomUUID()
    challenges.set(challengeId, options.challenge)
    return { challengeId, options }
  },

  'POST /login': async (req, params, body) => {
    const wallet = findWalletByCredential(body.response?.id)
    if (!wallet) throw new HttpError(404, 'This passkey does not belong to any wallet on this server. Create a new wallet instead.')
    const token = await verifyLogin(req, wallet, body.response, challenges.get(body.challengeId))
    challenges.delete(body.challengeId)
    return { token, ...publicView(wallet) }
  },

  // A logged-in client on a device without Share A: passkey + recovery kit re-issue the phone share at once.
  'POST /wallets/:id/pair': (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    wallet.pairing = { expires: Date.now() + 5 * 60_000 }
    saveWallet(wallet)
    console.log(`[share] re-pairing a device for ${wallet.name ?? id}: passkey verified, waiting for the kit`)
    return { ok: true }
  },

  'POST /wallets/:id/passkey': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'registering' && wallet.recovery?.state !== 'ready') throw new HttpError(409, 'passkey already registered')
    const { origin, rpID } = originOf(req)
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenges.get(id),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
    if (!result.verified) throw new HttpError(401, 'passkey registration failed')
    const { credential } = result.registrationInfo
    wallet.credential = { id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter }
    if (wallet.status === 'registering') wallet.status = 'keygen'
    else wallet.recovery.passkeyReplaced = true
    saveWallet(wallet)
    return { ok: true }
  },

  // New passkey for the new phone, only once a recovery has passed its delay.
  'POST /wallets/:id/passkey/options': async (req, { id }) => {
    const wallet = mustWallet(id)
    if (wallet.recovery?.state !== 'ready') throw new HttpError(403, 'no approved recovery')
    const { rpID } = originOf(req)
    const options = await registrationOptions(rpID, wallet.name ?? 'Swissquote client')
    challenges.set(id, options.challenge)
    return { options }
  },

  // 2. Distributed key generation (new wallet) or lost-share recovery: Swissquote is party 1.
  'POST /wallets/:id/keygen/start': (req, { id }) => {
    const wallet = mustWallet(id)
    let session
    let kind
    if (wallet.status === 'keygen' && wallet.credential) {
      kind = 'create'
      session = new KeygenSession(3, 2, 1)
    } else if (wallet.recovery?.state === 'ready' && wallet.recovery.passkeyReplaced) {
      kind = 'recover'
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(wallet.shareB)), new Uint8Array([0]))
    } else if (wallet.pairing && wallet.pairing.expires > Date.now()) {
      kind = 'pair'
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(wallet.shareB)), new Uint8Array([0]))
    } else {
      throw new HttpError(409, 'wallet is not ready for key generation')
    }
    const sid = randomUUID()
    const first = session.createFirstMessage()
    sessions.set(sid, { kind, walletId: id, session, stage: 1, created: Date.now() })
    return { sessionId: sid, kind, messages: [toWire(first)] }
  },

  'POST /mpc/:sid': (req, { sid }, body) => {
    const state = sessions.get(sid)
    if (!state) throw new HttpError(404, 'unknown or finished session')
    const incoming = (body.messages ?? []).map(fromWire)
    return state.kind === 'sign' ? signStep(sid, state, incoming) : keygenStep(sid, state, incoming, body)
  },

  'GET /wallets/:id': (req, { id }) => publicView(mustWallet(id)),

  // 3. Log in with the passkey before co-signing (short-lived token).
  'POST /wallets/:id/auth/options': async (req, { id }) => {
    const wallet = mustWallet(id)
    if (!wallet.credential) throw new HttpError(409, 'no passkey registered')
    const { rpID } = originOf(req)
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [{ id: wallet.credential.id }],
      userVerification: 'required',
    })
    challenges.set(id, options.challenge)
    return { options }
  },

  'POST /wallets/:id/login': async (req, { id }, body) => {
    const wallet = mustWallet(id)
    return { token: await verifyLogin(req, wallet, body.response, challenges.get(id)) }
  },

  // 4. Co-sign: decode the transaction, apply policy, then run the signing protocol on our own hash.
  'POST /wallets/:id/sign/start': (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    requireToken(id, body.token)
    const intent = body.chain === 'bitcoin' ? btcIntent(wallet, body.psbt, body.inputIndex ?? 0) : evmIntent(wallet, body.unsignedTx)
    for (const r of intent.recipients) if (SANCTIONED.has(r?.toLowerCase())) throw new HttpError(403, `recipient ${r} is on the sanctions list (mock screening)`)
    if (intent.usdc > HIGH_VALUE_USDC && !body.confirmHighValue)
      throw new HttpError(428, `transfers above ${HIGH_VALUE_USDC} USDC need an extra confirmation`)
    const session = new SignSession(Keyshare.fromBytes(unb64(wallet.shareB)), 'm')
    const sid = randomUUID()
    const first = session.createFirstMessage()
    sessions.set(sid, { kind: 'sign', walletId: id, session, stage: 1, hash: intent.hash, created: Date.now() })
    console.log(`[share] co-signing ${intent.summary}`)
    return { sessionId: sid, messages: [toWire(first)], hash: b64(intent.hash) }
  },

  // 5. Recovery: re-KYC (mocked) + a delay with alerts before a new phone share can be issued.
  'POST /wallets/:id/recovery/request': (req, { id }, body) => {
    const wallet = mustWallet(id)
    if (wallet.status !== 'active') throw new HttpError(409, 'wallet not active')
    const attacker = body.kyc !== 'match'
    emit({ type: 'recovery_requested', by: attacker ? 'attacker' : 'client' })
    if (attacker) {
      emit({ type: 'recovery_refused', reason: 'Liveness selfie does not match the KYC profile' })
      throw new HttpError(403, 'Identity check failed: the selfie does not match the client on file. Recovery refused and the client was alerted.')
    }
    wallet.recovery = { state: 'pending', requestedAt: Date.now(), readyAt: Date.now() + RECOVERY_DELAY_MS }
    saveWallet(wallet)
    console.log(`[share] recovery requested for ${id}, ready in ${RECOVERY_DELAY_MS / 1000}s; alerts sent to all client channels (mock)`)
    return publicView(wallet)
  },
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
  const { origin, rpID } = originOf(req)
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: wallet.credential.id, publicKey: unb64(wallet.credential.publicKey), counter: wallet.credential.counter },
    requireUserVerification: true,
  })
  if (!result.verified) throw new HttpError(401, 'passkey check failed')
  wallet.credential.counter = result.authenticationInfo.newCounter
  saveWallet(wallet)
  const token = randomUUID()
  tokens.set(token, { walletId: wallet.id, expires: Date.now() + 5 * 60_000 })
  return token
}

function publicView(wallet) {
  return {
    walletId: wallet.id,
    name: wallet.name ?? null,
    status: wallet.status,
    btcAddress: wallet.btcAddress,
    evmAddress: wallet.evmAddress,
    recovery: wallet.recovery ? { state: wallet.recovery.state, readyAt: wallet.recovery.readyAt } : null,
  }
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
      const publicKey = share.publicKey
      if (state.kind !== 'create' && b64(publicKey) !== wallet.publicKey) throw new HttpError(500, 'recovery produced a different key')
      Object.assign(wallet, {
        shareB: b64(share.toBytes()),
        publicKey: b64(publicKey),
        publicKeyCompressed: b64(secp256k1.Point.fromBytes(publicKey).toBytes(true)),
        ...addressesFor(publicKey),
        status: 'active',
      })
      if (state.kind === 'recover') wallet.recovery = { state: 'completed', completedAt: Date.now() }
      if (state.kind === 'pair') delete wallet.pairing
      saveWallet(wallet)
      if (state.kind === 'create') emit({ type: 'wallet_created', name: wallet.name, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress })
      else if (state.kind === 'pair') emit({ type: 'device_paired', name: wallet.name })
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
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }))
  }
}).listen(PORT, () => console.log(`[share] Swissquote share service (MOCK) on http://localhost:${PORT}, storage ${DATA_DIR}`))
