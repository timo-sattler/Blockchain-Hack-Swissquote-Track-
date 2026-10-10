import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reserveRelay } from '../relay-quota.mjs'

test('concurrent relay requests reserve gas budget before asynchronous work', async () => {
  const wallet = {}
  const results = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const result = reserveRelay(wallet, `0x${index.toString(16).padStart(64, '0')}`, 10, Date.UTC(2026, 9, 10))
    await Promise.resolve()
    return result
  }))
  assert.equal(results.filter((r) => !r.error).length, 10)
  assert.equal(wallet.relayQuota.used, 10)
  assert.equal(results.filter((r) => r.error === 'limit').length, 10)
})

test('a restart preserves quota and duplicate authorization protection', () => {
  const wallet = {}
  const nonce = `0x${'a'.repeat(64)}`
  const now = Date.UTC(2026, 9, 10)
  assert.deepEqual(reserveRelay(wallet, nonce, 2, now), { remaining: 1 })
  const restarted = JSON.parse(JSON.stringify(wallet))
  assert.deepEqual(reserveRelay(restarted, nonce.toUpperCase(), 2, now), { error: 'duplicate' })
  assert.equal(restarted.relayQuota.used, 1)
  assert.deepEqual(reserveRelay(restarted, `0x${'b'.repeat(64)}`, 2, now), { remaining: 0 })
  assert.deepEqual(reserveRelay(restarted, `0x${'c'.repeat(64)}`, 2, now), { error: 'limit' })
})

test('the budget resets on the next UTC day and a disabled sponsor rejects all requests', () => {
  const wallet = {}
  const now = Date.UTC(2026, 9, 10, 23, 59, 59)
  const nonce = `0x${'a'.repeat(64)}`
  assert.deepEqual(reserveRelay(wallet, nonce, 0, now), { error: 'limit' })
  assert.deepEqual(reserveRelay(wallet, nonce, 1, now), { remaining: 0 })
  assert.deepEqual(reserveRelay(wallet, nonce, 1, now + 1000), { remaining: 0 })
  assert.equal(wallet.relayQuota.day, '2026-10-11')
})
