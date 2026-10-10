// End-to-end flows of the two-part wallet: create, log in, send, add and remove devices, take over.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hexToBytes, toHex, type Address } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { escrowGet, escrowService, reportEvent, ServiceError, shareGet, shareService, type Wire } from './api'
import { fromB64, toB64 } from './bytes'
import {
  buildBtcTx,
  buildEvmTx,
  buildUsdcAuthorization,
  evmHash,
  finishEvmSignature,
  isStablecoin,
  sameHash,
  sendBtcTx,
  sendEvmTx,
  STABLECOINS,
  usdcAuthorizationHash,
  type Asset,
} from './chains'
import { createDeviceShare, PHONE, signLocally, signWithSwissquote, type Signature } from './protocol'
import { screenRecipient } from './screening'
import { savePhoneWallet, type PhoneWallet } from './store'

export function addressesFor(publicKey: Uint8Array) {
  const point = secp256k1.Point.fromBytes(publicKey)
  return {
    btcAddress: p2wpkh(point.toBytes(true), TEST_NETWORK).address!,
    evmAddress: publicKeyToAddress(toHex(point.toBytes(false))),
  }
}

export type CreateStage = 'passkey' | 'shares' | 'done'

/**
 * Passkey registration with Swissquote, then the key is created in two parts: this device's part and
 * Swissquote's part (2-of-2). More devices get identical copies of this device's part (inviteDevice).
 */
export async function createWallet(name: string, onStage: (stage: CreateStage, step?: number) => void) {
  onStage('passkey')
  const { walletId, options, creationToken } = await shareService<{ walletId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON']; creationToken: string }>(
    '/wallets',
    { name, scheme: '2of2' },
  )
  const response = await startRegistration({ optionsJSON: options })
  await shareService(`/wallets/${walletId}/passkey`, { response, creationToken })

  onStage('shares', 0)
  const created = await createDeviceShare(walletId, (step) => onStage('shares', step), creationToken)
  const wallet: PhoneWallet = {
    walletId,
    name,
    share: created.phone,
    publicKey: created.publicKey,
    epoch: created.epoch,
    scheme: '2of2',
    credentialId: response.id,
    ...addressesFor(created.publicKey),
  }
  savePhoneWallet(wallet)
  onStage('done')
  return { wallet }
}

let session: { walletId: string; token: string; expires: number } | null = null

/** Face ID / fingerprint, verified by the share service before it co-signs anything. */
async function login(walletId: string, credentialId?: string) {
  if (session && session.walletId === walletId && session.expires > Date.now()) return session.token
  const { options, challengeId } = await shareService<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(`/wallets/${walletId}/auth/options`)
  // This device's passkey is no longer allowed: it was removed from the wallet on another device.
  if (credentialId && options.allowCredentials && !options.allowCredentials.some((c) => c.id === credentialId))
    throw new Error('This device was removed from your wallet, so Swissquote no longer accepts its Face ID. Add it again from one of your other devices.')
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await shareService<{ token: string }>(`/wallets/${walletId}/login`, { response, challengeId })
  session = { walletId, token, expires: Date.now() + 4 * 60_000 }
  return token
}

// `gasless`: USDC or EURC through Swissquote. The client signs an authorization instead of a transaction
// and Swissquote's relayer pays the network fee.
export type SendRequest = { asset: Asset; to: string; amount: string; confirmHighValue?: boolean; gasless?: boolean }
export type SendStage = 'auth' | 'signing' | 'broadcast'
type StartResponse = { sessionId: string; messages: Wire[]; hash: string }

/**
 * Sends a transaction: Face ID, then this device's part + Swissquote's part co-sign. After a takeover
 * (grace period over) the device holds both parts and signs alone.
 */
