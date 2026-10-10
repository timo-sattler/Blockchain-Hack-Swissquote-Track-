// Security of the two-part wallet: real WebAuthn verification and real DKLs MPC (2-of-2) against the
// share service in its own process with disposable storage. No live RPC, treasury funds, browser, or
// shared demo ports are used.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { KeygenSession, Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak256, recoverAddress, serializeSignature, serializeTransaction, toHex } from 'viem'

const ORIGIN = 'http://localhost:5217'
const b64 = (v) => Buffer.from(v).toString('base64')
const b64url = (v) => Buffer.from(v).toString('base64url')
const bytes = (v) => new Uint8Array(Buffer.from(v, 'base64'))
const hash = (v) => createHash('sha256').update(v).digest()
const wire = (m) => ({ from: m.from_id, to: m.to_id ?? null, payload: b64(m.payload) })
const message = (w) => new Message(bytes(w.payload), w.from, w.to ?? undefined)
const others = (msgs, party) => msgs.filter((m) => m.from !== party).map(message)
const forParty = (msgs, party) => msgs.filter((m) => m.to === party).map(message)

// A software test authenticator: creates actual ES256 credentials and signed assertions.
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const id = randomBytes(32)
  let counter = 0
  const clientData = (type, challenge, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  return {
    id: b64url(id),
    register(options) {
      const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]))
      const length = Buffer.alloc(2)
      length.writeUInt16BE(id.length)
      const authData = Buffer.concat([hash(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, id, cose])
      return {
        id: b64url(id), rawId: b64url(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData('webauthn.create', options.challenge)), attestationObject: b64url(isoCBOR.encode(new Map([['fmt', 'none'], ['authData', new Uint8Array(authData)], ['attStmt', new Map()]]))), transports: ['internal'] },
      }
    },
    authenticate(options) {
      const count = Buffer.alloc(4)
      count.writeUInt32BE(++counter)
      const authData = Buffer.concat([hash(options.rpId), Buffer.from([0x05]), count])
      const data = clientData('webauthn.get', options.challenge)
      return {
        id: b64url(id), rawId: b64url(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(data), authenticatorData: b64url(authData), signature: b64url(sign('sha256', Buffer.concat([authData, hash(data)]), privateKey)) },
      }
    },
  }
}

