import type { Address } from 'viem'
import { baseSepolia } from 'viem/chains'

export const chain = baseSepolia

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://sepolia.base.org'
export const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL || 'https://public.pimlico.io/v2/84532/rpc'
export const PAYMASTER_URL = import.meta.env.VITE_PAYMASTER_URL || ''
export const GASLESS = PAYMASTER_URL !== ''

// Guardian recovery (contracts/src/RecoveryModule.sol). CREATE2-deployed: same address on every chain.
export const RECOVERY_MODULE: Address = import.meta.env.VITE_RECOVERY_MODULE || '0x1F039424e76238D89FC2EC7A1061F19AABf89d98'
// Seconds the client has to cancel a recovery. 72 h in production; short so the demo fits on stage.
export const RECOVERY_DELAY = Number(import.meta.env.VITE_RECOVERY_DELAY || 60)
// MOCK Swissquote guardian service (backend/guardian), a separate process with its own key.
export const GUARDIAN_URL = import.meta.env.VITE_GUARDIAN_URL || 'http://localhost:8787'

// Circle's official test USDC on Base Sepolia (6 decimals)
export const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export const EXPLORER = 'https://sepolia.basescan.org'
export const ETH_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet'
export const USDC_FAUCET = 'https://faucet.circle.com'