export async function send(wallet: PhoneWallet, req: SendRequest, onStage: (stage: SendStage) => void): Promise<{ hash: string; chain: 'bitcoin' | 'base'; sponsored: boolean }> {
  const chain = req.asset === 'BTC' ? 'bitcoin' : 'base'
  // Screened on every path (also after a takeover, with the last copy of the list) before anything is built or signed.
  const blocked = await screenRecipient(wallet.walletId, req.to.trim())
  if (blocked) {
    if (blocked.offline) reportEvent({ type: 'payment_blocked', name: wallet.name, to: req.to.trim(), reason: blocked.reason })
    throw new ServiceError(403, `Blocked by Swissquote: ${req.to.trim()} is ${blocked.reason}.`, { blocked: true, ...blocked })
  }
  const alone = !!wallet.independent && !!wallet.bankShare
  if (req.gasless && isStablecoin(req.asset) && !alone) {
    // Free transfers need Swissquote's fee account: say so before asking for Face ID.
    const treasury = await shareGet<{ address: string; eth: string }>('/treasury').catch(() => null)
    if (treasury && Number(treasury.eth) === 0)
      throw new Error('Free transfers are unavailable right now: Swissquote\'s fee account is empty. Tick "Pay it myself" to use your own ETH.')
  }
  session = null // every new transfer (including high-value confirmation) requires fresh user verification
  const token = alone ? null : (onStage('auth'), await login(wallet.walletId, wallet.credentialId))
  onStage('signing')

  const cosign = async (body: Record<string, unknown>, expected: Uint8Array): Promise<Signature> => {
    if (alone) return signLocally(wallet.share, wallet.bankShare!, expected)
    const start = await shareService<StartResponse>(`/wallets/${wallet.walletId}/sign/start`, {
      token,
      chain,
      confirmHighValue: req.confirmHighValue,
      epoch: wallet.epoch,
      ...body,
    })
    if (!sameHash(fromB64(start.hash), expected)) throw new Error('Swissquote returned a different transaction hash. Aborted.')
    return (await signWithSwissquote(wallet.share, start)).sig
  }

  let hash: string
  const sponsored = !!req.gasless && isStablecoin(req.asset) && !alone
  if (sponsored) {
    const authorization = buildUsdcAuthorization(req.to.trim(), req.amount, STABLECOINS[req.asset as 'USDC' | 'EURC'])
    const authHash = usdcAuthorizationHash(wallet.evmAddress as Address, authorization)
    const sig = await cosign({ chain: 'base-gasless', authorization }, hexToBytes(authHash))
    onStage('broadcast')
    const signature = await finishEvmSignature(authHash, sig, wallet.evmAddress as Address)
    hash = (await shareService<{ hash: string }>(`/wallets/${wallet.walletId}/relay`, { token, authorization, signature })).hash
  } else if (chain === 'bitcoin') {
    const built = await buildBtcTx(wallet.publicKey, req.to, req.amount)
    const sigs: Signature[] = []
    for (let i = 0; i < built.sighashes.length; i++) sigs.push(await cosign({ psbt: built.psbt, inputIndex: i }, built.sighashes[i]))
    if (alone) reportEvent({ type: 'signing', parties: ['A', 'B'], alone: true })
    onStage('broadcast')
    hash = await sendBtcTx(built.tx, built.pub, sigs)
  } else {
    const unsignedTx = await buildEvmTx(wallet.evmAddress as Address, req.asset as 'USDC' | 'EURC' | 'ETH', req.to, req.amount)
    const sig = await cosign({ unsignedTx }, hexToBytes(evmHash(unsignedTx)))
    if (alone) reportEvent({ type: 'signing', parties: ['A', 'B'], alone: true })
    onStage('broadcast')
    hash = await sendEvmTx(unsignedTx, sig, wallet.evmAddress as Address)
  }
  reportEvent({
    type: 'tx_broadcast',
    chain,
    hash,
    amount: req.amount,
    asset: req.asset,
    from: chain === 'bitcoin' ? wallet.btcAddress : wallet.evmAddress,
    to: req.to.trim(),
    sponsored,
  })
  return { hash, chain, sponsored }
}



// ---------- log in with an existing passkey ----------

export type LoginResult = { walletId: string; name: string | null; btcAddress: string; evmAddress: string; token: string }

/** The browser offers the passkeys it already has for this site; the share service finds the wallet. */
export async function loginWithPasskey(): Promise<LoginResult> {
  const { challengeId, options } = await shareService<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/login/options')
  const response = await startAuthentication({ optionsJSON: options })
  const result = await shareService<LoginResult>('/login', { challengeId, response })
  session = { walletId: result.walletId, token: result.token, expires: Date.now() + 4 * 60_000 }
  return result
}

export type EscrowStatus = { deposited: boolean; epoch: number | null; swissquoteOnline: boolean; releaseAfter: number | null; scheme?: string | null; graceSeconds?: number; fingerprint?: string | null }

/** What the independent escrow agent holds for this wallet, and whether it would step in now. */
export const escrowStatus = (walletId: string) => escrowGet<EscrowStatus>(`/wallets/${walletId}`)

/** Turns WebAuthn errors into something a user can act on. */
export function describePasskeyError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'NotAllowedError' || /NotAllowed|cancel|timed out/i.test(message))
    return 'The passkey prompt was cancelled or timed out. Try again and confirm with Windows Hello, Face ID or your fingerprint.'
  if (name === 'SecurityError' || /secure context|SecurityError|invalid domain/i.test(message))
    return 'Passkeys only work on https:// or http://localhost. Open the app at http://localhost:5173 (not an IP address).'
  if (name === 'InvalidStateError') return 'This device already has a passkey for this wallet. Use “Log in with my passkey”.'
  if (name === 'NotSupportedError') return 'This browser or device does not support passkeys. Try Chrome, Edge or Safari.'
  return message
}

// ---------- more devices: identical copies of the client's part ----------

export type DeviceInfo = { id: string; name: string; addedAt: number }
export type WalletDetails = { name: string | null; devices: DeviceInfo[]; evmAddress: string; btcAddress: string }

export const walletDetails = (walletId: string) => shareGet<WalletDetails>(`/wallets/${walletId}`)

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (text: string) => fromB64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))

