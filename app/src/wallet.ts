import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import {
  createBundlerClient,
  createPaymasterClient,
  createWebAuthnCredential,
  toCoinbaseSmartAccount,
  toWebAuthnAccount,
  type ToCoinbaseSmartAccountReturnType,
} from 'viem/account-abstraction'
import { BUNDLER_URL, chain, PAYMASTER_URL, RPC_URL, USDC } from './config'

export type SmartAccount = ToCoinbaseSmartAccountReturnType
export type Token = 'USDC' | 'ETH'

/**
 * Public data of the passkey. The private key never leaves the device's secure element.
 * `account` is set after a recovery: the new passkey then controls an existing account
 * instead of the one its public key would derive.
 */
export type StoredPasskey = { id: string; publicKey: Hex; account?: Address }

const PASSKEY_KEY = 'sq-wallet:passkey'

// The public RPC rate-limits hard (HTTP 429). Contract reads made in the same tick are merged into one
// Multicall3 call, and the remaining requests go out as one JSON-RPC batch.
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { wait: 16 }, retryCount: 4, retryDelay: 400 }),
  batch: { multicall: { wait: 16 } },
})

const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(BUNDLER_URL),
  userOperation: { estimateFeesPerGas: bundlerGasPrice },
})

// Same bundler, but asks the paymaster to sponsor gas. Null when no paymaster is configured.
const sponsoredBundlerClient = PAYMASTER_URL
  ? createBundlerClient({
      client: publicClient,
      transport: http(BUNDLER_URL),
      paymaster: createPaymasterClient({ transport: http(PAYMASTER_URL) }),
      userOperation: { estimateFeesPerGas: bundlerGasPrice },
    })
  : null

// Pimlico rejects UserOperations priced below its own quote, so ask the bundler first.
async function bundlerGasPrice() {
  try {
    const res = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pimlico_getUserOperationGasPrice', params: [] }),
    })
    const { result } = (await res.json()) as { result: { fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } } }
    return {
      maxFeePerGas: BigInt(result.fast.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(result.fast.maxPriorityFeePerGas),
    }
  } catch {
    const fees = await publicClient.estimateFeesPerGas()
    return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
  }
}

export function loadPasskey(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(PASSKEY_KEY)
    return raw ? (JSON.parse(raw) as StoredPasskey) : null
  } catch {
    return null
  }
}

export function forgetPasskey() {
  localStorage.removeItem(PASSKEY_KEY)
}

export function savePasskey(passkey: StoredPasskey) {
  localStorage.setItem(PASSKEY_KEY, JSON.stringify(passkey))
}

/** Prompts Face ID / fingerprint and creates a new P-256 passkey on this device. */
export async function createPasskey(label: string): Promise<StoredPasskey> {
  const credential = await createWebAuthnCredential({ name: label })
  return { id: credential.id, publicKey: credential.publicKey }
}

/**
 * The smart account address is derived from the passkey's public key, so it is known
 * before the contract exists. It gets deployed with the first transaction.
 * A recovered passkey signs for an existing account, from the owner slot it was added to.
 */
export async function getAccount(passkey: StoredPasskey): Promise<SmartAccount> {
  const owner = toWebAuthnAccount({ credential: passkey })
  if (!passkey.account) return toCoinbaseSmartAccount({ client: publicClient, owners: [owner], version: '1.1' })

  const ownerIndex = await findOwnerIndex(passkey.account, passkey.publicKey)
  if (ownerIndex === null) throw new Error('This passkey is not (yet) an owner of the recovered wallet.')
  return toCoinbaseSmartAccount({ client: publicClient, owners: [owner], ownerIndex, address: passkey.account, version: '1.1' })
}

async function findOwnerIndex(address: Address, publicKey: Hex): Promise<number | null> {
  const next = await publicClient.readContract({ address, abi: ownersAbi, functionName: 'nextOwnerIndex' })
  const owners = await Promise.all(
    Array.from({ length: Number(next) }, (_, i) =>
      publicClient.readContract({ address, abi: ownersAbi, functionName: 'ownerAtIndex', args: [BigInt(i)] }),
    ),
  )
  const index = owners.findIndex((owner) => owner.toLowerCase() === publicKey.toLowerCase())
  return index === -1 ? null : index
}

