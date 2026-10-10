import { ESCROW_URL, HUB_URL, SHARE_URL } from '../config'

export type Wire = { from: number; to: number | null; payload: string }

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields from the service, e.g. `{ blocked: true, reason }` when Swissquote refused a recipient. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** POST to the Swissquote share service (mocked bank backend, separate process). */
export const shareService = <T = unknown>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const shareGet = <T = unknown>(path: string) => request<T>(path, { method: 'GET' })

/** POST to the independent escrow agent (mock, separate process). Only used when Swissquote is gone. */
export const escrowService = <T = unknown>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) }, ESCROW_URL, 'The escrow agent')

export const escrowGet = <T = unknown>(path: string) => request<T>(path, { method: 'GET' }, ESCROW_URL, 'The escrow agent')

export type Service = <T = unknown>(path: string, body?: unknown) => Promise<T>

async function request<T>(path: string, init: RequestInit, base = SHARE_URL, who = 'Swissquote'): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } })
  } catch {
    throw new ServiceError(0, `${who} is unreachable.`)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ServiceError(response.status, data.error ?? `${who} error ${response.status}`, data)
  return data as T
}

/** Reports client-side events (broadcasts, signing without Swissquote) to the presentation hub. */
export function reportEvent(event: Record<string, unknown>) {
  fetch(`${HUB_URL}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {})
}
