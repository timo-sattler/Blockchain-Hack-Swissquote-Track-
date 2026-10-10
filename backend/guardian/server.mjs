// MOCK Swissquote guardian service.
//
// Runs as its own process with its own storage (./data). The client app never sees this key.
// It plays two roles a real Swissquote backend would have:
//   1. Link a self-custody wallet to a client profile, after the wallet proves ownership with a
//      passkey signature (the check FINMA's Travel Rule rules ask for on self-hosted wallets).
//   2. Act as one of the client's 2-of-3 recovery guardians: approve a new passkey only after a
//      strong identity check. Email and SMS codes alone are never enough.
// What is mocked: the identity check (a real KYC provider would return the result server to server)
// and client notifications (logged instead of pushed).

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, getAddress, http, isAddress, isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const PORT = Number(process.env.PORT ?? 8787)
const RPC_URL = process.env.RPC_URL ?? 'https://sepolia.base.org'
const RECOVERY_MODULE = getAddress(process.env.RECOVERY_MODULE ?? '0x1F039424e76238D89FC2EC7A1061F19AABf89d98')
const MAX_APPROVAL_LIFETIME = 24 * 60 * 60 // seconds
const PROOF_MAX_AGE = 10 * 60 * 1000 // ms
const SESSION_TTL = 10 * 60 * 1000 // ms

const DATA_DIR = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'data')
mkdirSync(DATA_DIR, { recursive: true })

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
const guardian = privateKeyToAccount(loadOrCreateKey())
const wallets = readJson('wallets.json', {}) // account (lowercase) -> { clientId, linkedAt }
const sessions = new Map() // token -> { account, clientId, expires }

