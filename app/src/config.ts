import type { Address } from 'viem'
import { baseSepolia } from 'viem/chains'

export const chain = baseSepolia

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://sepolia.base.org'
export const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL || 'https://public.pimlico.io/v2/84532/rpc'
export const PAYMASTER_URL = import.meta.env.VITE_PAYMASTER_URL || ''
export const GASLESS = PAYMASTER_URL !== ''

// Circle's official test USDC on Base Sepolia (6 decimals)
export const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export const EXPLORER = 'https://sepolia.basescan.org'
export const ETH_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet'
export const USDC_FAUCET = 'https://faucet.circle.com'
