// On-chain social backup of the recovery kit (contracts/src/KitBackupMailbox.sol on Base Sepolia).
//
// Friends hold the data, the client holds the secret:
//  - every friend publishes an inbox key (P-256), signed by their own wallet (phone + Swissquote).
//    Swissquote holds only one share of that wallet, so it cannot swap in a key of its own;
//  - the client's kit share is locked with the kit password, then sealed with a random key K. K is
//    split with Shamir (any 2), and each friend's piece is encrypted to that friend's inbox key;
//  - the sealed kit sits on-chain in chunks. Swissquote's treasury pays the gas.
// To recover, the new phone makes a one-time key and sends its friends a link. Each friend's app
// encrypts its piece to that key and posts it on-chain. Two pieces + the kit password rebuild the kit.
import { combine as shamirCombine, split as shamirSplit } from 'shamir-secret-sharing'
import { concat, getAddress, hashTypedData, hexToBytes, keccak256, parseAbi, parseAbiItem, toHex, type Address, type Hex } from 'viem'
import { BACKUP_MAILBOX } from '../config'
import { publicClient } from '../wallet'
import { shareGet, shareService } from './api'
import { fromB64, toB64 } from './bytes'
import { cosignTypedMessage } from './flows'
import { lockKitCompact, unlockKitCompact, type Kit } from './kit'
import type { PhoneWallet } from './store'

export const backupAvailable = BigInt(BACKUP_MAILBOX) !== 0n
const CHUNK_BYTES = 96_000 // a transaction carries at most ~128 KB
const THRESHOLD = 2

const abi = parseAbi([
  'function inboxKey(address) view returns (bytes)',
  'function nonces(address) view returns (uint256)',
  'function latestBackup(address) view returns (bytes32)',
  'function getBackup(bytes32 setId) view returns (address wallet, bytes32 kitHash, uint32 kitChunks, uint64[] chunkBlocks, address[] friends, bytes[] pieces)',
  'function isComplete(bytes32 setId) view returns (bool)',
  'function backupsHeldBy(address friend) view returns (bytes32[])',
  'function returnedPieces(bytes32 requestId) view returns (bytes[])',
])
const kitChunkEvent = parseAbiItem('event KitChunk(bytes32 indexed setId, uint256 index, bytes data)')
const mailbox = { address: BACKUP_MAILBOX, abi } as const

// ---------- EIP-712 messages (must match services/backup-mailbox.mjs and the contract) ----------

type InboxRequest = { kind: 'inbox'; key: Hex; nonce: string }
type BackupRequest = { kind: 'backup'; setId: Hex; kitHash: Hex; kitChunks: number; friends: Address[]; piecesHash: Hex; nonce: string }

const domain = () => ({ name: 'Swissquote Kit Backup', version: '1', chainId: 84532, verifyingContract: BACKUP_MAILBOX })

function messageHash(wallet: Address, request: InboxRequest | BackupRequest): Hex {
  if (request.kind === 'inbox')
    return hashTypedData({
      domain: domain(),
      types: { InboxKey: [{ name: 'owner', type: 'address' }, { name: 'key', type: 'bytes' }, { name: 'nonce', type: 'uint256' }] },
      primaryType: 'InboxKey',
      message: { owner: wallet, key: request.key, nonce: BigInt(request.nonce) },
    })
  return hashTypedData({
    domain: domain(),
    types: {
      Backup: [
        { name: 'wallet', type: 'address' },
        { name: 'setId', type: 'bytes32' },
        { name: 'kitHash', type: 'bytes32' },
        { name: 'kitChunks', type: 'uint32' },
        { name: 'friends', type: 'address[]' },
        { name: 'piecesHash', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'Backup',
    message: { ...request, wallet, nonce: BigInt(request.nonce) },
  })
}

export function chainHash(chunks: Hex[]): Hex {
  let hash: Hex = `0x${'00'.repeat(32)}`
  for (const chunk of chunks) hash = keccak256(concat([hash, chunk]))
  return hash
}

// ---------- encryption to a P-256 key (ECIES with WebCrypto: ECDH + HKDF + AES-GCM) ----------

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const INFO = new TextEncoder().encode('swissquote-kit-backup-v1')
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const join = (...parts: Uint8Array[]) => hexToBytes(concat(parts.map((p) => toHex(p))))
const utf8 = (text: string) => new TextEncoder().encode(text)
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

type OwnKey = { publicRaw: Uint8Array; privateKey: CryptoKey }

async function aesKey(privateKey: CryptoKey, publicRaw: Uint8Array, salt: Uint8Array) {
  const pub = await crypto.subtle.importKey('raw', publicRaw as BufferSource, ECDH, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256)
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** A fresh ephemeral key per message. Layout: ephemeral public key (65) | iv (12) | ciphertext. */
async function seal(recipient: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const key = await aesKey(eph.privateKey, recipient, join(ephRaw, recipient))
  const iv = random(12)
  return join(ephRaw, iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource)))
}

async function unseal(own: OwnKey, sealed: Uint8Array): Promise<Uint8Array> {
  const ephRaw = sealed.slice(0, 65)
  const key = await aesKey(own.privateKey, ephRaw, join(ephRaw, own.publicRaw))
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(65, 77) }, key, sealed.slice(77)))
}

