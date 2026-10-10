// This device's own data. The client's key part is the only secret; the rest is public.
// Prototype limitation: the part sits in localStorage. Production encrypts it with a key from the
// passkey (WebAuthn PRF) or keeps it in the platform keychain.
import { fromB64, toB64 } from './bytes'

// `epoch`: the key generation this device holds (Swissquote refuses outdated ones).
// `independent`: the grace period is over and the device holds both parts (`bankShare`), so it signs alone.
export type PhoneWallet = {
  walletId: string
  name?: string
  share: Uint8Array
  publicKey: Uint8Array
  btcAddress: string
  evmAddress: string
  epoch?: number
  independent?: boolean
  /** Always '2of2': this device's part + Swissquote's part. */
  scheme?: '2of2'
  /** This device's passkey, so the device list can mark "this device". */
  credentialId?: string
  /** After the grace period: Swissquote's part, released by the escrow agent. The device then signs alone. */
  bankShare?: Uint8Array
}

const KEY = 'sq-mpc:wallet'

export function loadPhoneWallet(): PhoneWallet | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const w = JSON.parse(raw)
    return { ...w, share: fromB64(w.share), publicKey: fromB64(w.publicKey), bankShare: w.bankShare ? fromB64(w.bankShare) : undefined }
  } catch {
    return null
  }
}

export function savePhoneWallet(wallet: PhoneWallet) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...wallet, share: toB64(wallet.share), publicKey: toB64(wallet.publicKey), bankShare: wallet.bankShare ? toB64(wallet.bankShare) : undefined }),
  )
}

export function forgetPhoneWallet() {
  localStorage.removeItem(KEY)
}
