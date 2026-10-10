import { HUB_URL, SHARE_URL } from '../config'

export type Wire = { from: number; to: number | null; payload: string }

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** POST to the Swissquote share service (mocked bank backend, separate process). */
export const shareService = <T = unknown>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const shareGet = <T = unknown>(path: string) => request<T>(path, { method: 'GET' })

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${SHARE_URL}${path}`, { ...init, headers: { 'content-type': 'application/json' } })
  } catch {
    throw new ServiceError(0, 'Swissquote is unreachable.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ServiceError(response.status, data.error ?? `Share service error ${response.status}`)
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