export async function getBalances(address: Address) {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ])
  return { eth, usdc }
}

const ownersAbi = [
  { type: 'function', name: 'nextOwnerIndex', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'ownerAtIndex',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
] as const

/**
 * Reads the owners straight from the smart account contract, so the app can show what the
 * blockchain says instead of what we claim. Returns null while the account is not deployed.
 */
export async function getOnChainOwners(address: Address): Promise<Hex[] | null> {
  const code = await publicClient.getCode({ address })
  if (!code || code === '0x') return null
  const next = await publicClient.readContract({ address, abi: ownersAbi, functionName: 'nextOwnerIndex' })
  const owners = await Promise.all(
    Array.from({ length: Number(next) }, (_, i) =>
      publicClient.readContract({ address, abi: ownersAbi, functionName: 'ownerAtIndex', args: [BigInt(i)] }),
    ),
  )
  return owners.filter((owner) => owner !== '0x') // removed owners leave an empty slot
}

export type Call = { to: Address; value?: bigint; data?: Hex }
export type SentCalls = { hash: Hash; blockNumber: bigint; sponsored: boolean }

/**
 * Asks for gas sponsorship, then for the passkey signature, submits to the bundler and waits for
 * inclusion. If the paymaster refuses or is unreachable, falls back to paying gas from the wallet's
 * own ETH, so the wallet keeps working even if Swissquote stops sponsoring.
 */
export async function sendCalls(
  account: SmartAccount,
  calls: Call[],
  onSubmitted?: (userOpHash: Hash) => void,
): Promise<SentCalls> {
  let prepared = null
  if (sponsoredBundlerClient) {
    try {
      prepared = await sponsoredBundlerClient.prepareUserOperation({ account, calls })
    } catch (error) {
      console.warn('Gas sponsorship unavailable, paying gas from the wallet instead.', error)
    }
  }
  const sponsored = prepared !== null
  prepared ??= await bundlerClient.prepareUserOperation({ account, calls })

  // Sign once and send the exact operation that was prepared (and sponsored).
  const { account: _, ...userOperation } = prepared
  const signature = await account.signUserOperation(userOperation)
  const userOpHash = await bundlerClient.sendUserOperation({
    ...userOperation,
    signature,
    entryPointAddress: account.entryPoint.address,
  })
  onSubmitted?.(userOpHash)

  const { success, receipt, reason } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash })
  if (!success) throw new Error(`Transaction reverted on-chain${reason ? `: ${reason}` : ''}.`)
  await waitForRpc(receipt.blockNumber)
  return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber, sponsored }
}

/**
 * The bundler can report a receipt before the public RPC node we read from has that block. Wait
 * (up to ~10 s) so that reads right after a transaction already show its effect.
 */
async function waitForRpc(blockNumber: bigint) {
  for (let i = 0; i < 20; i++) {
    try {
      if ((await publicClient.getBlockNumber({ cacheTime: 0 })) >= blockNumber) return
    } catch {
      // Keep waiting; the transaction itself is already confirmed.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export function sendTransfer(
  account: SmartAccount,
  { token, to, amount }: { token: Token; to: string; amount: string },
  onSubmitted?: (userOpHash: Hash) => void,
): Promise<SentCalls> {
  if (!isAddress(to)) throw new Error('Recipient is not a valid address.')
  const call =
    token === 'ETH'
      ? { to, value: parseEther(amount) }
      : {
          to: USDC,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, parseUnits(amount, 6)] }),
        }
  return sendCalls(account, [call], onSubmitted)
}

/** Turns the most common bundler errors into something a user can act on. */
export function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/AA21|didn't pay prefund|insufficient funds/i.test(message))
    return 'The wallet has no ETH to pay gas. Fund it with Base Sepolia ETH, or configure a paymaster for gasless transactions.'
  if (/NotAllowedError|not allowed|cancel/i.test(message)) return 'Passkey prompt was cancelled.'
  if (/transfer amount exceeds balance/i.test(message)) return 'Not enough USDC in the wallet.'
  return message.split('\n')[0]
}
