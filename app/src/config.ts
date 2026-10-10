import type { Address } from 'viem'
import { baseSepolia } from 'viem/chains'

export const chain = baseSepolia

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://sepolia.base.org'

// Circle's official test USDC on Base Sepolia (6 decimals)
export const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export const EXPLORER = 'https://sepolia.basescan.org'
export const ETH_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet'
export const USDC_FAUCET = 'https://faucet.circle.com'

// MPC wallet services (services/: npm run share, npm run hub). By default they are reached through the
// Vite proxy on the same origin as the app; set the variables when the app is hosted elsewhere.
export const SHARE_URL = import.meta.env.VITE_SHARE_URL || '/share'
export const HUB_URL = import.meta.env.VITE_HUB_URL || '/hub'
// MOCK independent escrow agent (services/escrow-agent.mjs): only used when Swissquote is gone.
export const ESCROW_URL = import.meta.env.VITE_ESCROW_URL || '/escrow'

// Bitcoin testnet4 via mempool.space (balances, UTXOs, broadcasting).
export const MEMPOOL_API = import.meta.env.VITE_MEMPOOL_API || 'https://mempool.space/testnet4/api'
export const BTC_EXPLORER = MEMPOOL_API.replace(/\/api$/, '')
export const BTC_FAUCET = 'https://mempool.space/testnet4/faucet'

// On-chain kit backup between friends (contracts/src/KitBackupMailbox.sol on Base Sepolia).
export const BACKUP_MAILBOX: Address = import.meta.env.VITE_BACKUP_MAILBOX || '0x52f41590EE5bD2a9912A58433F1868482860C4dD'
