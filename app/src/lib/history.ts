import type { Address, Hash } from 'viem'
import type { Token } from '../wallet'

export type Transfer = { hash: Hash; token: Token; amount: string; to: string; at: number }

// One list per wallet, so a newly created wallet does not inherit an old wallet's activity.
const key = (address: Address) => `sq-wallet:history:${address.toLowerCase()}`

export function loadHistory(address: Address): Transfer[] {
  try {
    return JSON.parse(localStorage.getItem(key(address)) ?? '[]') as Transfer[]
  } catch {
    return []
  }
}

export function saveHistory(address: Address, history: Transfer[]) {
  try {
    localStorage.setItem(key(address), JSON.stringify(history.slice(0, 30)))
  } catch {
    // Storage full or blocked: activity is a convenience, the blockchain is the source of truth.
  }
}
