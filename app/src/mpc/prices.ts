// Indicative CHF prices from CoinGecko. Testnet coins have no real value; the app shows these
// mainnet prices, clearly labelled, so the wallet reads like a real portfolio.
import type { Asset } from './chains'

export type Prices = Record<Asset, number>

const KEY = 'sq-mpc:prices'
const IDS: Record<Asset, string> = { BTC: 'bitcoin', ETH: 'ethereum', USDC: 'usd-coin' }

export function cachedPrices(): Prices | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw).prices as Prices) : null
  } catch {
    return null
  }
}

export async function fetchPrices(): Promise<Prices | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(IDS).join(',')}&vs_currencies=chf`
    const data = (await (await fetch(url)).json()) as Record<string, { chf: number }>
    const prices = { BTC: data.bitcoin.chf, ETH: data.ethereum.chf, USDC: data['usd-coin'].chf }
    try {
      localStorage.setItem(KEY, JSON.stringify({ prices, at: Date.now() }))
    } catch {
      // Cache is optional.
    }
    return prices
  } catch {
    return cachedPrices() // rate-limited or offline: last known prices, or none
  }
}

export const formatChf = (value: number) =>
  value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
