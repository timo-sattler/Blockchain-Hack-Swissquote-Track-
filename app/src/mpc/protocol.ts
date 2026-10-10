// Client side of the two-part wallet (2-of-2 threshold ECDSA, DKLs23). This device runs party 0 with
// the client's part; Swissquote's share service runs party 1. Only protocol messages travel over HTTP
// ({from, to, payload}); the parts never leave their holders and the private key never exists.
import init, { KeygenSession, Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-web'
import wasmUrl from '@silencelaboratories/dkls-wasm-ll-web/dkls-wasm-ll-web_bg.wasm?url'
import { shareService, type Service, type Wire } from './api'
import { fromB64, toB64 } from './bytes'

export const PHONE = 0
export const SWISSQUOTE = 1

let ready: Promise<unknown> | null = null
export const initMpc = () => (ready ??= init(wasmUrl))

const toWire = (m: Message): Wire => ({ from: m.from_id, to: m.to_id ?? null, payload: toB64(m.payload) })
const fromWire = (w: Wire) => new Message(fromB64(w.payload), w.from, w.to ?? undefined)
const others = (msgs: Wire[], party: number) => msgs.filter((m) => m.from !== party).map(fromWire)
const forParty = (msgs: Wire[], party: number) => msgs.filter((m) => m.to === party).map(fromWire)
const handle = (session: KeygenSession | SignSession, msgs: Message[], commitments?: Uint8Array[]) =>
  (session instanceof KeygenSession ? session.handleMessages(msgs, commitments) : session.handleMessages(msgs)).map(toWire)

// ---------- transcript: what actually travels during key creation and signing ----------
// Only protocol messages cross the network; the parts themselves never leave their holders. The last
// transcript is kept for the "How my key works" view.

export type TranscriptStep = { from: 'device' | 'swissquote'; messages: number; bytes: number }
export type Transcript = { kind: 'create' | 'sign'; at: number; steps: TranscriptStep[]; partBytes: number }
const TRANSCRIPT_KEY = 'sq-mpc:transcript'
let recording: Transcript | null = null

const begin = (kind: Transcript['kind']) => (recording = { kind, at: Date.now(), steps: [], partBytes: 0 })
const note = (from: TranscriptStep['from'], wires: Wire[]) =>
  recording?.steps.push({ from, messages: wires.length, bytes: wires.reduce((n, w) => n + Math.floor((w.payload.length * 3) / 4), 0) })
function finish(partBytes: number) {
  if (!recording) return
  recording.partBytes = partBytes
  try {
    localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(recording))
  } catch {
    // only for display
  }
  recording = null
}
export function lastTranscript(): Transcript | null {
  try {
    return JSON.parse(localStorage.getItem(TRANSCRIPT_KEY) ?? 'null')
  } catch {
    return null
  }
}

/**
 * Two parts (2-of-2): this device (party 0) and Swissquote (party 1) create the key together. Neither
 * ever holds both parts, so every signature needs Swissquote, which screens it.
 */
