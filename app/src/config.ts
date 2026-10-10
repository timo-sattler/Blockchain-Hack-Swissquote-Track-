import type { Address } from 'viem'
import { baseSepolia } from 'viem/chains'

export const chain = baseSepolia

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://sepolia.base.org'

// Circle's official test USDC on Base Sepolia (6 decimals)
export const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export const EXPLORER = 'https://sepolia.basescan.org'
export const ETH_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet'
export const USDC_FAUCET = 'https://faucet.circle.com'

// MPC wallet services (run locally with `npm run share` and `npm run hub` in services/).
export const SHARE_URL = import.meta.env.VITE_SHARE_URL || 'http://localhost:8790'
export const HUB_URL = import.meta.env.VITE_HUB_URL || 'http://localhost:8787'

// Bitcoin testnet4 via mempool.space (balances, UTXOs, broadcasting).
export const MEMPOOL_API = import.meta.env.VITE_MEMPOOL_API || 'https://mempool.space/testnet4/api'
export const BTC_EXPLORER = MEMPOOL_API.replace(/\/api$/, '')
export const BTC_FAUCET = 'https://mempool.space/testnet4/faucet'