// Prototype limitation, like Share A: the private keys sit in localStorage on this device.
async function loadKey(slot: string): Promise<OwnKey | null> {
  try {
    const raw = localStorage.getItem(slot)
    if (!raw) return null
    const stored = JSON.parse(raw) as { publicRaw: string; privateJwk: JsonWebKey }
    return { publicRaw: fromB64(stored.publicRaw), privateKey: await crypto.subtle.importKey('jwk', stored.privateJwk, ECDH, false, ['deriveBits']) }
  } catch {
    return null
  }
}

async function createKey(slot: string): Promise<OwnKey> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  localStorage.setItem(slot, JSON.stringify({ publicRaw: toB64(publicRaw), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }))
  return { publicRaw, privateKey: pair.privateKey }
}

/** Swissquote pays the gas for every backup transaction: check before asking for Face ID. */
async function requireFeeAccount() {
  const treasury = await shareGet<{ address: string; eth: string }>('/treasury').catch(() => null)
  if (treasury && Number(treasury.eth) === 0)
    throw new Error(`Swissquote's fee account is empty, so it cannot pay the network fee yet. Top up ${treasury.address} with Base Sepolia ETH.`)
}

// ---------- friend: hold pieces for others ----------

const inboxSlot = (wallet: PhoneWallet) => `sq-backup:inbox:${wallet.evmAddress.toLowerCase()}`

export type InboxStatus = 'off' | 'ready' | 'other-device'

export async function inboxStatus(wallet: PhoneWallet): Promise<InboxStatus> {
  const [local, onChain] = await Promise.all([loadKey(inboxSlot(wallet)), publicClient.readContract({ ...mailbox, functionName: 'inboxKey', args: [wallet.evmAddress as Address] })])
  if (onChain === '0x') return 'off'
  return local && onChain.toLowerCase() === toHex(local.publicRaw) ? 'ready' : 'other-device'
}

/** Publishes this phone's inbox key, signed by the wallet itself (one Face ID). Swissquote pays the gas. */
export async function registerInbox(wallet: PhoneWallet) {
  await requireFeeAccount()
  const address = getAddress(wallet.evmAddress)
  const own = (await loadKey(inboxSlot(wallet))) ?? (await createKey(inboxSlot(wallet)))
  const nonce = await publicClient.readContract({ ...mailbox, functionName: 'nonces', args: [address] })
  const request: InboxRequest = { kind: 'inbox', key: toHex(own.publicRaw), nonce: nonce.toString() }
  const { token, signature } = await cosignTypedMessage(wallet, { chain: 'backup', backup: request }, messageHash(address, request))
  return shareService<{ hash: Hex }>(`/wallets/${wallet.walletId}/backup/inbox`, { token, backup: request, signature })
}

export async function friendReady(address: Address) {
  return (await publicClient.readContract({ ...mailbox, functionName: 'inboxKey', args: [address] })) !== '0x'
}

/** What a friend's piece contains (only that friend can read it): one Shamir piece of K + the kit's public data. */
export type PiecePayload = {
  v: 1
  setId: Hex
  wallet: Address
  walletId: string
  name?: string
  publicKey: string
  btcAddress: string
  piece: number
  of: number
  threshold: number
  keyPiece: string
}
export type HeldPiece = PiecePayload & { current: boolean; complete: boolean }

