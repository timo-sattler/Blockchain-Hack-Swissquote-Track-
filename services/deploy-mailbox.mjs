// Deploys contracts/src/KitBackupMailbox.sol to Base Sepolia with the testnet deployer key from ../.env.
// Build first: cd contracts && forge build. Prints only the contract address and the transaction.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const env = Object.fromEntries(
  readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)
const key = env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`
const artifact = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'contracts', 'out', 'KitBackupMailbox.sol', 'KitBackupMailbox.json'), 'utf8'))
const account = privateKeyToAccount(key)
const transport = http(process.env.RPC_URL ?? 'https://sepolia.base.org')
const publicClient = createPublicClient({ chain: baseSepolia, transport })
const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`KitBackupMailbox deployed to ${receipt.contractAddress} (tx ${hash}, gas ${receipt.gasUsed})`)
