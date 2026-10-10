// End-to-end flows of the MPC wallet: create, log in, send (with Swissquote or with the kit), recover.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hexToBytes, toHex, type Address } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { reportEvent, shareGet, shareService, type Wire } from './api'
import { buildBtcTx, buildEvmTx, evmHash, sameHash, sendBtcTx, sendEvmTx, type Asset } from './chains'
import type { Kit } from './kit'
import { createShares, recoverShares, signWithKit, signWithSwissquote, type Signature } from './protocol'
import { savePhoneWallet, type PhoneWallet } from './store'
import { fromB64 } from './bytes'

export function addressesFor(publicKey: Uint8Array) {
  const point = secp256k1.Point.fromBytes(publicKey)
  return {
    btcAddress: p2wpkh(point.toBytes(true), TEST_NETWORK).address!,
    evmAddress: publicKeyToAddress(toHex(point.toBytes(false))),
  }
}

export type CreateStage = 'passkey' | 'shares' | 'done'

/** Passkey registration with Swissquote, then distributed key generation of Shares A, B and C. */
export async function createWallet(name: string, onStage: (stage: CreateStage, step?: number) => void) {
  onStage('passkey')
  const { walletId, options } = await shareService<{ walletId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/wallets', { name })
  const response = await startRegistration({ optionsJSON: options })
  await shareService(`/wallets/${walletId}/passkey`, { response })

  onStage('shares', 0)
  const shares = await createShares(walletId, (step) => onStage('shares', step))
  const wallet: PhoneWallet = { walletId, name, share: shares.phone, publicKey: shares.publicKey, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  onStage('done')
  const kit: Kit = { walletId, publicKey: shares.publicKey, share: shares.kit, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress }
  return { wallet, kit }
}

let session: { walletId: string; token: string; expires: number } | null = null

/** Face ID / fingerprint, verified by the share service before it co-signs anything. */
async function login(walletId: string) {
  if (session && session.walletId === walletId && session.expires > Date.now()) return session.token
  const { options } = await shareService<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(`/wallets/${walletId}/auth/options`)
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await shareService<{ token: string }>(`/wallets/${walletId}/login`, { response })
  session = { walletId, token, expires: Date.now() + 4 * 60_000 }
  return token
}

export type SendRequest = { asset: Asset; to: string; amount: string; confirmHighValue?: boolean }
export type SendStage = 'auth' | 'signing' | 'broadcast'
type StartResponse = { sessionId: string; messages: Wire[]; hash: string }

/**
 * Sends a transaction. With `kit` the phone signs together with the recovery kit and Swissquote
 * is not involved at all; otherwise phone + Swissquote co-sign after the passkey login.
 */
export async function send(wallet: PhoneWallet, req: SendRequest, onStage: (stage: SendStage) => void, kit?: Kit): Promise<{ hash: string; chain: 'bitcoin' | 'base' }> {
  const chain = req.asset === 'BTC' ? 'bitcoin' : 'base'
  const token = kit ? null : (onStage('auth'), await login(wallet.walletId))
  onStage('signing')

  const cosign = async (body: Record<string, unknown>, expected: Uint8Array): Promise<Signature> => {
    if (kit) return signWithKit(wallet.share, kit.share, expected)
    const start = await shareService<StartResponse>(`/wallets/${wallet.walletId}/sign/start`, { token, chain, confirmHighValue: req.confirmHighValue, ...body })
    if (!sameHash(fromB64(start.hash), expected)) throw new Error('Swissquote returned a different transaction hash. Aborted.')
    return (await signWithSwissquote(wallet.share, start)).sig
  }

  let hash: string
  if (chain === 'bitcoin') {
    const built = await buildBtcTx(wallet.publicKey, req.to, req.amount)
    const sigs: Signature[] = []
    for (let i = 0; i < built.sighashes.length; i++) sigs.push(await cosign({ psbt: built.psbt, inputIndex: i }, built.sighashes[i]))
    if (kit) reportEvent({ type: 'signing', parties: ['A', 'C'] })
    onStage('broadcast')
    hash = await sendBtcTx(built.tx, built.pub, sigs)
  } else {
    const unsignedTx = await buildEvmTx(wallet.evmAddress as Address, req.asset as 'USDC' | 'ETH', req.to, req.amount)
    const sig = await cosign({ unsignedTx }, hexToBytes(evmHash(unsignedTx)))
    if (kit) reportEvent({ type: 'signing', parties: ['A', 'C'] })
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
  })
  return { hash, chain }
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

/**
 * Logged in on a device without Share A (new browser, cleared data): passkey + recovery kit let
 * Swissquote and the kit issue a new phone share right away. Returns the new kit to save.
 */
export async function pairDevice(login: LoginResult, kit: Kit, onStep?: (step: number) => void) {
  if (kit.walletId !== login.walletId) throw new Error('This recovery kit belongs to a different wallet.')
  await shareService(`/wallets/${login.walletId}/pair`, { token: login.token })
  const shares = await recoverShares(kit.walletId, kit.share, kit.publicKey, onStep)
  const wallet: PhoneWallet = { walletId: kit.walletId, name: login.name ?? undefined, share: shares.phone, publicKey: shares.publicKey, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  return { wallet, kit: { ...kit, share: shares.kit } }
}

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

// ---------- recovery ----------

export type RecoveryStatus = { state: 'pending' | 'ready' | 'completed'; readyAt?: number } | null

/** Step 1 on the new phone: identity check (mocked KYC) starts the delay, or refuses an attacker. */
export async function requestRecovery(kit: Kit, kyc: 'match' | 'mismatch') {
  const view = await shareService<{ recovery: RecoveryStatus }>(`/wallets/${kit.walletId}/recovery/request`, { kyc })
  return view.recovery
}

export async function recoveryStatus(walletId: string) {
  return (await shareGet<{ recovery: RecoveryStatus }>(`/wallets/${walletId}`)).recovery
}

/** Step 2 after the delay: new passkey, then kit + Swissquote rebuild Share A. Returns the new kit. */
export async function completeRecovery(kit: Kit, onStep?: (step: number) => void) {
  const { options } = await shareService<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(`/wallets/${kit.walletId}/passkey/options`)
  const response = await startRegistration({ optionsJSON: options })
  await shareService(`/wallets/${kit.walletId}/passkey`, { response })
  const shares = await recoverShares(kit.walletId, kit.share, kit.publicKey, onStep)
  const { name } = await shareGet<{ name: string | null }>(`/wallets/${kit.walletId}`)
  const wallet: PhoneWallet = { walletId: kit.walletId, name: name ?? undefined, share: shares.phone, publicKey: shares.publicKey, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  session = null
  const newKit: Kit = { ...kit, share: shares.kit }
  return { wallet, kit: newKit }
}
