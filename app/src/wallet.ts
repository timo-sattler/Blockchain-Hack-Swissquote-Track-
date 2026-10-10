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

/** Public data of the passkey. The private key never leaves the device's secure element. */
export type StoredPasskey = { id: string; publicKey: Hex }

const PASSKEY_KEY = 'sq-wallet:passkey'

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })

const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(BUNDLER_URL),
  paymaster: PAYMASTER_URL ? createPaymasterClient({ transport: http(PAYMASTER_URL) }) : undefined,
  userOperation: { estimateFeesPerGas: bundlerGasPrice },
})

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

/** Prompts Face ID / fingerprint and creates a new P-256 passkey on this device. */
export async function createPasskey(label: string): Promise<StoredPasskey> {
  const credential = await createWebAuthnCredential({ name: label })
  const passkey = { id: credential.id, publicKey: credential.publicKey }
  localStorage.setItem(PASSKEY_KEY, JSON.stringify(passkey))
  return passkey
}

/**
 * The smart account address is derived from the passkey's public key, so it is known
 * before the contract exists. It gets deployed with the first transaction.
 */
export function getAccount(passkey: StoredPasskey): Promise<SmartAccount> {
  const owner = toWebAuthnAccount({ credential: passkey })
  return toCoinbaseSmartAccount({ client: publicClient, owners: [owner], version: '1.1' })
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

/** Builds the call, asks for the passkey signature, submits it to the bundler and waits for inclusion. */
export async function sendTransfer(
  account: SmartAccount,
  { token, to, amount }: { token: Token; to: string; amount: string },
  onSubmitted?: (userOpHash: Hash) => void,
): Promise<{ hash: Hash; blockNumber: bigint }> {
  if (!isAddress(to)) throw new Error('Recipient is not a valid address.')
  const call =
    token === 'ETH'
      ? { to, value: parseEther(amount) }
      : {
          to: USDC,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, parseUnits(amount, 6)] }),
        }

  const userOpHash = await bundlerClient.sendUserOperation({ account, calls: [call] })
  onSubmitted?.(userOpHash)
  const { success, receipt, reason } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash })
  if (!success) throw new Error(`Transaction reverted on-chain${reason ? `: ${reason}` : ''}.`)
  return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber }
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
