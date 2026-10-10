// Event hub: collects what happens in the system and streams it to the live presentation.
// It runs separately from the share service so the demo keeps working when the share service is killed.
import { createServer } from 'node:http'

const PORT = Number(process.env.HUB_PORT ?? 8787)
const SHARE_URL = process.env.SHARE_URL ?? 'http://localhost:8790'
const HISTORY_LIMIT = 100

const TYPES = new Set([
  'wallet_created',
  'signing',
  'tx_broadcast',
  'service_offline',
  'service_online',
  'recovery_requested',
  'recovery_refused',
  'recovery_completed',
  'device_paired',
  'pairing_requested',
  'funded',
])

const clients = new Set()
let history = []
let resetAt = 0 // dashboards hide everything older than the last reset, including on-chain history

function publish(event) {
  const entry = { ...event, at: Date.now(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  history = [...history, entry].slice(-HISTORY_LIMIT)
  const line = `data: ${JSON.stringify(entry)}\n\n`
  for (const res of clients) res.write(line)
  console.log(`[hub] ${event.type}${event.parties ? ` ${event.parties.join('+')}` : ''}${event.chain ? ` ${event.chain}` : ''}`)
}

// Watch the share service: its health decides whether Swissquote shows as online in the presentation.
let shareOnline = null
async function checkShareService() {
  let online = false
  try {
    const res = await fetch(`${SHARE_URL}/health`, { signal: AbortSignal.timeout(1500) })
    online = res.ok
  } catch {
    online = false
  }
  if (online !== shareOnline) {
    if (shareOnline !== null || !online) publish({ type: online ? 'service_online' : 'service_offline' })
    shareOnline = online
  }
}
setInterval(checkShareService, 2000)
checkShareService()

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 64_000) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (error) {
        reject(error)
      }
    })
  })
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && url.pathname === '/events') {
    // no-transform + padding: proxies and tunnels (Cloudflare) must not buffer or compress the stream.
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    })
    res.write(`: ${' '.repeat(2048)}\n\n`)
    res.write(`event: state\ndata: ${JSON.stringify({ shareOnline, history, resetAt })}\n\n`)
    clients.add(res)
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(res)
    })
    return
  }

  // Polling fallback for networks that still buffer the event stream.
  if (req.method === 'GET' && url.pathname === '/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(JSON.stringify({ shareOnline, history, resetAt }))
  }

  if (req.method === 'POST' && url.pathname === '/events') {
    try {
      const event = await readJson(req)
      if (!TYPES.has(event.type)) return res.writeHead(400).end('unknown event type')
      publish(event)
      return res.writeHead(204).end()
    } catch {
      return res.writeHead(400).end('invalid JSON')
    }
  }

  if (req.method === 'POST' && url.pathname === '/reset') {
    history = []
    resetAt = Date.now()
    for (const client of clients) client.write(`event: state\ndata: ${JSON.stringify({ shareOnline, history, resetAt })}\n\n`)
    return res.writeHead(204).end()
  }

  if (req.method === 'GET' && url.pathname === '/health') return res.writeHead(200).end('ok')
  res.writeHead(404).end()
})

server.listen(PORT, () => console.log(`[hub] listening on http://localhost:${PORT}, watching ${SHARE_URL}`))
