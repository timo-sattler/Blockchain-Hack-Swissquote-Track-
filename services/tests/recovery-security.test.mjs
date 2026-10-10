// Real WebAuthn verification and DKLs MPC against a separate service with disposable storage.
// No live RPC, treasury funds, browser, or shared demo ports are used.
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

test('recovery preserves owner access, requires the kit, and invalidates obsolete sessions', { timeout: 60_000 }, async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sq-recovery-test-'))
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
  const service = spawn(process.execPath, [new URL('../share-service.mjs', import.meta.url).pathname], {
    env: { ...process.env, SHARE_PORT: String(port), DATA_DIR: dataDir, RECOVERY_DELAY_SEC: '0.1', RELAYS_PER_DAY: '0', RPC_URL: `http://127.0.0.1:${rpc.address().port}`, HUB_URL: `http://127.0.0.1:${rpc.address().port}`, TREASURY_PRIVATE_KEY: `0x${'1'.repeat(64)}` },
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
  const owner = authenticator()
  const created = await post('/wallets', { name: 'Security Test Owner' })
  const id = created.walletId
  const route = (path) => `/wallets/${id}${path}`
  const record = () => JSON.parse(readFileSync(join(dataDir, 'wallets', `${id}.json`), 'utf8'))
  const view = async () => (await fetch(`${base}${route('')}`)).json()
  await t.test('creation requires its private session token', async () => {
    await post(route('/passkey'), { response: owner.register(created.options) }, 403)
    await post(route('/passkey'), { response: owner.register(created.options), creationToken: created.creationToken })
    await post(route('/keygen/start'), {}, 403)
  })

  // Run actual HTTP DKG/recovery while party B remains in the service process.
  async function keygen(phone, kit, authorization, beforeCommit) {
    const start = await post(route('/keygen/start'), authorization)
    const m1 = [wire(phone.createFirstMessage()), wire(kit.createFirstMessage()), ...start.messages]
    const m2Local = [...phone.handleMessages(others(m1, 0)), ...kit.handleMessages(others(m1, 2))].map(wire)
    const r1 = await post(`/mpc/${start.sessionId}`, { messages: m1.filter((m) => m.from !== 1) })
    const commitments = [phone.calculateChainCodeCommitment(), bytes(r1.commitment), kit.calculateChainCodeCommitment()]
    const m2 = [...m2Local, ...r1.messages]
    const m3Local = [...phone.handleMessages(forParty(m2, 0)), ...kit.handleMessages(forParty(m2, 2))].map(wire)
    const r2 = await post(`/mpc/${start.sessionId}`, { messages: m2.filter((m) => m.to === 1) })
    const m3 = [...m3Local, ...r2.messages]
    const m4Local = [...phone.handleMessages(forParty(m3, 0), commitments), ...kit.handleMessages(forParty(m3, 2), commitments)].map(wire)
    const r3 = await post(`/mpc/${start.sessionId}`, { messages: m3.filter((m) => m.to === 1), commitments: commitments.map(b64) })
    const m4 = [...m4Local, ...r3.messages]
    phone.handleMessages(others(m4, 0))
    kit.handleMessages(others(m4, 2))
    if (beforeCommit) await beforeCommit(start.sessionId, m4Local)
    const done = await post(`/mpc/${start.sessionId}`, { messages: m4Local }, beforeCommit ? 404 : 200)
    if (beforeCommit) return
    return { phone: phone.keyshare().toBytes(), kit: kit.keyshare().toBytes(), publicKey: bytes(record().publicKey), epoch: done.epoch }
  }
  const shares = await keygen(new KeygenSession(3, 2, 0), new KeygenSession(3, 2, 2), { creationToken: created.creationToken })
  const oldAddresses = { btc: record().btcAddress, evm: record().evmAddress }
  async function login(device = owner) {
    const challenge = await post(route('/auth/options'))
    const response = device.authenticate(challenge.options)
    const result = await post(route('/login'), { response, challengeId: challenge.challengeId })
    return { ...result, response, challengeId: challenge.challengeId }
  }
  async function signRemote(share, party, start) {
    const signer = new SignSession(Keyshare.fromBytes(share), 'm')
    const m1 = wire(signer.createFirstMessage())
    const m2 = signer.handleMessages(start.messages.map(message)).map(wire)
    const r1 = await post(`/mpc/${start.sessionId}`, { messages: [m1] })
    const m3 = signer.handleMessages(forParty(r1.messages, party)).map(wire)
    const r2 = await post(`/mpc/${start.sessionId}`, { messages: m2 })
    signer.handleMessages(forParty(r2.messages, party))
    const r3 = await post(`/mpc/${start.sessionId}`, { messages: m3 })
    signer.lastMessage(bytes(start.hash)).free()
    const [r, s] = signer.combine(r3.messages.map(message))
    return new Uint8Array([...r, ...s])
  }
  async function proveKit() {
    const start = await post(route('/recovery/proof/start'))
    return { proofId: start.proofId, signature: b64(await signRemote(shares.kit, 2, start)) }
  }
  const originalLogin = await login()
  await t.test('login challenges cannot be replayed', async () => {
    await post(route('/login'), { response: originalLogin.response, challengeId: originalLogin.challengeId }, 400)
  })
  await t.test('parallel login prompts keep separate challenges; registration cannot consume them', async () => {
    const first = await post(route('/auth/options'))
    const second = await post(route('/auth/options'))
    assert.notEqual(first.challengeId, second.challengeId)
    await post(route('/login'), { response: owner.authenticate(first.options), challengeId: first.challengeId })
    await post(route('/login'), { response: owner.authenticate(second.options), challengeId: second.challengeId })
    const discovery = await post('/login/options')
    const response = owner.authenticate(discovery.options)
    await post('/login', { challengeId: discovery.challengeId, response })
    await post('/login', { challengeId: discovery.challengeId, response }, 400)
  })
  await t.test('mock identity flag alone cannot start recovery or replace a credential', async () => {
    await post(route('/recovery/request'), { kyc: 'match' }, 403)
    await post(route('/recovery/request'), { kyc: 'mismatch' }, 403)
    assert.equal(record().credential.id, owner.id)
    assert.equal(record().recovery, undefined)
  })
  await t.test('phone share cannot impersonate the kit party', async () => {
    const start = await post(route('/recovery/proof/start'))
    const phone = new SignSession(Keyshare.fromBytes(shares.phone), 'm')
    await post(`/mpc/${start.sessionId}`, { messages: [wire(phone.createFirstMessage())] }, 403)
    phone.free()
  })
  const proof = await proveKit()
  const request = await post(route('/recovery/request'), { kyc: 'match', ...proof })
  await t.test('kit proof is single-use and recovery token is not public', async () => {
    await post(route('/recovery/request'), { kyc: 'match', ...proof }, 403)
    assert.equal((await view()).recovery.token, undefined)
    await post(route('/passkey/options'), {}, 403)
    await post(route('/passkey/options'), { recoveryToken: 'wrong' }, 403)
    await post(route('/passkey/options'), { recoveryToken: request.recoveryToken }, 403, 'https://attacker.example')
  })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const replacement = authenticator()
  const options = await post(route('/passkey/options'), { recoveryToken: request.recoveryToken })
  await post(route('/passkey'), { recoveryToken: request.recoveryToken, response: replacement.register(options.options) })
  await t.test('staged replacement preserves the old owner login and veto', async () => {
    assert.equal(record().credential.id, owner.id)
    assert.equal(record().recovery.pendingCredential.id, replacement.id)
    assert.equal((await view()).recovery.canCancel, true)
    await login()
  })
  const lost = new Uint8Array([0])
  await t.test('owner cancellation invalidates an in-flight recovery before its final commit', async () => {
    const veto = await login()
    await keygen(KeygenSession.initLostShareRecovery(3, 2, 0, shares.publicKey, lost), KeygenSession.initKeyRecovery(Keyshare.fromBytes(shares.kit), lost), { recoveryToken: request.recoveryToken }, async () => {
      await post(route('/recovery/cancel'), { token: veto.token })
    })
    assert.equal(record().credential.id, owner.id)
    assert.equal(record().epoch, 1)
    assert.equal(record().recovery.state, 'cancelled')
    await post(route('/passkey/options'), { recoveryToken: request.recoveryToken }, 403)
  })
  const nextRequest = await post(route('/recovery/request'), { kyc: 'match', ...await proveKit() })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const resumed = await post(route('/recovery/request'), { kyc: 'match', ...await proveKit() })
  assert.equal(resumed.recovery.readyAt, nextRequest.recovery.readyAt)
  assert.equal(resumed.recoveryToken, nextRequest.recoveryToken)
  const nextOptions = await post(route('/passkey/options'), { recoveryToken: resumed.recoveryToken })
  await post(route('/passkey'), { recoveryToken: resumed.recoveryToken, response: replacement.register(nextOptions.options) })
  const refreshed = await keygen(KeygenSession.initLostShareRecovery(3, 2, 0, shares.publicKey, lost), KeygenSession.initKeyRecovery(Keyshare.fromBytes(shares.kit), lost), { recoveryToken: resumed.recoveryToken })
  await t.test('successful recovery commits credential and shares together, preserving both chain addresses', async () => {
    assert.equal(record().credential.id, replacement.id)
    assert.equal(record().epoch, 2)
    assert.equal(record().recovery.state, 'completed')
    assert.deepEqual({ btc: record().btcAddress, evm: record().evmAddress }, oldAddresses)
    assert.equal(b64(refreshed.publicKey), b64(shares.publicKey))
    await post(route('/recovery/cancel'), { token: originalLogin.token }, 401)
    await post(route('/sign/start'), { token: originalLogin.token }, 401)
  })
  await t.test('recovered device signs a real EVM transaction payload; stale device epoch is refused', async () => {
    const newLogin = await login(replacement)
    await post(route('/sign/start'), { token: newLogin.token, epoch: 1 }, 409)
    const unsignedTx = serializeTransaction({ chainId: 84532, type: 'eip1559', nonce: 0, to: '0x000000000000000000000000000000000000dEaD', value: 1n, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n })
    const start = await post(route('/sign/start'), { token: newLogin.token, epoch: 2, chain: 'base', unsignedTx })
    const signature = await signRemote(refreshed.phone, 0, start)
    assert.equal(start.hash, b64(Buffer.from(keccak256(unsignedTx).slice(2), 'hex')))
    assert.equal(secp256k1.verify(signature, bytes(start.hash), refreshed.publicKey, { prehash: false, lowS: false }), true)
    const anotherTx = serializeTransaction({ chainId: 84532, type: 'eip1559', nonce: 1, to: '0x000000000000000000000000000000000000dEaD', value: 2n, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n })
    await post(route('/sign/start'), { token: newLogin.token, epoch: 2, chain: 'base', unsignedTx: anotherTx }, 401)
    await post(route('/sign/start'), { token: newLogin.token, chain: 'base', unsignedTx }, 409)
  })
  await t.test('device pairing requires a private session and invalidates pre-pairing login tokens', async (pairTest) => {
    await post(route('/pair'), {}, 401)
    const loggedIn = await login(replacement)
    const { pairingToken } = await post(route('/pair'), { token: loggedIn.token })
    await post(route('/keygen/start'), {}, 403)
    const paired = await keygen(KeygenSession.initLostShareRecovery(3, 2, 0, refreshed.publicKey, lost), KeygenSession.initKeyRecovery(Keyshare.fromBytes(refreshed.kit), lost), { pairingToken })
    assert.equal(paired.epoch, 3)
    assert.equal(record().credential.id, replacement.id)
    assert.deepEqual({ btc: record().btcAddress, evm: record().evmAddress }, oldAddresses)
    await post(route('/sign/start'), { token: loggedIn.token, epoch: 3 }, 401)
    const relayLogin = await login(replacement)
    const authorization = { to: '0x000000000000000000000000000000000000dEaD', value: '1000000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: `0x${'7'.repeat(64)}` }
    await pairTest.test('gasless relay rejects malformed, unscreened, and sanctioned authorizations before spending gas', async () => {
      await post(route('/relay'), { token: relayLogin.token, authorization: { ...authorization, value: 'NaN' } }, 400)
      await post(route('/relay'), { token: relayLogin.token, authorization: { ...authorization, validAfter: '-1' } }, 400)
      await post(route('/relay'), { token: relayLogin.token, authorization }, 403)
      await post(route('/relay'), { token: relayLogin.token, authorization: { ...authorization, to: '0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e' } }, 403)
      await post(route('/sign/start'), { token: relayLogin.token, epoch: 3, chain: 'base-gasless', authorization: { ...authorization, value: '1001000000' } }, 428)
    })
    await pairTest.test('a legitimately co-signed authorization still obeys the sponsorship cap', async () => {
      const start = await post(route('/sign/start'), { token: relayLogin.token, epoch: 3, chain: 'base-gasless', authorization })
      const raw = await signRemote(paired.phone, 0, start)
      const Fn = secp256k1.Point.Fn
      let s = Fn.fromBytes(raw.slice(32))
      if (s > Fn.ORDER / 2n) s = Fn.ORDER - s
      let signature
      for (const yParity of [0, 1]) {
        const candidate = { r: toHex(raw.slice(0, 32)), s: toHex(s, { size: 32 }), yParity }
        if ((await recoverAddress({ hash: toHex(bytes(start.hash)), signature: candidate })).toLowerCase() === record().evmAddress.toLowerCase()) signature = serializeSignature(candidate)
      }
      assert.ok(signature)
      await post(route('/relay'), { token: relayLogin.token, authorization, signature: '0x' }, 401)
      await post(route('/relay'), { token: relayLogin.token, authorization, signature }, 429)
      assert.equal(record().relayQuota, undefined)
    })
  })
})
