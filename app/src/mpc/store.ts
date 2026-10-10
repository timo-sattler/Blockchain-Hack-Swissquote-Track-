// The phone's own data. Share A is the only secret; the rest is public.
// Prototype limitation: Share A sits in localStorage. Production encrypts it with a key from the
// passkey (WebAuthn PRF) or keeps it in the platform keychain.
import { fromB64, toB64 } from './bytes'

// `epoch` is the share generation this phone holds; Swissquote bumps it whenever recovery or pairing
// issues new shares, which is how a replaced phone finds out.
// `independent`: recovered through the escrow agent after Swissquote disappeared; the phone signs with the kit.
export type PhoneWallet = {
  walletId: string
  name?: string
  share: Uint8Array
  publicKey: Uint8Array
  btcAddress: string
  evmAddress: string
  epoch?: number
  independent?: boolean
}

const KEY = 'sq-mpc:wallet'

export function loadPhoneWallet(): PhoneWallet | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const w = JSON.parse(raw)
    return { ...w, share: fromB64(w.share), publicKey: fromB64(w.publicKey) }
  } catch {
    return null
  }
}

export function savePhoneWallet(wallet: PhoneWallet) {
  localStorage.setItem(KEY, JSON.stringify({ ...wallet, share: toB64(wallet.share), publicKey: toB64(wallet.publicKey) }))
}

export function forgetPhoneWallet() {
  localStorage.removeItem(KEY)
}
