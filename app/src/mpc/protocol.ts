// Client side of the 2-of-3 MPC wallet. The phone runs party A (and party C while the recovery kit
// is loaded); the Swissquote share service runs party B. Messages travel over HTTP as {from, to, payload}.
import init, { KeygenSession, Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-web'
import wasmUrl from '@silencelaboratories/dkls-wasm-ll-web/dkls-wasm-ll-web_bg.wasm?url'
import { escrowService, shareService, type Service, type Wire } from './api'
import { fromB64, toB64 } from './bytes'

export const PHONE = 0
export const SWISSQUOTE = 1
export const KIT = 2

let ready: Promise<unknown> | null = null
export const initMpc = () => (ready ??= init(wasmUrl))

const toWire = (m: Message): Wire => ({ from: m.from_id, to: m.to_id ?? null, payload: toB64(m.payload) })
const fromWire = (w: Wire) => new Message(fromB64(w.payload), w.from, w.to ?? undefined)
const others = (msgs: Wire[], party: number) => msgs.filter((m) => m.from !== party).map(fromWire)
const forParty = (msgs: Wire[], party: number) => msgs.filter((m) => m.to === party).map(fromWire)
const handle = (session: KeygenSession | SignSession, msgs: Message[], commitments?: Uint8Array[]) =>
  (session instanceof KeygenSession ? session.handleMessages(msgs, commitments) : session.handleMessages(msgs)).map(toWire)

export type Shares = { phone: Uint8Array; kit: Uint8Array; publicKey: Uint8Array; epoch: number }

/**
 * Distributed key generation with the share service. Used for a new wallet and, with recovery
 * sessions, to issue a new phone share. The private key never exists in one place.
 */
async function runKeygen(
  walletId: string,
  phone: KeygenSession,
  kit: KeygenSession,
  onStep?: (step: number) => void,
  authorization: Record<string, string> = {},
  service: Service = shareService,
): Promise<Shares> {
  const start = await service<{ sessionId: string; messages: Wire[] }>(`/wallets/${walletId}/keygen/start`, authorization)
  const sid = start.sessionId
  const msg1 = [toWire(phone.createFirstMessage()), toWire(kit.createFirstMessage()), ...start.messages]
  onStep?.(1)

  const msg2Local = [...handle(phone, others(msg1, PHONE)), ...handle(kit, others(msg1, KIT))]
  const r1 = await service<{ messages: Wire[]; commitment: string }>(`/mpc/${sid}`, {
    messages: msg1.filter((m) => m.from !== SWISSQUOTE),
  })
  const commitments = [phone.calculateChainCodeCommitment(), fromB64(r1.commitment), kit.calculateChainCodeCommitment()]
  const msg2 = [...msg2Local, ...r1.messages]
  onStep?.(2)

  const msg3Local = [...handle(phone, forParty(msg2, PHONE)), ...handle(kit, forParty(msg2, KIT))]
  const r2 = await service<{ messages: Wire[] }>(`/mpc/${sid}`, { messages: msg2.filter((m) => m.to === SWISSQUOTE) })
  const msg3 = [...msg3Local, ...r2.messages]
  onStep?.(3)

  const msg4Local = [...handle(phone, forParty(msg3, PHONE), commitments), ...handle(kit, forParty(msg3, KIT), commitments)]
  const r3 = await service<{ messages: Wire[] }>(`/mpc/${sid}`, {
    messages: msg3.filter((m) => m.to === SWISSQUOTE),
    commitments: commitments.map(toB64),
  })
  const msg4 = [...msg4Local, ...r3.messages]

  handle(phone, others(msg4, PHONE))
  handle(kit, others(msg4, KIT))
  const done = await service<{ epoch?: number }>(`/mpc/${sid}`, { messages: msg4Local })
  onStep?.(4)

  const phoneShare = phone.keyshare()
  const kitShare = kit.keyshare()
  return { phone: phoneShare.toBytes(), kit: kitShare.toBytes(), publicKey: phoneShare.publicKey, epoch: done.epoch ?? 1 }
}

export async function createShares(walletId: string, onStep?: (step: number) => void, creationToken?: string) {
  await initMpc()
  return runKeygen(walletId, new KeygenSession(3, 2, PHONE), new KeygenSession(3, 2, KIT), onStep, creationToken ? { creationToken } : {})
}

/** New phone after a loss: the kit (C) and Swissquote (B) rebuild Share A. Same key, same addresses. */
export async function recoverShares(walletId: string, kitShare: Uint8Array, publicKey: Uint8Array, onStep?: (step: number) => void, authorization: Record<string, string> = {}) {
  await initMpc()
  const lost = new Uint8Array([PHONE])
  return runKeygen(
    walletId,
    KeygenSession.initLostShareRecovery(3, 2, PHONE, publicKey, lost),
    KeygenSession.initKeyRecovery(Keyshare.fromBytes(kitShare), lost),
    onStep,
    authorization,
  )
}

/** Kit lost or stolen: phone (A) and Swissquote (B) rebuild Share C and refresh their own shares. Same key. */
export async function replaceKitShares(walletId: string, phoneShare: Uint8Array, publicKey: Uint8Array, onStep?: (step: number) => void, authorization: Record<string, string> = {}) {
  await initMpc()
  const lost = new Uint8Array([KIT])
  return runKeygen(
    walletId,
    KeygenSession.initKeyRecovery(Keyshare.fromBytes(phoneShare), lost),
    KeygenSession.initLostShareRecovery(3, 2, KIT, publicKey, lost),
    onStep,
    authorization,
  )
}

/**
 * Swissquote is gone and the phone is lost: the independent escrow agent stands in for Swissquote
 * (party B, with the copy it holds) to rebuild the phone share from the kit. Same key, same addresses.
 */
export async function recoverSharesWithEscrow(walletId: string, kitShare: Uint8Array, publicKey: Uint8Array, onStep?: (step: number) => void, authorization: Record<string, string> = {}) {
  await initMpc()
  const lost = new Uint8Array([PHONE])
  return runKeygen(
    walletId,
    KeygenSession.initLostShareRecovery(3, 2, PHONE, publicKey, lost),
    KeygenSession.initKeyRecovery(Keyshare.fromBytes(kitShare), lost),
    onStep,
    authorization,
    escrowService,
  )
}

export type Signature = { r: Uint8Array; s: Uint8Array }

/**
 * Phone + Swissquote. The service decodes the transaction itself and signs its own hash, so
 * the phone cannot make it sign something other than what it checked.
 */
export async function signWithSwissquote(phoneShare: Uint8Array, start: { sessionId: string; messages: Wire[]; hash: string }, party: number = PHONE): Promise<{ sig: Signature; hash: Uint8Array }> {
  await initMpc()
  const hash = fromB64(start.hash)
  const phone = new SignSession(Keyshare.fromBytes(phoneShare), 'm')
  const m1 = toWire(phone.createFirstMessage())
  const msg2 = handle(phone, start.messages.map(fromWire))
  const r1 = await shareService<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: [m1] })
  const msg3 = handle(phone, forParty(r1.messages, party))
  const r2 = await shareService<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: msg2 })
  handle(phone, forParty(r2.messages, party))
  const r3 = await shareService<{ messages: Wire[] }>(`/mpc/${start.sessionId}`, { messages: msg3 })
  phone.lastMessage(hash).free() // must run before combine; consumes the pre-signature
  const [r, s] = phone.combine(r3.messages.map(fromWire)) as [Uint8Array, Uint8Array]
  return { sig: { r: new Uint8Array(r), s: new Uint8Array(s) }, hash }
}

/** Phone + recovery kit, entirely on the device: works when Swissquote refuses or is gone. */
export async function signWithKit(phoneShare: Uint8Array, kitShare: Uint8Array, hash: Uint8Array): Promise<Signature> {
  await initMpc()
  const parties = [new SignSession(Keyshare.fromBytes(phoneShare), 'm'), new SignSession(Keyshare.fromBytes(kitShare), 'm')]
  const ids = [PHONE, KIT]
  const msg1 = parties.map((p) => toWire(p.createFirstMessage()))
  const msg2 = parties.flatMap((p, i) => handle(p, others(msg1, ids[i])))
  const msg3 = parties.flatMap((p, i) => handle(p, forParty(msg2, ids[i])))
  parties.forEach((p, i) => handle(p, forParty(msg3, ids[i])))
  const msg4 = parties.map((p) => toWire(p.lastMessage(hash)))
  const [r, s] = parties[0].combine(others(msg4, PHONE)) as [Uint8Array, Uint8Array]
  parties[1].free()
  return { r: new Uint8Array(r), s: new Uint8Array(s) }
}
