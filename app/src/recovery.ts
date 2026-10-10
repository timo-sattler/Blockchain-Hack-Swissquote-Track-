import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  slice,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { chain, GUARDIAN_URL, RECOVERY_DELAY, RECOVERY_MODULE } from './config'
import { publicClient, type Call, type SmartAccount } from './wallet'

// ---------------------------------------------------------------- contract

export const recoveryModuleAbi = [
  {
    type: 'function',
    name: 'setGuardians',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'guardians', type: 'address[]' },
      { name: 'threshold', type: 'uint8' },
      { name: 'delay', type: 'uint32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'cancelRecovery', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'startRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signers', type: 'address[]' },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeRecovery',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getConfig',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'guardians', type: 'address[]' },
      { name: 'threshold', type: 'uint8' },
      { name: 'delay', type: 'uint32' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'pending',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
      { name: 'executeAfter', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'isEnabled',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const addOwnerAddressAbi = [
  {
    type: 'function',
    name: 'addOwnerAddress',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [],
  },
] as const

export type RecoveryState = {
  enabled: boolean
  guardians: Address[]
  threshold: number
  delay: number
  nonce: bigint
  pending: { x: Hex; y: Hex; executeAfter: number } | null
}

export async function readRecovery(account: Address): Promise<RecoveryState> {
  const read = <T,>(functionName: 'isEnabled' | 'getConfig' | 'pending') =>
    publicClient.readContract({ address: RECOVERY_MODULE, abi: recoveryModuleAbi, functionName, args: [account] }) as Promise<T>
  const [enabled, [guardians, threshold, delay, nonce], [x, y, executeAfter]] = await Promise.all([
    read<boolean>('isEnabled'),
    read<readonly [readonly Address[], number, number, bigint]>('getConfig'),
    read<readonly [Hex, Hex, bigint]>('pending'),
  ])
  return {
    enabled,
    guardians: [...guardians],
    threshold,
    delay,
    nonce,
    pending: executeAfter > 0n ? { x, y, executeAfter: Number(executeAfter) } : null,
  }
}

/** The passkey public key is x‖y (64 bytes), exactly how the smart account stores it. */
export function splitPublicKey(publicKey: Hex): { x: Hex; y: Hex } {
  return { x: slice(publicKey, 0, 32), y: slice(publicKey, 32, 64) }
}

/** The contract requires guardians and signers in ascending order. */
export const sortAddresses = (list: Address[]) => [...list].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))

/** One UserOperation: let the module manage owners (first time only), then register the guardians. */
export function setupCalls(account: SmartAccount, guardians: Address[], threshold: number, moduleIsOwner: boolean): Call[] {
  const calls: Call[] = []
  if (!moduleIsOwner)
    calls.push({
      to: account.address,
      data: encodeFunctionData({ abi: addOwnerAddressAbi, functionName: 'addOwnerAddress', args: [RECOVERY_MODULE] }),
    })
  calls.push({
    to: RECOVERY_MODULE,
    data: encodeFunctionData({
      abi: recoveryModuleAbi,
      functionName: 'setGuardians',
      args: [sortAddresses(guardians), threshold, RECOVERY_DELAY],
    }),
  })
  return calls
}

export const cancelCall = (): Call => ({
  to: RECOVERY_MODULE,
  data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'cancelRecovery' }),
})

export const executeCall = (account: Address): Call => ({
  to: RECOVERY_MODULE,
  data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'executeRecovery', args: [account] }),
})

export function startCall(request: RecoveryRequest, approvals: Approval[]): Call {
  const sorted = [...approvals].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1))
  return {
    to: RECOVERY_MODULE,
    data: encodeFunctionData({
      abi: recoveryModuleAbi,
      functionName: 'startRecovery',
      args: [
        request.account,
        request.x,
        request.y,
        BigInt(request.deadline),
        sorted.map((a) => a.signer),
        sorted.map((a) => a.signature),
      ],
    }),
  }
}

export const MAX_CONTACTS = 3 // recovery kit + Swissquote + 3 contacts = the contract's maximum of 5

/** Suggested approvals for n guardians: 2 of 3, then 3 of 4 or 5, so no pair of friends can start a recovery alone. */
export const suggestedThreshold = (guardianCount: number) => (guardianCount <= 3 ? 2 : 3)

// The chain only stores addresses. Who is who is remembered on this device, to show names and to keep
// the same recovery kit when the guardians change later.
export type GuardianLabel = { address: Address; kind: 'kit' | 'swissquote' | 'contact'; name: string }
const labelsKey = (account: Address) => `sq-wallet:guardians:${account.toLowerCase()}`

export function loadGuardianLabels(account: Address): GuardianLabel[] {
  try {
    return JSON.parse(localStorage.getItem(labelsKey(account)) ?? '[]')
  } catch {
    return []
  }
}

export function saveGuardianLabels(account: Address, labels: GuardianLabel[]) {
  try {
    localStorage.setItem(labelsKey(account), JSON.stringify(labels))
  } catch {
    // Names are a convenience; the guardians themselves are on-chain.
  }
}

// ---------------------------------------------------------------- guardian approvals

/** What every guardian approves: this new passkey for this account, at this on-chain nonce. */
export type RecoveryRequest = { account: Address; x: Hex; y: Hex; nonce: string; deadline: number }
export type Approval = { signer: Address; signature: Hex }

