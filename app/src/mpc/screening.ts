// Swissquote's screening of recipients, for every payment path, before anything is built or signed.
// Online: the share service decides (and logs and alerts). Offline, when phone + kit sign while
// Swissquote is down: the last copy of Swissquote's list kept on this device.
// Co-signed payments are screened again by the share service itself.
import { ServiceError, shareGet, shareService } from './api'

type Entry = { address: string; reason: string }
const CACHE = 'sq-mpc:blocklist'

export async function refreshBlocklist() {
  try {
    const list = await shareGet<{ updated: string; entries: Entry[] }>('/blocklist')
    localStorage.setItem(CACHE, JSON.stringify(list))
  } catch {
    // keep the previous copy
  }
}

function cachedEntries(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? '{}').entries ?? []
  } catch {
    return []
  }
}

export async function screenRecipient(walletId: string, to: string): Promise<{ reason: string; offline: boolean } | null> {
  try {
    const verdict = await shareService<{ blocked: boolean; reason?: string }>('/screen', { walletId, to })
    return verdict.blocked ? { reason: verdict.reason ?? "on Swissquote's blocklist", offline: false } : null
  } catch (error) {
    const unreachable = error instanceof ServiceError && (error.status === 0 || error.status >= 500)
    if (!unreachable) throw error
    const hit = cachedEntries().find((entry) => entry.address.toLowerCase() === to.toLowerCase())
    return hit ? { reason: hit.reason, offline: true } : null
  }
}
