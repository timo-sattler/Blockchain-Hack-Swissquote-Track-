// Recovery kit: Share C encrypted with a password the client chooses (PBKDF2 + AES-GCM from WebCrypto).
import { fromB64, toB64 } from './bytes'

export type Kit = { walletId: string; publicKey: Uint8Array; share: Uint8Array; btcAddress: string; evmAddress: string }

type KitFile = {
  format: 'swissquote-recovery-kit-v1'
  walletId: string
  publicKey: string
  btcAddress: string
  evmAddress: string
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string }
  iv: string
  ciphertext: string
}

const ITERATIONS = 310_000

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptKit(kit: Kit, password: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, kit.share as BufferSource))
  const file: KitFile = {
    format: 'swissquote-recovery-kit-v1',
    walletId: kit.walletId,
    publicKey: toB64(kit.publicKey),
    btcAddress: kit.btcAddress,
    evmAddress: kit.evmAddress,
    kdf: { name: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
  }
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

export async function decryptKit(fileText: string, password: string): Promise<Kit> {
  let file: KitFile
  try {
    file = JSON.parse(fileText)
  } catch {
    throw new Error('This is not a recovery kit file.')
  }
  if (file.format !== 'swissquote-recovery-kit-v1') throw new Error('This is not a recovery kit file.')
  const key = await deriveKey(password, fromB64(file.kdf.salt), file.kdf.iterations)
  try {
    const share = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) as BufferSource }, key, fromB64(file.ciphertext) as BufferSource))
    return { walletId: file.walletId, publicKey: fromB64(file.publicKey), share, btcAddress: file.btcAddress, evmAddress: file.evmAddress }
  } catch {
    throw new Error('Wrong password for this recovery kit.')
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
