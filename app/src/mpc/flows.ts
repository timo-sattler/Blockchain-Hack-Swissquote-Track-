// End-to-end flows of the MPC wallet: create, log in, send (with Swissquote or with the kit), recover.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hexToBytes, toHex, type Address, type Hex } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { escrowGet, reportEvent, ServiceError, shareGet, shareService, type Wire } from './api'
import {
  buildBtcTx,
  buildEvmTx,
  buildUsdcAuthorization,
  evmHash,
  finishEvmSignature,
  sameHash,
  sendBtcTx,
  sendEvmTx,
  usdcAuthorizationHash,
  type Asset,
} from './chains'
import type { Kit } from './kit'
import { recoverSharesWithEscrow, replaceKitShares, createShares, KIT, recoverShares, signWithKit, signWithSwissquote, type Signature } from './protocol'
import { screenRecipient } from './screening'
import { savePhoneWallet, type PhoneWallet } from './store'
import { fromB64, toB64 } from './bytes'

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
  const { walletId, options, creationToken } = await shareService<{ walletId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON']; creationToken: string }>('/wallets', { name })
  const response = await startRegistration({ optionsJSON: options })
  await shareService(`/wallets/${walletId}/passkey`, { response, creationToken })

  onStage('shares', 0)
  const shares = await createShares(walletId, (step) => onStage('shares', step), creationToken)
  const wallet: PhoneWallet = { walletId, name, share: shares.phone, publicKey: shares.publicKey, epoch: shares.epoch, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  onStage('done')
  const kit: Kit = { walletId, publicKey: shares.publicKey, share: shares.kit, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress }
  return { wallet, kit }
}

let session: { walletId: string; token: string; expires: number } | null = null

/** Face ID / fingerprint, verified by the share service before it co-signs anything. */
async function login(walletId: string) {
  if (session && session.walletId === walletId && session.expires > Date.now()) return session.token
  const { options, challengeId } = await shareService<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(`/wallets/${walletId}/auth/options`)
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await shareService<{ token: string }>(`/wallets/${walletId}/login`, { response, challengeId })
  session = { walletId, token, expires: Date.now() + 4 * 60_000 }
  return token
}

// `gasless`: USDC only, phone + Swissquote only. The client signs an authorization instead of a
// transaction and Swissquote's relayer pays the network fee.
export type SendRequest = { asset: Asset; to: string; amount: string; confirmHighValue?: boolean; gasless?: boolean }
export type SendStage = 'auth' | 'signing' | 'broadcast'
type StartResponse = { sessionId: string; messages: Wire[]; hash: string }

/**
 * Sends a transaction. With `kit` the phone signs together with the recovery kit and Swissquote
 * is not involved at all; otherwise phone + Swissquote co-sign after the passkey login.
 */
export async function send(
  wallet: PhoneWallet,
  req: SendRequest,
  onStage: (stage: SendStage) => void,
  kit?: Kit,
): Promise<{ hash: string; chain: 'bitcoin' | 'base'; sponsored: boolean }> {
  const chain = req.asset === 'BTC' ? 'bitcoin' : 'base'
  // Screened on every path, also phone + kit, before anything is built or signed.
  const blocked = await screenRecipient(wallet.walletId, req.to.trim())
  if (blocked) {
    if (blocked.offline) reportEvent({ type: 'payment_blocked', name: wallet.name, to: req.to.trim(), reason: blocked.reason })
    throw new ServiceError(403, `Blocked by Swissquote: ${req.to.trim()} is ${blocked.reason}.`, { blocked: true, ...blocked })
  }
  if (req.gasless && req.asset === 'USDC' && !kit) {
    // Free transfers need Swissquote's fee account: say so before asking for Face ID.
    const treasury = await shareGet<{ address: string; eth: string }>('/treasury').catch(() => null)
    if (treasury && Number(treasury.eth) === 0)
      throw new Error('Free transfers are unavailable right now: Swissquote\'s fee account is empty. Tick "Pay it myself" to use your own ETH.')
  }
  session = null // every new transfer (including high-value confirmation) requires fresh user verification
  const token = kit ? null : (onStage('auth'), await login(wallet.walletId))
  onStage('signing')

  const cosign = async (body: Record<string, unknown>, expected: Uint8Array): Promise<Signature> => {
    if (kit) return signWithKit(wallet.share, kit.share, expected)
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
  const sponsored = !!req.gasless && req.asset === 'USDC' && !kit
  if (sponsored) {
    const authorization = buildUsdcAuthorization(req.to.trim(), req.amount)
    const authHash = usdcAuthorizationHash(wallet.evmAddress as Address, authorization)
    const sig = await cosign({ chain: 'base-gasless', authorization }, hexToBytes(authHash))
    onStage('broadcast')
    const signature = await finishEvmSignature(authHash, sig, wallet.evmAddress as Address)
    hash = (await shareService<{ hash: string }>(`/wallets/${wallet.walletId}/relay`, { token, authorization, signature })).hash
  } else if (chain === 'bitcoin') {
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
    sponsored,
  })
  return { hash, chain, sponsored }
}


/**
 * Phone + Swissquote sign an EIP-712 message that the service rebuilds and checks itself. Used for
 * the on-chain kit backup (backup.ts); the service refuses every other kind of message.
 */
export async function cosignTypedMessage(wallet: PhoneWallet, body: Record<string, unknown>, expected: Hex): Promise<{ token: string; signature: Hex }> {
  session = null // fresh user verification for every message
  const token = await login(wallet.walletId)
  const start = await shareService<StartResponse>(`/wallets/${wallet.walletId}/sign/start`, { token, epoch: wallet.epoch, ...body })
  if (!sameHash(fromB64(start.hash), hexToBytes(expected))) throw new Error('Swissquote returned a different message hash. Aborted.')
  const { sig } = await signWithSwissquote(wallet.share, start)
  return { token, signature: await finishEvmSignature(expected, sig, wallet.evmAddress as Address) }
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
/**
 * Kit lost or stolen: Face ID, then phone + Swissquote issue new shares for all three parties.
 * The old kit no longer pairs with anything that is still in use. Returns the new kit to save.
 */
export async function replaceKit(wallet: PhoneWallet, onStep?: (step: number) => void) {
  session = null // a security action always asks for Face ID again
  const token = await login(wallet.walletId)
  const { kitReplaceToken } = await shareService<{ kitReplaceToken: string }>(`/wallets/${wallet.walletId}/kit/replace`, { token })
  const shares = await replaceKitShares(wallet.walletId, wallet.share, wallet.publicKey, onStep, { kitReplaceToken })
  session = null // old login tokens were revoked with the new share generation
  const updated: PhoneWallet = { ...wallet, share: shares.phone, epoch: shares.epoch }
  savePhoneWallet(updated)
  const kit: Kit = { walletId: wallet.walletId, publicKey: wallet.publicKey, share: shares.kit, btcAddress: wallet.btcAddress, evmAddress: wallet.evmAddress }
  return { wallet: updated, kit }
}

export type EscrowStatus = { deposited: boolean; epoch: number | null; swissquoteOnline: boolean; releaseAfter: number | null }

/** What the independent escrow agent holds for this wallet, and whether it would step in now. */
export const escrowStatus = (walletId: string) => escrowGet<EscrowStatus>(`/wallets/${walletId}`)

/**
 * Swissquote is gone and the phone is lost: the escrow agent (after its own identity check) and the
 * kit rebuild the phone share. Same addresses. Afterwards the phone signs with the kit (phone + kit).
 */
export async function recoverWithEscrow(kit: Kit, kyc: 'match' | 'mismatch', onStep?: (step: number) => void) {
  const shares = await recoverSharesWithEscrow(kit.walletId, kit.share, kit.publicKey, onStep, { kyc })
  const wallet: PhoneWallet = { walletId: kit.walletId, share: shares.phone, publicKey: shares.publicKey, independent: true, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  session = null
  return { wallet, kit: { ...kit, share: shares.kit } }
}

export async function pairDevice(login: LoginResult, kit: Kit, onStep?: (step: number) => void) {
  if (kit.walletId !== login.walletId) throw new Error('This recovery kit belongs to a different wallet.')
  const { pairingToken } = await shareService<{ pairingToken: string }>(`/wallets/${login.walletId}/pair`, { token: login.token })
  const shares = await recoverShares(kit.walletId, kit.share, kit.publicKey, onStep, { pairingToken })
  const wallet: PhoneWallet = { walletId: kit.walletId, name: login.name ?? undefined, share: shares.phone, publicKey: shares.publicKey, epoch: shares.epoch, ...addressesFor(shares.publicKey) }
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

export type RecoveryStatus = {
  state: 'pending' | 'ready' | 'completed' | 'cancelled'
  readyAt?: number
  cancelledAt?: number | null
  canCancel?: boolean
} | null

/** Step 1 on the new phone: identity check (mocked KYC) starts the delay, or refuses an attacker. */
const recoveryTokens = new Map<string, string>() // bearer session stays on the recovering device, never in public wallet status

export async function requestRecovery(kit: Kit, kyc: 'match' | 'mismatch') {
  let proof: { proofId: string; signature: string } | undefined
  if (kyc === 'match') {
    const start = await shareService<StartResponse & { proofId: string }>(`/wallets/${kit.walletId}/recovery/proof/start`)
    const { sig } = await signWithSwissquote(kit.share, start, KIT)
    proof = { proofId: start.proofId, signature: toB64(new Uint8Array([...sig.r, ...sig.s])) }
  }
  const view = await shareService<{ recovery: RecoveryStatus; recoveryToken: string }>(`/wallets/${kit.walletId}/recovery/request`, { kyc, ...proof })
  recoveryTokens.set(kit.walletId, view.recoveryToken)
  return view.recovery
}

export async function recoveryStatus(walletId: string) {
  return (await shareGet<{ recovery: RecoveryStatus }>(`/wallets/${walletId}`)).recovery
}

export type WalletStatus = { epoch: number; recovery: RecoveryStatus }

/** What Swissquote currently knows about the wallet: share generation and any recovery in progress. */
export const walletStatus = (walletId: string) => shareGet<WalletStatus>(`/wallets/${walletId}`)

/** Owner veto: Face ID on a device that still holds the current passkey stops a pending recovery. */
export async function cancelRecovery(walletId: string) {
  session = null // always ask for Face ID again for a security action
  const token = await login(walletId)
  return shareService<WalletStatus>(`/wallets/${walletId}/recovery/cancel`, { token })
}

/** Step 2 after the delay: new passkey, then kit + Swissquote rebuild Share A. Returns the new kit. */
export async function completeRecovery(kit: Kit, onStep?: (step: number) => void) {
  const recoveryToken = recoveryTokens.get(kit.walletId)
  if (!recoveryToken) throw new Error('Start recovery again on this device to establish a recovery session.')
  const { options } = await shareService<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(`/wallets/${kit.walletId}/passkey/options`, { recoveryToken })
  const response = await startRegistration({ optionsJSON: options })
  await shareService(`/wallets/${kit.walletId}/passkey`, { response, recoveryToken })
  const shares = await recoverShares(kit.walletId, kit.share, kit.publicKey, onStep, { recoveryToken })
  recoveryTokens.delete(kit.walletId)
  const { name } = await shareGet<{ name: string | null }>(`/wallets/${kit.walletId}`)
  const wallet: PhoneWallet = { walletId: kit.walletId, name: name ?? undefined, share: shares.phone, publicKey: shares.publicKey, epoch: shares.epoch, ...addressesFor(shares.publicKey) }
  savePhoneWallet(wallet)
  session = null
  const newKit: Kit = { ...kit, share: shares.kit }
  return { wallet, kit: newKit }
}