const moduleAbi = [
  {
    type: 'function',
    name: 'getConfig',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'guardians', type: 'address[]' },
      { name: 'threshold', type: 'uint8' },
      { name: 'delay', type: 'uint32' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
]

const routes = {
  'GET /guardian': () => ({
    address: guardian.address,
    name: 'Swissquote (mock guardian service)',
    module: RECOVERY_MODULE,
    chainId: baseSepolia.id,
  }),

  /** Links a wallet to a client after checking a passkey signature from that wallet. */
  'POST /wallets/link': async ({ account, clientId, message, signature }) => {
    if (!isAddress(account) || !clientId || typeof message !== 'string' || !isHex(signature))
      throw httpError(400, 'account, clientId, message and signature are required')
    const fields = parseProof(message)
    if (fields.Wallet?.toLowerCase() !== account.toLowerCase() || fields.Client !== String(clientId))
      throw httpError(400, 'The signed message does not name this wallet and client')
    if (!(Date.now() - Date.parse(fields.Issued) < PROOF_MAX_AGE)) throw httpError(400, 'Ownership proof expired')

    // Works for deployed accounts (ERC-1271) and not-yet-deployed ones (ERC-6492).
    const valid = await client.verifyMessage({ address: account, message, signature })
    if (!valid) throw httpError(401, 'Signature does not come from this wallet')

    wallets[account.toLowerCase()] = { clientId: String(clientId), linkedAt: new Date().toISOString() }
    writeJson('wallets.json', wallets)
    audit('wallet-linked', { account, clientId })
    return { linked: true, guardian: guardian.address }
  },

  /** Lets a client who lost their phone find their wallet after logging in to Swissquote. */
  'POST /wallets/lookup': ({ clientId }) => ({
    accounts: Object.entries(wallets)
      .filter(([, w]) => w.clientId === String(clientId))
      .map(([account]) => getAddress(account)),
  }),

  /**
   * MOCK identity re-verification. Policy: a recovery approval needs an ID document AND a face
   * match against the KYC photo on file. Possession of the phone, email or SMS codes never counts.
   */
  'POST /recovery/identity': ({ clientId, account, checks = {} }) => {
    const linked = isAddress(account) && wallets[account.toLowerCase()]
    if (!linked || linked.clientId !== String(clientId)) {
      audit('identity-refused', { clientId, account, reason: 'wallet not linked to client' })
      throw httpError(403, 'This wallet is not linked to that Swissquote client.')
    }
    if (!checks.idDocument || !checks.faceMatch) {
      const has = [checks.emailOtp && 'email code', checks.smsOtp && 'SMS code'].filter(Boolean)
      audit('identity-refused', { clientId, account, checks })
      notify(clientId, `Someone tried to recover your wallet ${short(account)} and failed the identity check.`)
      throw httpError(
        403,
        `Identity check failed: the face does not match the ID on file.${
          has.length ? ` Having the ${has.join(' and ')} is not enough to recover a wallet.` : ''
        }`,
      )
    }
    const token = randomBytes(24).toString('hex')
    sessions.set(token, { account: account.toLowerCase(), clientId: String(clientId), expires: Date.now() + SESSION_TTL })
    audit('identity-verified', { clientId, account })
    return { session: token }
  },

  /** Signs the guardian approval for a new passkey, bound to the on-chain nonce. */
  'POST /recovery/approve': async ({ session, account, x, y, deadline }) => {
    const s = sessions.get(session)
    if (!s || s.expires < Date.now() || !isAddress(account) || s.account !== account.toLowerCase())
      throw httpError(401, 'Verify your identity first')
    if (!isHex(x, { strict: true }) || !isHex(y, { strict: true })) throw httpError(400, 'Invalid passkey')
    const now = Math.floor(Date.now() / 1000)
    if (!(deadline > now && deadline <= now + MAX_APPROVAL_LIFETIME)) throw httpError(400, 'Invalid deadline')

    const [guardians, , , nonce] = await client.readContract({
      address: RECOVERY_MODULE,
      abi: moduleAbi,
      functionName: 'getConfig',
      args: [account],
    })
    if (!guardians.includes(guardian.address)) throw httpError(409, 'Swissquote is not a guardian of this wallet')

    const signature = await guardian.signTypedData(recoveryTypedData({ account, x, y, nonce, deadline }))
    sessions.delete(session)
    audit('recovery-approved', { account, x, y, nonce: nonce.toString(), deadline })
    notify(s.clientId, `Recovery of wallet ${short(account)} approved. If this was not you, cancel it in the app.`)
    return { signer: guardian.address, signature }
  },
}

function recoveryTypedData({ account, x, y, nonce, deadline }) {
  return {
    domain: { name: 'Swissquote Wallet Recovery', version: '1', chainId: baseSepolia.id, verifyingContract: RECOVERY_MODULE },
    types: {
      Recovery: [
        { name: 'account', type: 'address' },
        { name: 'x', type: 'bytes32' },
        { name: 'y', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Recovery',
    message: { account, x, y, nonce: BigInt(nonce), deadline: BigInt(deadline) },
  }
}

// ---------------------------------------------------------------- http plumbing

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`]
  try {
    if (!route) throw httpError(404, 'Not found')
    const body = req.method === 'POST' ? await readBody(req) : {}
    send(res, 200, await route(body))
  } catch (error) {
    send(res, error.status ?? 500, { error: error.status ? error.message : 'Internal error' })
    if (!error.status) console.error(error)
  }
}).listen(PORT, () => {
  console.log(`MOCK Swissquote guardian on http://localhost:${PORT}`)
  console.log(`  guardian address: ${guardian.address}`)
  console.log(`  recovery module:  ${RECOVERY_MODULE}`)
})

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw httpError(400, 'Invalid JSON')
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

// ---------------------------------------------------------------- storage

function loadOrCreateKey() {
  const file = join(DATA_DIR, 'guardian-key.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).privateKey
  const privateKey = generatePrivateKey()
  writeFileSync(file, JSON.stringify({ privateKey }), { mode: 0o600 })
  return privateKey
}

function readJson(name, fallback) {
  const file = join(DATA_DIR, name)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
}

function writeJson(name, value) {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, 2))
}

function audit(event, details) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details })
  appendFileSync(join(DATA_DIR, 'audit.log'), line + '\n')
  console.log(line)
}

function notify(clientId, text) {
  // MOCK: a real service would push to every registered device and send a letter.
  audit('client-notified', { clientId, text })
}

function parseProof(message) {
  return Object.fromEntries(
    message
      .split('\n')
      .map((line) => line.split(': '))
      .filter((parts) => parts.length === 2),
  )
}

function short(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
