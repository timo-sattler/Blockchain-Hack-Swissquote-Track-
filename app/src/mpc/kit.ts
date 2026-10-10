// Recovery kit: Share C encrypted with a password the client chooses (PBKDF2 + AES-GCM from WebCrypto).
import { combine as shamirCombine, split as shamirSplit } from 'shamir-secret-sharing'
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

// ---------- Compact locked kit, for the on-chain backup (see backup.ts) ----------
//
// Same password protection as the kit file (PBKDF2 + AES-GCM), but binary and gzip-compressed
// (about 247 KB down to 166 KB), so it fits in two transactions. Layout: salt (16) | iv (12) | ciphertext.

async function gzip(data: Uint8Array, mode: 'compress' | 'decompress') {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function lockKitCompact(share: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, (await gzip(share, 'compress')) as BufferSource))
  const locked = new Uint8Array(28 + ciphertext.length)
  locked.set(salt)
  locked.set(iv, 16)
  locked.set(ciphertext, 28)
  return locked
}

export async function unlockKitCompact(locked: Uint8Array, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, locked.slice(0, 16), ITERATIONS)
  let packed: Uint8Array
  try {
    packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: locked.slice(16, 28) }, key, locked.slice(28)))
  } catch {
    throw new Error('Wrong password for this recovery kit.')
  }
  return gzip(packed, 'decompress')
}

// ---------- Social backup: friends hold the data, the client holds the secret ----------
//
// The pieces protect the PASSWORD-ENCRYPTED kit, not Share C itself. That locked kit is encrypted once
// more with a fresh random key, and only that 32-byte key is split with Shamir's secret sharing (audited
// library by Privy), any 2 of 3. Two pieces give back the locked kit, which still needs the kit password
// that only the client knows. So even two friends together, or two friends plus Swissquote, get nothing
// usable; one friend alone cannot even start guessing the password.

type PieceFile = {
  format: 'swissquote-kit-piece-v2'
  walletId: string
  publicKey: string
  btcAddress: string
  evmAddress: string
  setId: string
  piece: number
  of: number
  threshold: number
  keyPiece: string
  iv: string
  /** AES-GCM of the password-encrypted kit file (a KitFile), under the key the pieces rebuild. */
  lockedKit: string
}

export async function splitKitForTrustedPeople(kit: Kit, password: string, total = 3, threshold = 2): Promise<Blob[]> {
  const lockedKit = new TextEncoder().encode(await (await encryptKit(kit, password)).text())
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, lockedKit))
  const keyPieces = await shamirSplit(rawKey, total, threshold)
  rawKey.fill(0)
  const setId = toB64(crypto.getRandomValues(new Uint8Array(9)))
  return keyPieces.map((keyPiece, i) => {
    const file: PieceFile = {
      format: 'swissquote-kit-piece-v2',
      walletId: kit.walletId,
      publicKey: toB64(kit.publicKey),
      btcAddress: kit.btcAddress,
      evmAddress: kit.evmAddress,
      setId,
      piece: i + 1,
      of: total,
      threshold,
      keyPiece: toB64(keyPiece),
      iv: toB64(iv),
      lockedKit: toB64(sealed),
    }
    return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  })
}

export async function combineKitPieces(fileTexts: string[], password: string): Promise<Kit> {
  let pieces: PieceFile[]
  try {
    pieces = fileTexts.map((text) => JSON.parse(text))
  } catch {
    throw new Error('One of these files is not a kit piece.')
  }
  if (pieces.some((p) => p.format === ('swissquote-kit-piece-v1' as string)))
    throw new Error('These are old pieces that did not need your password. They are no longer accepted: replace your kit and create new pieces.')
  if (pieces.some((p) => p.format !== 'swissquote-kit-piece-v2')) throw new Error('One of these files is not a kit piece.')
  const [first] = pieces
  if (pieces.some((p) => p.walletId !== first.walletId || p.setId !== first.setId)) throw new Error('These pieces belong to different kits.')
  const distinct = new Map(pieces.map((p) => [p.piece, p]))
  if (distinct.size < first.threshold) throw new Error(`You need ${first.threshold} different pieces.`)
  const rawKey = await shamirCombine([...distinct.values()].map((p) => fromB64(p.keyPiece)))
  let lockedKit: string
  try {
    const key = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(first.iv) as BufferSource }, key, fromB64(first.lockedKit) as BufferSource)
    lockedKit = new TextDecoder().decode(plain)
  } catch {
    throw new Error('These pieces do not unlock the kit.')
  } finally {
    rawKey.fill(0)
  }
  // The pieces only gave back the locked kit: the client's own password opens it.
  return decryptKit(lockedKit, password)
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