/**
 * Face ID on this device, then its part goes to Swissquote encrypted with a one-time key. That key
 * travels only inside the link (URL fragment, never sent to a server), so Swissquote relays a copy it
 * cannot read. Whoever opens the link within 10 minutes can add one device: show it only as a QR code
 * or send it to yourself.
 */
export async function inviteDevice(wallet: PhoneWallet) {
  session = null
  const token = await login(wallet.walletId, wallet.credentialId)
  const key = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, wallet.share as BufferSource))
  const packed = new Uint8Array(12 + sealed.length)
  packed.set(iv)
  packed.set(sealed, 12)
  const { inviteToken, expires } = await shareService<{ inviteToken: string; expires: number }>(`/wallets/${wallet.walletId}/devices/invite`, {
    token,
    sealedShare: toB64(packed),
  })
  const link = `${location.origin}${location.pathname}#add-device=${wallet.walletId}.${inviteToken}.${b64url(key)}`
  key.fill(0)
  return { link, expires }
}

export type DeviceLink = { walletId: string; inviteToken: string; key: Uint8Array }

export function parseDeviceLink(hash: string): DeviceLink | null {
  const match = /^#add-device=([0-9a-f-]{36})\.([0-9a-f-]{36})\.([\w-]{43})$/.exec(hash)
  if (!match) return null
  try {
    return { walletId: match[1], inviteToken: match[2], key: unb64url(match[3]) }
  } catch {
    return null
  }
}

/** The new device: its own passkey (Face ID) with Swissquote, then it decrypts its copy of the client's part. */
export async function joinDevice(link: DeviceLink, deviceName: string): Promise<PhoneWallet> {
  const { options } = await shareService<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; name: string | null }>(
    `/wallets/${link.walletId}/devices/options`,
    { inviteToken: link.inviteToken },
  )
  const response = await startRegistration({ optionsJSON: options })
  const result = await shareService<{ sealedShare: string; publicKey: string; name: string | null; epoch: number; evmAddress: string }>(
    `/wallets/${link.walletId}/devices/register`,
    { inviteToken: link.inviteToken, response, deviceName },
  )
  const packed = fromB64(result.sealedShare)
  const aes = await crypto.subtle.importKey('raw', link.key as BufferSource, 'AES-GCM', false, ['decrypt'])
  let share: Uint8Array
  try {
    share = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, aes, packed.slice(12)))
  } catch {
    throw new Error('The link is incomplete: copy the whole link, or scan the QR code again.')
  }
  const publicKey = fromB64(result.publicKey)
  const wallet: PhoneWallet = {
    walletId: link.walletId,
    name: result.name ?? undefined,
    share,
    publicKey,
    epoch: result.epoch,
    scheme: '2of2',
    credentialId: response.id,
    ...addressesFor(publicKey),
  }
  if (wallet.evmAddress.toLowerCase() !== result.evmAddress.toLowerCase()) throw new Error('This key part does not belong to the wallet. Aborted.')
  savePhoneWallet(wallet)
  return wallet
}

/** A lost device: Swissquote stops accepting its passkey, so its copy of the client's part becomes useless. */
export async function removeDevice(wallet: PhoneWallet, credentialId: string) {
  session = null
  const token = await login(wallet.walletId, wallet.credentialId)
  return shareService<WalletDetails>(`/wallets/${wallet.walletId}/devices/remove`, { token, credentialId })
}

/**
 * Grace period over (Swissquote unreachable for six months; 30 s in the demo): this device proves it
 * holds the client's part by co-signing a one-time challenge with the escrow agent, which then hands
 * over its copy of Swissquote's part. From then on the device signs alone.
 */
export async function takeOver(wallet: PhoneWallet): Promise<PhoneWallet> {
  const start = await escrowService<{ sessionId: string; messages: Wire[]; hash: string }>(`/wallets/${wallet.walletId}/takeover/start`, {})
  const { sig } = await signWithSwissquote(wallet.share, start, PHONE, escrowService)
  const pad = (b: Uint8Array) => {
    const out = new Uint8Array(32)
    out.set(b, 32 - b.length)
    return out
  }
  const compact = new Uint8Array(64)
  compact.set(pad(sig.r))
  compact.set(pad(sig.s), 32)
  const { shareB } = await escrowService<{ shareB: string }>(`/wallets/${wallet.walletId}/takeover/finish`, { sessionId: start.sessionId, signature: toB64(compact) })
  const updated: PhoneWallet = { ...wallet, independent: true, bankShare: fromB64(shareB) }
  savePhoneWallet(updated)
  return updated
}

// ---------- "How my key works": fingerprints of the parts, never the parts ----------

export type PartsInfo = { scheme: string; publicKey: string; swissquote: { party: number; bytes: number; fingerprint: string } }
export const swissquotePart = (walletId: string) => shareGet<PartsInfo>(`/wallets/${walletId}/parts`)
export const escrowPart = (walletId: string) => escrowGet<{ deposited: boolean; fingerprint: string | null }>(`/wallets/${walletId}`)

export async function fingerprintOf(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