export async function heldPieces(wallet: PhoneWallet): Promise<HeldPiece[]> {
  const own = await loadKey(inboxSlot(wallet))
  if (!own) return []
  const me = wallet.evmAddress.toLowerCase()
  const sets = await publicClient.readContract({ ...mailbox, functionName: 'backupsHeldBy', args: [wallet.evmAddress as Address] })
  const held: HeldPiece[] = []
  for (const setId of [...new Set(sets)]) {
    const [owner, , , , friends, pieces] = await publicClient.readContract({ ...mailbox, functionName: 'getBackup', args: [setId] })
    const index = friends.findIndex((f) => f.toLowerCase() === me)
    if (index < 0) continue
    try {
      const payload = JSON.parse(fromUtf8(await unseal(own, hexToBytes(pieces[index])))) as PiecePayload
      if (payload.setId !== setId || payload.wallet.toLowerCase() !== owner.toLowerCase()) continue
      const [latest, complete] = await Promise.all([
        publicClient.readContract({ ...mailbox, functionName: 'latestBackup', args: [owner] }),
        publicClient.readContract({ ...mailbox, functionName: 'isComplete', args: [setId] }),
      ])
      held.push({ ...payload, current: latest === setId, complete })
    } catch {
      // encrypted to an inbox key this phone no longer has
    }
  }
  return held
}

/** Encrypts the friend's piece to the recovering phone's one-time key and posts it on-chain. */
export async function giveBack(piece: HeldPiece, requestKey: Uint8Array, from?: string) {
  await requireFeeAccount()
  const { current: _current, complete: _complete, ...payload } = piece
  const sealed = await seal(requestKey, utf8(JSON.stringify({ ...payload, from })))
  return shareService<{ hash: Hex }>('/backup/return', { requestId: keccak256(requestKey), sealed: toHex(sealed), from })
}

// ---------- client: back up the kit to friends ----------

export type BackupStage = 'locking' | 'auth' | 'writing'

export async function backUpToFriends(wallet: PhoneWallet, kit: Kit, password: string, friendList: string[], onStage: (stage: BackupStage) => void) {
  const address = getAddress(wallet.evmAddress)
  const friends = friendList.map((f) => getAddress(f.trim()))
  const inboxKeys = await Promise.all(friends.map((f) => publicClient.readContract({ ...mailbox, functionName: 'inboxKey', args: [f] })))
  inboxKeys.forEach((key, i) => {
    if (key === '0x') throw new Error(`${friends[i]} has not turned on "Hold backups for friends" yet.`)
  })
  await requireFeeAccount()

  onStage('locking')
  const locked = await lockKitCompact(kit.share, password) // still needs the password after any rebuild
  const rawKey = random(32)
  const aes = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const iv = random(12)
  const sealedKit = join(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, locked as BufferSource)))
  const chunks: Hex[] = []
  for (let i = 0; i < sealedKit.length; i += CHUNK_BYTES) chunks.push(toHex(sealedKit.slice(i, i + CHUNK_BYTES)))
  const keyPieces = await shamirSplit(rawKey, friends.length, THRESHOLD)
  rawKey.fill(0)

  const setId = toHex(random(32))
  const pieces: Hex[] = []
  for (let i = 0; i < friends.length; i++) {
    const payload: PiecePayload = {
      v: 1,
      setId,
      wallet: address,
      walletId: kit.walletId,
      name: wallet.name,
      publicKey: toB64(kit.publicKey),
      btcAddress: kit.btcAddress,
      piece: i + 1,
      of: friends.length,
      threshold: THRESHOLD,
      keyPiece: toB64(keyPieces[i]),
    }
    pieces.push(toHex(await seal(hexToBytes(inboxKeys[i]), utf8(JSON.stringify(payload)))))
  }
  const nonce = await publicClient.readContract({ ...mailbox, functionName: 'nonces', args: [address] })
  const request: BackupRequest = {
    kind: 'backup',
    setId,
    kitHash: chainHash(chunks),
    kitChunks: chunks.length,
    friends,
    piecesHash: keccak256(concat(pieces.map((p) => keccak256(p)))),
    nonce: nonce.toString(),
  }

  onStage('auth')
  const { token, signature } = await cosignTypedMessage(wallet, { chain: 'backup', backup: request }, messageHash(address, request))
  onStage('writing')
  return shareService<{ hash: Hex; uploads: Hex[] }>(`/wallets/${wallet.walletId}/backup/create`, { token, backup: request, pieces, chunks, signature })
}

