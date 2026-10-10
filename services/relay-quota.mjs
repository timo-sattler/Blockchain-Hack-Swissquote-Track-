// Reserve before awaiting RPC work. The caller persists the wallet immediately, so queued requests
// and service restarts cannot reset the daily gas budget. Attempts count even when an RPC fails:
// a timeout after broadcast does not prove that no sponsored gas was spent.
export function reserveRelay(wallet, nonce, limit, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10)
  const quota = wallet.relayQuota?.day === day ? wallet.relayQuota : { day, used: 0, nonces: [] }
  if (quota.used >= limit) return { error: 'limit' }
  if (quota.nonces.includes(nonce.toLowerCase())) return { error: 'duplicate' }
  quota.used++
  quota.nonces.push(nonce.toLowerCase())
  wallet.relayQuota = quota
  return { remaining: limit - quota.used }
}
