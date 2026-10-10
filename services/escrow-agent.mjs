// MOCK independent escrow agent (for example a Swiss notary). Separate process, own storage, own port.
//
// Swissquote deposits a copy of its part when a wallet is created (production: encrypted to the agent's
// HSM). The agent never signs payments. It runs the GRACE PERIOD: if Swissquote stays unreachable for
// ESCROW_OUTAGE_SEC (production: six months; demo: 30 s), a device that proves it holds the client's
// part (by co-signing a one-time challenge with the agent) receives the copy, and the agent deletes it.
// From then on that device signs alone. Swissquote and the agent hold the same part, so together they
// still cannot move the funds.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import { secp256k1 } from '@noble/curves/secp256k1.js'

const PORT = Number(process.env.ESCROW_PORT ?? 8791)
const SHARE_URL = process.env.SHARE_URL ?? 'http://localhost:8790'
const HUB_URL = process.env.HUB_URL ?? 'http://localhost:8787'
const OUTAGE_MS = Number(process.env.ESCROW_OUTAGE_SEC ?? 30) * 1000 // the grace period; production: six months
const DEPOSIT_TOKEN = process.env.ESCROW_DEPOSIT_TOKEN ?? 'demo-escrow-deposit-token' // shared with the share service
const DATA_DIR = process.env.ESCROW_DATA_DIR ?? join(import.meta.dirname, 'data', 'escrow-agent')
mkdirSync(DATA_DIR, { recursive: true })

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'))
const toWire = (m) => ({ from: m.from_id, to: m.to_id ?? null, payload: b64(m.payload) })
const fromWire = (w) => new Message(unb64(w.payload), w.from, w.to ?? undefined)

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const depositPath = (id) => join(DATA_DIR, `${id.replace(/[^\w-]/g, '')}.json`)
const loadDeposit = (id) => (existsSync(depositPath(id)) ? JSON.parse(readFileSync(depositPath(id), 'utf8')) : null)
const emit = (event) =>
  fetch(`${HUB_URL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }).catch(() => {})

// ---------- is Swissquote still there? ----------

let swissquoteDownSince = null
async function watchSwissquote() {
  try {
    const res = await fetch(`${SHARE_URL}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) throw new Error()
    swissquoteDownSince = null
  } catch {
    swissquoteDownSince ??= Date.now()
  }
}
setInterval(watchSwissquote, 2000)
watchSwissquote()

const releaseAfter = () => (swissquoteDownSince === null ? null : swissquoteDownSince + OUTAGE_MS)

// ---------- API ----------

const sessions = new Map() // sid -> { walletId, session, stage }

const routes = {
  // Called by the share service when a wallet is created.
  'POST /deposit': (body) => {
    if (body.token !== DEPOSIT_TOKEN) throw new HttpError(401, 'unknown depositor')
    if (!body.walletId || !body.shareB || !body.publicKey) throw new HttpError(400, 'walletId, shareB and publicKey are required')
    writeFileSync(
      depositPath(body.walletId),
      JSON.stringify({ walletId: body.walletId, name: body.name ?? null, epoch: body.epoch, publicKey: body.publicKey, shareB: body.shareB, at: Date.now() }),
    )
    console.log(`[escrow] holding a copy of Swissquote's part (epoch ${body.epoch}) for ${body.name ?? body.walletId}`)
    return { ok: true }
  },

  'GET /wallets/:id': (_body, { id }) => {
    const deposit = loadDeposit(id)
    return {
      deposited: !!deposit,
      epoch: deposit?.epoch ?? null,
      graceSeconds: OUTAGE_MS / 1000,
      // Fingerprint of the copy it holds (never the copy): equals Swissquote's, because it is the same part.
      fingerprint: deposit ? createHash('sha256').update(unb64(deposit.shareB)).digest('hex').slice(0, 16) : null,
      swissquoteOnline: swissquoteDownSince === null,
      releaseAfter: releaseAfter(),
    }
  },

  // Grace period over: the device proves it holds the client's part by co-signing a one-time challenge.
  'POST /wallets/:id/takeover/start': (body, { id }) => {
    const deposit = loadDeposit(id)
    if (!deposit) throw new HttpError(404, "The escrow agent holds no copy of Swissquote's part for this wallet.")
    const after = releaseAfter()
    if (after === null) throw new HttpError(409, 'Swissquote is still operating. The grace period only starts when Swissquote is unreachable.')
    if (Date.now() < after) throw new HttpError(425, `The grace period is still running: ${Math.ceil((after - Date.now()) / 1000)} s left.`)
    if ([...sessions.values()].some((s) => s.walletId === id)) throw new HttpError(409, 'a takeover is already running')
    const hash = createHash('sha256').update(`swissquote-takeover:${id}:`).update(randomBytes(32)).digest()
    const session = new SignSession(Keyshare.fromBytes(unb64(deposit.shareB)), 'm')
    const sid = randomUUID()
    sessions.set(sid, { walletId: id, session, stage: 1, kind: 'takeover', hash, publicKey: deposit.publicKey, name: deposit.name, created: Date.now() })
    return { sessionId: sid, messages: [toWire(session.createFirstMessage())], hash: b64(hash) }
  },

  'POST /wallets/:id/takeover/finish': (body, { id }) => {
    const state = sessions.get(body.sessionId)
    if (!state || state.kind !== 'takeover' || state.walletId !== id || state.stage !== 'signed') throw new HttpError(404, 'unknown or unfinished takeover')
    sessions.delete(body.sessionId)
    let valid = false
    try {
      valid = secp256k1.verify(unb64(body.signature), state.hash, unb64(state.publicKey), { prehash: false, lowS: false })
    } catch {}
    if (!valid) {
      emit({ type: 'escrow_refused', reason: "The device could not prove it holds the client's part" })
      throw new HttpError(403, "This device could not prove it holds the wallet's key part.")
    }
    const deposit = loadDeposit(id)
    if (!deposit) throw new HttpError(404, 'already released')
    rmSync(depositPath(id), { force: true }) // released once, then the agent keeps nothing
    emit({ type: 'takeover_released', name: deposit.name ?? undefined })
    console.log(`[escrow] grace period over: released Swissquote's part to ${deposit.name ?? id}'s device; deposit deleted`)
    return { shareB: deposit.shareB }
  },

  'POST /mpc/:sid': (body, { sid }) => {
    const state = sessions.get(sid)
    if (!state) throw new HttpError(404, 'unknown or finished session')
    const incoming = (body.messages ?? []).map(fromWire)
    const { session } = state
    if (state.stage === 1 || state.stage === 2) {
      state.stage++
      return { messages: session.handleMessages(incoming).map(toWire) }
    }
    if (state.stage === 3) {
      session.handleMessages(incoming)
      state.stage = 'signed'
      return { messages: [toWire(session.lastMessage(state.hash))] }
    }
    throw new HttpError(409, 'protocol already finished')
  },

  'GET /health': () => ({ ok: true }),
}

function match(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ')
    if (m !== method) continue
    const names = []
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`)
    const found = pathname.match(regex)
    if (found) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(found[i + 1])])) }
  }
  return null
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
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
    const result = await route.handler(body, route.params)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('[escrow]', error)
    else console.log(`[escrow] ${req.method} ${pathname} -> ${status}: ${error.message}`)
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }))
  }
}).listen(PORT, () => {
  console.log(`[escrow] independent escrow agent (MOCK) on http://localhost:${PORT}, storage ${DATA_DIR}`)
  console.log(`[escrow] steps in only after Swissquote (${SHARE_URL}) has been unreachable for ${OUTAGE_MS / 1000}s`)
})
