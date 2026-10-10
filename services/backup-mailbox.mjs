// On-chain kit backup (contracts/src/KitBackupMailbox.sol): contract address, ABI and the only two
// EIP-712 messages Swissquote co-signs for it: a friend's inbox key and a client's signed backup.
// Nothing else can be signed through this path, and Swissquote cannot sign either message alone.
import { concat, getAddress, isAddress, isHex, keccak256, parseAbi } from 'viem'

// Deployed on Base Sepolia (https://sepolia.basescan.org/address/0x52f41590EE5bD2a9912A58433F1868482860C4dD); override for a local test chain.
export const MAILBOX = getAddress(process.env.BACKUP_MAILBOX ?? '0x52f41590EE5bD2a9912A58433F1868482860C4dD')
export const CHUNK_BYTES = 96_000 // a transaction carries at most ~128 KB
export const MAX_PIECE_BYTES = 1024

export const mailboxAbi = parseAbi([
  'function registerInboxKey(address owner, bytes key, bytes signature)',
  'function createBackup(address wallet, bytes32 setId, bytes32 kitHash, uint32 kitChunks, address[] friends, bytes[] pieces, bytes signature)',
  'function uploadKitChunk(bytes32 setId, bytes data)',
  'function returnPiece(bytes32 requestId, bytes sealedPiece)',
  'error BadSignature()',
  'error BadInput()',
  'error AlreadyExists()',
  'error NotUploader()',
  'error KitMismatch()',
  'error TooManyReturns()',
])

export class InputError extends Error {}

const isBytes32 = (value) => isHex(value) && value.length === 66
const isUint = (value) => typeof value === 'string' && /^\d{1,20}$/.test(value)

export function backupTypedData(walletAddress, request) {
  const domain = { name: 'Swissquote Kit Backup', version: '1', chainId: 84532, verifyingContract: MAILBOX }
  if (request?.kind === 'inbox') {
    if (!isHex(request.key) || request.key.length !== 132 || !request.key.startsWith('0x04'))
      throw new InputError('the inbox key must be an uncompressed P-256 public key')
    if (!isUint(request.nonce)) throw new InputError('invalid nonce')
    return {
      domain,
      types: {
        InboxKey: [
          { name: 'owner', type: 'address' },
          { name: 'key', type: 'bytes' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'InboxKey',
      message: { owner: getAddress(walletAddress), key: request.key, nonce: BigInt(request.nonce) },
    }
  }
  if (request?.kind === 'backup') {
    const { setId, kitHash, kitChunks, friends, piecesHash, nonce } = request
    if (!isBytes32(setId) || !isBytes32(kitHash) || !isBytes32(piecesHash)) throw new InputError('invalid backup hashes')
    if (!Number.isInteger(kitChunks) || kitChunks < 1 || kitChunks > 8) throw new InputError('invalid number of kit chunks')
    if (!Array.isArray(friends) || friends.length < 2 || friends.length > 5 || !friends.every((f) => isAddress(f)))
      throw new InputError('2 to 5 friend addresses are required')
    const unique = new Set(friends.map((f) => f.toLowerCase()))
    if (unique.size !== friends.length || unique.has(walletAddress.toLowerCase()))
      throw new InputError('the friends must be different people, and not this wallet itself')
    if (!isUint(nonce)) throw new InputError('invalid nonce')
    return {
      domain,
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
      message: { wallet: getAddress(walletAddress), setId, kitHash, kitChunks, friends: friends.map((f) => getAddress(f)), piecesHash, nonce: BigInt(nonce) },
    }
  }
  throw new InputError('unknown backup message')
}

/** Chained hash over the kit chunks, exactly as the contract computes it: h = keccak256(h, chunk). */
export function chainHash(chunks) {
  let hash = `0x${'00'.repeat(32)}`
  for (const chunk of chunks) hash = keccak256(concat([hash, chunk]))
  return hash
}

export const piecesHashOf = (pieces) => keccak256(concat(pieces.map((piece) => keccak256(piece))))