// ---------- client on a new phone: ask friends for the pieces back ----------

const REQUEST_SLOT = 'sq-backup:request'
const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (text: string) => fromB64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))

/** One-time key of this recovering phone; kept across reloads until the kit is rebuilt. */
export const pieceRequest = async () => (await loadKey(REQUEST_SLOT)) ?? (await createKey(REQUEST_SLOT))
export const clearPieceRequest = () => localStorage.removeItem(REQUEST_SLOT)
export const requestLink = (publicRaw: Uint8Array) => `${location.origin}${location.pathname}#give-back=${b64url(publicRaw)}`

export function parseGiveBack(hash: string): Uint8Array | null {
  const match = /^#give-back=([\w-]+)$/.exec(hash)
  if (!match) return null
  try {
    const key = unb64url(match[1])
    return key.length === 65 && key[0] === 4 ? key : null
  } catch {
    return null
  }
}

/** Both phones show this code; the friend checks it with the client by phone before giving back. */
export async function safetyCode(publicRaw: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', publicRaw as BufferSource))
  const n = ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000
  return n.toString().padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2')
}

export type ReturnedPiece = PiecePayload & { from?: string }

export async function returnedPieces(request: OwnKey): Promise<ReturnedPiece[]> {
  const list = await publicClient.readContract({ ...mailbox, functionName: 'returnedPieces', args: [keccak256(request.publicRaw)] })
  const result: ReturnedPiece[] = []
  for (const sealed of list) {
    try {
      result.push(JSON.parse(fromUtf8(await unseal(request, hexToBytes(sealed)))))
    } catch {
      // not readable with this phone's key: ignore
    }
  }
  return result
}

/** The backup with the most distinct pieces back (a friend may hold pieces of an older backup too). */
export function bestSet(pieces: ReturnedPiece[]) {
  const sets = new Map<Hex, Map<number, ReturnedPiece>>()
  for (const p of pieces) sets.set(p.setId, (sets.get(p.setId) ?? new Map()).set(p.piece, p))
  const [best] = [...sets.values()].map((m) => [...m.values()]).sort((a, b) => b.length - a.length)
  return best ? { pieces: best, threshold: best[0].threshold, name: best[0].name } : null
}

/** Two pieces give back K; K opens the sealed kit from the chain; the client's password opens the kit. */
export async function rebuildKitFromChain(returned: ReturnedPiece[], password: string): Promise<Kit> {
  const best = bestSet(returned)
  if (!best || best.pieces.length < best.threshold) throw new Error(`You need ${best?.threshold ?? THRESHOLD} pieces back first.`)
  const first = best.pieces[0]
  const [owner, kitHash, kitChunks, chunkBlocks] = await publicClient.readContract({ ...mailbox, functionName: 'getBackup', args: [first.setId] })
  if (owner.toLowerCase() !== first.wallet.toLowerCase() || chunkBlocks.length !== kitChunks) throw new Error('This backup is not complete on-chain.')
  const chunks: Hex[] = []
  for (const [index, block] of chunkBlocks.entries()) {
    const logs = await publicClient.getLogs({ address: BACKUP_MAILBOX, event: kitChunkEvent, args: { setId: first.setId }, fromBlock: block, toBlock: block })
    const log = logs.find((l) => l.args.index === BigInt(index))
    if (!log?.args.data) throw new Error('Part of the backup could not be read from the chain. Try again.')
    chunks.push(log.args.data)
  }
  if (chainHash(chunks) !== kitHash) throw new Error('The backup on-chain does not match what was signed.')
  const rawKey = await shamirCombine(best.pieces.map((p) => fromB64(p.keyPiece)))
  let locked: Uint8Array
  try {
    const aes = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['decrypt'])
    const sealedKit = hexToBytes(concat(chunks))
    locked = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealedKit.slice(0, 12) }, aes, sealedKit.slice(12)))
  } catch {
    throw new Error('These pieces do not unlock the backup.')
  } finally {
    rawKey.fill(0)
  }
  const share = await unlockKitCompact(locked, password)
  return { walletId: first.walletId, publicKey: fromB64(first.publicKey), share, btcAddress: first.btcAddress, evmAddress: getAddress(first.wallet) }
}