test('two-part wallet: creation, login, co-signing, screening, devices and sponsoring', { timeout: 60_000 }, async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sq-wallet-test-'))
  // A local RPC stub prevents any contact with real networks, including automatic welcome funding.
  const rpc = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const call = JSON.parse(Buffer.concat(chunks).toString())
    const reply = (c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_call' ? `0x${'0'.repeat(64)}` : '0x0' })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(Array.isArray(call) ? call.map(reply) : reply(call)))
  })
  rpc.listen(0, '127.0.0.1')
  await once(rpc, 'listening')
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const stub = `http://127.0.0.1:${rpc.address().port}`
  const service = spawn(process.execPath, [new URL('../share-service.mjs', import.meta.url).pathname], {
    env: { ...process.env, SHARE_PORT: String(port), DATA_DIR: dataDir, RELAYS_PER_DAY: '0', RPC_URL: stub, HUB_URL: stub, ESCROW_URL: stub, TREASURY_PRIVATE_KEY: `0x${'1'.repeat(64)}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  service.stdout.on('data', (v) => { logs += v })
  service.stderr.on('data', (v) => { logs += v })
  t.after(async () => {
    service.kill()
    await once(service, 'exit').catch(() => {})
    await new Promise((resolve) => rpc.close(resolve))
    rmSync(dataDir, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (service.exitCode !== null) assert.fail(`service stopped: ${logs}`)
    try { if ((await fetch(`${base}/health`)).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  async function post(path, body = {}, expected = 200, origin = ORIGIN) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
    const result = await res.json()
    assert.equal(res.status, expected, `${path}: ${JSON.stringify(result)}`)
    return result
  }

  const laptop = authenticator()
  const created = await post('/wallets', { name: 'Security Test Owner' })
  const id = created.walletId
  const route = (path) => `/wallets/${id}${path}`
  const record = () => JSON.parse(readFileSync(join(dataDir, 'wallets', `${id}.json`), 'utf8'))
  const view = async () => (await fetch(`${base}${route('')}`)).json()

  await t.test('creation requires its private session token', async () => {
    await post(route('/passkey'), { response: laptop.register(created.options) }, 403)
    await post(route('/passkey'), { response: laptop.register(created.options), creationToken: created.creationToken })
    await post(route('/keygen/start'), {}, 403)
  })

  // Two-party key generation over HTTP: this test is party 0, Swissquote stays party 1 in its process.
  const client = new KeygenSession(2, 2, 0)
  const start = await post(route('/keygen/start'), { creationToken: created.creationToken })
  const m1 = [wire(client.createFirstMessage()), ...start.messages]
  const m2Local = client.handleMessages(others(m1, 0)).map(wire)
  const r1 = await post(`/mpc/${start.sessionId}`, { messages: m1.filter((m) => m.from === 0) })
  const commitments = [client.calculateChainCodeCommitment(), bytes(r1.commitment)]
  const m2 = [...m2Local, ...r1.messages]
  const m3Local = client.handleMessages(forParty(m2, 0)).map(wire)
  const r2 = await post(`/mpc/${start.sessionId}`, { messages: m2.filter((m) => m.to === 1) })
  const m3 = [...m3Local, ...r2.messages]
  const m4Local = client.handleMessages(forParty(m3, 0), commitments).map(wire)
  const r3 = await post(`/mpc/${start.sessionId}`, { messages: m3.filter((m) => m.to === 1), commitments: commitments.map(b64) })
  client.handleMessages(others([...m4Local, ...r3.messages], 0))
  await post(`/mpc/${start.sessionId}`, { messages: m4Local })
  const clientPart = client.keyshare().toBytes()

  await t.test('the key is created once, in two parts; Swissquote never stores the client part', async () => {
    await post(route('/keygen/start'), { creationToken: created.creationToken }, 409)
    const stored = record()
    assert.equal(stored.scheme, '2of2')
    assert.notEqual(stored.shareB, b64(clientPart))
    assert.equal(Keyshare.fromBytes(bytes(stored.shareB)).partyId, 1)
  })

  async function login(device = laptop) {
    const challenge = await post(route('/auth/options'))
    const response = device.authenticate(challenge.options)
    const result = await post(route('/login'), { response, challengeId: challenge.challengeId })
    return { ...result, response, challengeId: challenge.challengeId }
  }
  async function signRemote(share, start) {
    const signer = new SignSession(Keyshare.fromBytes(share), 'm')
    const s1 = wire(signer.createFirstMessage())
    const s2 = signer.handleMessages(start.messages.map(message)).map(wire)
    const q1 = await post(`/mpc/${start.sessionId}`, { messages: [s1] })
    const s3 = signer.handleMessages(forParty(q1.messages, 0)).map(wire)
    const q2 = await post(`/mpc/${start.sessionId}`, { messages: s2 })
    signer.handleMessages(forParty(q2.messages, 0))
    const q3 = await post(`/mpc/${start.sessionId}`, { messages: s3 })
    signer.lastMessage(bytes(start.hash)).free()
    const [r, s] = signer.combine(q3.messages.map(message))
    return new Uint8Array([...r, ...s])
  }
  async function recovered(raw, digest) {
    const Fn = secp256k1.Point.Fn
    let s = Fn.fromBytes(raw.slice(32))
    if (s > Fn.ORDER / 2n) s = Fn.ORDER - s
    for (const yParity of [0, 1]) {
      const candidate = { r: toHex(raw.slice(0, 32)), s: toHex(s, { size: 32 }), yParity }
      if ((await recoverAddress({ hash: digest, signature: candidate })).toLowerCase() === record().evmAddress.toLowerCase()) return serializeSignature(candidate)
    }
    return null
  }
  const tx = (to, nonce = 0) => serializeTransaction({ chainId: 84532, type: 'eip1559', nonce, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, to, value: 1n })

  const first = await login()
  await t.test('login challenges cannot be replayed', async () => {
    await post(route('/login'), { response: first.response, challengeId: first.challengeId }, 400)
  })

  await t.test('parallel login prompts keep separate challenges; discoverable login is single-use', async () => {
    const a = await post(route('/auth/options'))
    const b = await post(route('/auth/options'))
    assert.notEqual(a.challengeId, b.challengeId)
    await post(route('/login'), { response: laptop.authenticate(a.options), challengeId: a.challengeId })
    await post(route('/login'), { response: laptop.authenticate(b.options), challengeId: b.challengeId })
    const discovery = await post('/login/options')
    const response = laptop.authenticate(discovery.options)
    await post('/login', { challengeId: discovery.challengeId, response })
    await post('/login', { challengeId: discovery.challengeId, response }, 400)
  })

  await t.test('co-signing needs a passkey login and yields a valid signature for the wallet', async () => {
    const unsignedTx = tx('0x000000000000000000000000000000000000dEaD')
    await post(route('/sign/start'), { unsignedTx }, 401)
    const { token } = await login()
    const started = await post(route('/sign/start'), { token, unsignedTx })
    assert.equal(toHex(bytes(started.hash)), keccak256(unsignedTx))
    assert.ok(await recovered(await signRemote(clientPart, started), keccak256(unsignedTx)))
  })

  await t.test('one login authorizes one transfer only', async () => {
    const { token } = await login()
    await post(route('/sign/start'), { token, unsignedTx: tx('0x000000000000000000000000000000000000dEaD', 1) })
    await post(route('/sign/start'), { token, unsignedTx: tx('0x1111111111111111111111111111111111111111', 2) }, 401)
  })

  await t.test('screening refuses malicious recipients before any signing session exists', async () => {
    const { token } = await login()
    const blocked = await post(route('/sign/start'), { token, unsignedTx: tx('0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0') }, 403)
    assert.equal(blocked.blocked, true)
    assert.match(blocked.reason, /scam/)
    const screened = await post('/screen', { to: '0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e' })
    assert.equal(screened.blocked, true)
  })

  const phone = authenticator()
  await t.test("adding a device needs a login, a single-use invite and the new device's own passkey", async () => {
    await post(route('/devices/invite'), { sealedShare: 'x'.repeat(200) }, 401)
    const { token } = await login()
    const { inviteToken } = await post(route('/devices/invite'), { token, sealedShare: 'x'.repeat(200) })
    await post(route('/devices/options'), { inviteToken: 'wrong' }, 403)
    const { options } = await post(route('/devices/options'), { inviteToken })
    const added = await post(route('/devices/register'), { inviteToken, response: phone.register(options), deviceName: 'Test phone' })
    assert.equal(added.sealedShare, 'x'.repeat(200)) // relayed as is: Swissquote only ever sees the encrypted copy
    assert.equal((await view()).devices.length, 2)
    await post(route('/devices/options'), { inviteToken }, 403) // used once
  })

  await t.test('the added device co-signs with an identical copy of the client part', async () => {
    const { token } = await login(phone)
    const unsignedTx = tx('0x000000000000000000000000000000000000dEaD', 3)
    const started = await post(route('/sign/start'), { token, unsignedTx })
    assert.ok(await recovered(await signRemote(new Uint8Array(clientPart), started), keccak256(unsignedTx)))
  })

  await t.test('a removed device can no longer log in, and its open sessions are revoked', async () => {
    const laptopToken = (await login()).token
    const phoneToken = (await login(phone)).token
    await post(route('/devices/remove'), { token: phoneToken, credentialId: phone.id }, 409) // not itself
    await post(route('/devices/remove'), { token: phoneToken, credentialId: laptop.id })
    assert.deepEqual((await view()).devices.map((d) => d.id), [phone.id])
    await post(route('/sign/start'), { token: laptopToken, unsignedTx: tx('0x000000000000000000000000000000000000dEaD', 4) }, 401)
    const challenge = await post(route('/auth/options'))
    assert.ok(!challenge.options.allowCredentials.some((c) => c.id === laptop.id))
    await post(route('/login'), { response: laptop.authenticate(challenge.options), challengeId: challenge.challengeId }, 401)
    await post(route('/devices/remove'), { token: (await login(phone)).token, credentialId: phone.id }, 409) // never the last device
  })

  await t.test('gasless relay rejects malformed, unapproved, unknown-token and sanctioned authorizations before spending gas', async () => {
    const { token } = await login(phone)
    const authorization = { to: '0x000000000000000000000000000000000000dEaD', value: '1000000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: `0x${'7'.repeat(64)}` }
    await post(route('/relay'), { token, authorization: { ...authorization, value: 'NaN' } }, 400)
    await post(route('/relay'), { token, authorization: { ...authorization, validAfter: '-1' } }, 400)
    await post(route('/relay'), { token, authorization }, 403) // not approved by Swissquote in this login
    await post(route('/relay'), { token, authorization: { ...authorization, to: '0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e' } }, 403)
    await post(route('/sign/start'), { token, chain: 'base-gasless', authorization: { ...authorization, token: '0x1111111111111111111111111111111111111111' } }, 403)
    await post(route('/sign/start'), { token, chain: 'base-gasless', authorization: { ...authorization, value: '1001000000' } }, 428)
  })

  await t.test('a co-signed USDC or EURC authorization still obeys the sponsorship cap', async () => {
    for (const token of [undefined, '0x808456652fdb597867f38412077A9182bf77359F']) {
      const { token: login1 } = await login(phone)
      const authorization = { to: '0x000000000000000000000000000000000000dEaD', value: '1000000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: toHex(randomBytes(32)), ...(token ? { token } : {}) }
      const started = await post(route('/sign/start'), { token: login1, chain: 'base-gasless', authorization })
      const signature = await recovered(await signRemote(new Uint8Array(clientPart), started), toHex(bytes(started.hash)))
      assert.ok(signature)
      await post(route('/relay'), { token: login1, authorization, signature: '0x' }, 401)
      await post(route('/relay'), { token: login1, authorization, signature }, 429) // RELAYS_PER_DAY=0 in this test
    }
    assert.equal(record().relayQuota, undefined)
  })
})