export async function createDeviceShare(walletId: string, onStep?: (step: number) => void, creationToken?: string) {
  await initMpc()
  const phone = new KeygenSession(2, 2, PHONE)
  begin('create')
  const start = await shareService<{ sessionId: string; messages: Wire[] }>(`/wallets/${walletId}/keygen/start`, creationToken ? { creationToken } : {})
  note('swissquote', start.messages)
  const sid = start.sessionId
  const msg1 = [toWire(phone.createFirstMessage()), ...start.messages]
  onStep?.(1)
  const msg2Local = handle(phone, others(msg1, PHONE))
  note('device', msg1.filter((m) => m.from === PHONE))
  const r1 = await shareService<{ messages: Wire[]; commitment: string }>(`/mpc/${sid}`, { messages: msg1.filter((m) => m.from === PHONE) })
  note('swissquote', r1.messages)
  const commitments = [phone.calculateChainCodeCommitment(), fromB64(r1.commitment)]
  const msg2 = [...msg2Local, ...r1.messages]
  onStep?.(2)
  const msg3Local = handle(phone, forParty(msg2, PHONE))
  note('device', msg2.filter((m) => m.to === SWISSQUOTE))
  const r2 = await shareService<{ messages: Wire[] }>(`/mpc/${sid}`, { messages: msg2.filter((m) => m.to === SWISSQUOTE) })
  note('swissquote', r2.messages)
  const msg3 = [...msg3Local, ...r2.messages]
  onStep?.(3)
  const msg4Local = handle(phone, forParty(msg3, PHONE), commitments)
  note('device', msg3.filter((m) => m.to === SWISSQUOTE))
  const r3 = await shareService<{ messages: Wire[] }>(`/mpc/${sid}`, { messages: msg3.filter((m) => m.to === SWISSQUOTE), commitments: commitments.map(toB64) })
  note('swissquote', r3.messages)
  handle(phone, others([...msg4Local, ...r3.messages], PHONE))
  note('device', msg4Local)
  const done = await shareService<{ epoch?: number }>(`/mpc/${sid}`, { messages: msg4Local })
  onStep?.(4)
  const share = phone.keyshare()
  const bytes = share.toBytes()
  finish(bytes.length)
  return { phone: bytes, publicKey: share.publicKey, epoch: done.epoch ?? 1 }
}

export type Signature = { r: Uint8Array; s: Uint8Array }

/**
 * This device's part + Swissquote's part. The service decodes the transaction itself and signs its own
 * hash, so the device cannot make it sign something other than what it checked. The escrow agent runs
 * the same protocol with its copy of Swissquote's part (takeover proof after the grace period).
 */
export async function signWithSwissquote(
  phoneShare: Uint8Array,
  start: { sessionId: string; messages: Wire[]; hash: string },
  party: number = PHONE,
  service: Service = shareService,
): Promise<{ sig: Signature; hash: Uint8Array }> {
  await initMpc()
  const hash = fromB64(start.hash)
  const phone = new SignSession(Keyshare.fromBytes(phoneShare), 'm')
  if (service === shareService) begin('sign')
  note('swissquote', start.messages)
  const m1 = toWire(phone.createFirstMessage())
  const msg2 = handle(phone, start.messages.map(fromWire))
  note('device', [m1])
  const r1 = await service<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: [m1] })
  note('swissquote', r1.messages)
  const msg3 = handle(phone, forParty(r1.messages, party))
  note('device', msg2)
  const r2 = await service<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: msg2 })
  note('swissquote', r2.messages)
  handle(phone, forParty(r2.messages, party))
  note('device', msg3)
  const r3 = await service<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: msg3 })
  note('swissquote', r3.messages)
  phone.lastMessage(hash).free() // must run before combine; consumes the pre-signature
  const [r, s] = phone.combine(r3.messages.map(fromWire)) as [Uint8Array, Uint8Array]
  finish(phoneShare.length)
  return { sig: { r: new Uint8Array(r), s: new Uint8Array(s) }, hash }
}

/**
 * Both parts on this device: after the grace period the escrow agent released its copy of Swissquote's
 * part, so the device signs alone. Swissquote is not involved.
 */
export async function signLocally(clientShare: Uint8Array, swissquoteShare: Uint8Array, hash: Uint8Array): Promise<Signature> {
  await initMpc()
  const parties = [new SignSession(Keyshare.fromBytes(clientShare), 'm'), new SignSession(Keyshare.fromBytes(swissquoteShare), 'm')]
  const ids = [PHONE, SWISSQUOTE]
  const msg1 = parties.map((p) => toWire(p.createFirstMessage()))
  const msg2 = parties.flatMap((p, i) => handle(p, others(msg1, ids[i])))
  const msg3 = parties.flatMap((p, i) => handle(p, forParty(msg2, ids[i])))
  parties.forEach((p, i) => handle(p, forParty(msg3, ids[i])))
  const msg4 = parties.map((p) => toWire(p.lastMessage(hash)))
  const [r, s] = parties[0].combine(others(msg4, PHONE)) as [Uint8Array, Uint8Array]
  parties[1].free()
  return { r: new Uint8Array(r), s: new Uint8Array(s) }
}
