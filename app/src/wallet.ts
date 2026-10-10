import { createPublicClient, http } from 'viem'
import { chain, RPC_URL } from './config'

/** Read-only client for Base Sepolia: balances, nonces, fees and broadcasting. */
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