export function recoveryTypedData(request: RecoveryRequest) {
  return {
    domain: { name: 'Swissquote Wallet Recovery', version: '1', chainId: chain.id, verifyingContract: RECOVERY_MODULE },
    types: {
      Recovery: [
        { name: 'account', type: 'address' },
        { name: 'x', type: 'bytes32' },
        { name: 'y', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Recovery',
    message: {
      account: request.account,
      x: request.x,
      y: request.y,
      nonce: BigInt(request.nonce),
      deadline: BigInt(request.deadline),
    },
  } as const
}

/** Checks an approval locally before it is ever sent on-chain. */
export async function verifyApproval(request: RecoveryRequest, approval: Approval, guardians: Address[]) {
  if (!guardians.some((g) => g.toLowerCase() === approval.signer.toLowerCase()))
    throw new Error('That approval is not from one of your guardians.')
  const valid = await verifyTypedData({ address: approval.signer, signature: approval.signature, ...recoveryTypedData(request) })
  if (!valid) throw new Error('That approval is for a different request or was tampered with.')
}

// ---------------------------------------------------------------- the client's recovery kit (guardian 1)

/**
 * A key the client keeps offline (printed or on a USB stick). On its own it cannot move funds or
 * recover the wallet: it is one approval out of the two needed.
 */
export function createRecoveryKit(account: Address) {
  const privateKey = generatePrivateKey()
  const address = privateKeyToAccount(privateKey).address
  const text = [
    'SWISSQUOTE WALLET · RECOVERY KIT',
    '',
    'Keep this offline: print it or store it on a USB stick, not on your phone.',
    'It is one of three recovery approvals. Two are needed, so this kit alone cannot recover',
    'your wallet, and losing it does not lock you out.',
    '',
    `Wallet: ${account}`,
    `Network: ${chain.name} (${chain.id})`,
    `Recovery key: ${privateKey}`,
    `Guardian address: ${address}`,
    '',
  ].join('\n')
  return { address, text }
}

export function parseRecoveryKit(text: string): { account: Address; privateKey: Hex } {
  const account = text.match(/Wallet:\s*(0x[0-9a-fA-F]{40})/)?.[1]
  const privateKey = text.match(/Recovery key:\s*(0x[0-9a-fA-F]{64})/)?.[1]
  if (!account || !privateKey) throw new Error('This does not look like a Swissquote recovery kit.')
  return { account: getAddress(account), privateKey: privateKey as Hex }
}

export async function signWithKit(privateKey: Hex, request: RecoveryRequest): Promise<Approval> {
  const signer = privateKeyToAccount(privateKey)
  return { signer: signer.address, signature: await signer.signTypedData(recoveryTypedData(request)) }
}

// ---------------------------------------------------------------- trusted contact (guardian 3), peer to peer

// The contact's guardian key lives in their own browser. Requests and approvals travel as a link
// and a short code over any messenger: no server in between, so this works even without Swissquote.
const CONTACT_KEY = 'sq-guardian:key'

export function contactGuardian() {
  let key = null
  try {
    key = localStorage.getItem(CONTACT_KEY) as Hex | null
    if (!key) {
      key = generatePrivateKey()
      localStorage.setItem(CONTACT_KEY, key)
    }
  } catch {
    key ??= generatePrivateKey()
  }
  return privateKeyToAccount(key)
}

const toBase64Url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (value: string) => JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')))

export function requestLink(request: RecoveryRequest, clientName: string) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#guardian=${toBase64Url({ ...request, name: clientName, chainId: chain.id })}`
}

export function parseRequestLink(hash: string): (RecoveryRequest & { name: string }) | null {
  const encoded = hash.match(/#guardian=([\w-]+)/)?.[1]
  if (!encoded) return null
  try {
    const r = fromBase64Url(encoded)
    if (r.chainId !== chain.id || !isAddress(r.account) || !isHex(r.x) || !isHex(r.y)) return null
    return { account: getAddress(r.account), x: r.x, y: r.y, nonce: String(r.nonce), deadline: Number(r.deadline), name: String(r.name) }
  } catch {
    return null
  }
}

export const encodeApproval = (approval: Approval) => `SQA-${toBase64Url(approval)}`

export function decodeApproval(code: string): Approval {
  try {
    const a = fromBase64Url(code.trim().replace(/^SQA-/, ''))
    if (isAddress(a.signer) && isHex(a.signature)) return { signer: getAddress(a.signer), signature: a.signature }
  } catch {
    // fall through
  }
  throw new Error('That is not a valid approval code.')
}

// ---------------------------------------------------------------- Swissquote guardian (guardian 2), MOCK service

async function api<T>(path: string, body?: object): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${GUARDIAN_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Swissquote guardian service is unreachable (start it with: cd backend/guardian && npm start).')
  }
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json as T
}

export const swissquote = {
  info: () => api<{ address: Address }>('/guardian'),

  /** Proves with a passkey signature that this wallet belongs to the client, then links it. */
  async link(account: SmartAccount, clientId: string) {
    const message = [
      'Swissquote Wallet ownership proof',
      `Client: ${clientId}`,
      `Wallet: ${account.address}`,
      `Chain: ${chain.id}`,
      `Issued: ${new Date().toISOString()}`,
    ].join('\n')
    const signature = await account.signMessage({ message })
    return api<{ linked: true; guardian: Address }>('/wallets/link', { account: account.address, clientId, message, signature })
  },

  lookup: (clientId: string) => api<{ accounts: Address[] }>('/wallets/lookup', { clientId }),

  verifyIdentity: (body: {
    clientId: string
    account: Address
    checks: { emailOtp: boolean; smsOtp: boolean; idDocument: boolean; faceMatch: boolean }
  }) => api<{ session: string }>('/recovery/identity', body),

  approve: (session: string, request: RecoveryRequest) =>
    api<Approval>('/recovery/approve', { session, ...request }),
}
