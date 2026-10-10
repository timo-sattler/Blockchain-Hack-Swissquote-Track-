// MOCK independent escrow agent (for example a Swiss notary), for the case "Swissquote is gone and
// the client lost their phone". Separate process, own storage, own port.
//
// Swissquote deposits a copy of Share B here after every key generation (production: encrypted to the
// agent's HSM). The agent never signs payments. It only steps in for Swissquote in ONE protocol: the
// lost-share recovery that issues a new phone share from the client's kit (C) + Share B, and only if
//   1. Swissquote has been unreachable for ESCROW_OUTAGE_SEC (demo 20 s; production: Swissquote has
//      ceased operations, confirmed by its liquidator), and
//   2. the client passes the agent's own identity check (mocked), and
//   3. the client really holds the kit: the MPC protocol itself fails without a valid Share C.
// Afterwards the agent deletes its copy, so it never keeps a usable share.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { KeygenSession, Keyshare, Message } from '@silencelaboratories/dkls-wasm-ll-node'

const PORT = Number(process.env.ESCROW_PORT ?? 8791)
const SHARE_URL = process.env.SHARE_URL ?? 'http://localhost:8790'
const HUB_URL = process.env.HUB_URL ?? 'http://localhost:8787'
const OUTAGE_MS = Number(process.env.ESCROW_OUTAGE_SEC ?? 20) * 1000 // production: liquidation confirmed
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
  // Called by the share service after every key generation (create, recover, pair, kit replacement).
  'POST /deposit': (body) => {
    if (body.token !== DEPOSIT_TOKEN) throw new HttpError(401, 'unknown depositor')
    if (!body.walletId || !body.shareB || !body.publicKey) throw new HttpError(400, 'walletId, shareB and publicKey are required')
    writeFileSync(
      depositPath(body.walletId),
      JSON.stringify({ walletId: body.walletId, name: body.name ?? null, epoch: body.epoch, publicKey: body.publicKey, shareB: body.shareB, at: Date.now() }),
    )
    console.log(`[escrow] holding Share B (epoch ${body.epoch}) for ${body.name ?? body.walletId}`)
    return { ok: true }
  },

  'GET /wallets/:id': (_body, { id }) => {
    const deposit = loadDeposit(id)
    return {
      deposited: !!deposit,
      epoch: deposit?.epoch ?? null,
      swissquoteOnline: swissquoteDownSince === null,
      releaseAfter: releaseAfter(),
    }
  },

  // Same shape as the share service's keygen/start, so the app reuses its recovery protocol code.
  'POST /wallets/:id/keygen/start': (body, { id }) => {
    const deposit = loadDeposit(id)
    if (!deposit) throw new HttpError(404, 'no Share B deposited for this wallet')
    const after = releaseAfter()
    if (after === null) {
      emit({ type: 'escrow_refused', reason: 'Swissquote is still operating: recover with Swissquote instead' })
      throw new HttpError(409, 'Swissquote is still operating. The escrow agent only steps in when Swissquote is gone.')
    }
    if (Date.now() < after) throw new HttpError(425, `Swissquote has been unreachable for less than ${OUTAGE_MS / 1000}s. Try again in ${Math.ceil((after - Date.now()) / 1000)}s.`)
    if (body.kyc !== 'match') {
      emit({ type: 'escrow_refused', reason: 'The notary identity check failed' })
      throw new HttpError(403, 'Identity check failed: the escrow agent could not verify that you are the client.')
    }
    if ([...sessions.values()].some((s) => s.walletId === id)) throw new HttpError(409, 'a recovery is already running')
    // Party 1 (Share B) helps rebuild the lost party 0 (phone) together with the client's kit (party 2).
    const session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(unb64(deposit.shareB)), new Uint8Array([0]))
    const sid = randomUUID()
    sessions.set(sid, { walletId: id, session, stage: 1, publicKey: deposit.publicKey, name: deposit.name })
    console.log(`[escrow] Swissquote gone for ${Math.round((Date.now() - swissquoteDownSince) / 1000)}s and identity verified: recovering ${deposit.name ?? id}`)
    return { sessionId: sid, kind: 'escrow-recover', messages: [toWire(session.createFirstMessage())] }
  },

  'POST /mpc/:sid': (body, { sid }) => {
    const state = sessions.get(sid)
    if (!state) throw new HttpError(404, 'unknown or finished session')
    const incoming = (body.messages ?? []).map(fromWire)
    const { session } = state
    switch (state.stage++) {
      case 1:
        return { messages: session.handleMessages(incoming).map(toWire), commitment: b64(session.calculateChainCodeCommitment()) }
      case 2:
        return { messages: session.handleMessages(incoming).map(toWire) }
      case 3:
        return { messages: session.handleMessages(incoming, body.commitments.map(unb64)).map(toWire) }
      case 4: {
        session.handleMessages(incoming)
        sessions.delete(sid)
        const share = session.keyshare()
        const publicKey = b64(share.publicKey)
        try {
          share.free()
          session.free()
        } catch {}
        if (publicKey !== state.publicKey) throw new HttpError(500, 'recovery produced a different key')
        // Only now, after the protocol succeeded: the client holds a new phone share and a new kit,
        // so the agent deletes its copy and keeps nothing usable.
        rmSync(depositPath(state.walletId), { force: true })
        emit({ type: 'escrow_released', name: state.name ?? undefined })
        console.log(`[escrow] recovery done for ${state.name ?? state.walletId}; deposit deleted`)
        return { publicKey, epoch: null }
      }
      default:
        throw new HttpError(409, 'protocol already finished')
    }
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
