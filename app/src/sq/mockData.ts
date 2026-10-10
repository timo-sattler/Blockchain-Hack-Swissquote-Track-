// All figures on the Swissquote tabs are mock data for the prototype. Only the Crypto tab's
// self-custody wallet talks to a real blockchain.

export const CLIENT = { name: 'Anna Muster', tradingAccount: '2162953' }

export const PORTFOLIO = {
  totalValue: 55051.67,
  trading: 55050.01,
  dailyChange: 1.65,
  dailyChangePct: 1.18,
  absolutePerformance: 128.65,
  tiles: { assets: 12000, crypto: 10150.01, cash: 31000, buyingPower: 1000 },
}

export type Period = '1W' | '1M' | '6M' | '1Y' | 'All'

// Normalised portfolio curve per period (0 = lowest, 1 = highest point of the chart).
export const PERFORMANCE: Record<Period, number[]> = {
  '1W': [0.05, 0.32, 0.55, 0.5, 0.47, 0.44, 0.62, 0.85, 1],
  '1M': [0.3, 0.22, 0.4, 0.35, 0.18, 0.28, 0.5, 0.46, 0.66, 0.6, 0.8, 1],
  '6M': [0.1, 0.25, 0.2, 0.45, 0.38, 0.6, 0.52, 0.7, 0.66, 0.9, 0.84, 1],
  '1Y': [0.4, 0.3, 0.15, 0.2, 0.05, 0.25, 0.45, 0.4, 0.62, 0.7, 0.86, 1],
  All: [0, 0.08, 0.15, 0.12, 0.3, 0.42, 0.38, 0.55, 0.7, 0.66, 0.85, 1],
}

export type Quote = { symbol: string; name: string; price: number; currency: string; changePct: number; flag?: boolean }

export const MARKETS: Record<'Shares' | 'Crypto' | 'Indices' | 'Components', Quote[]> = {
  Components: [
    { symbol: 'SMI', name: 'SMI® PR', price: 11681.44, currency: 'CHF', changePct: 0.34, flag: true },
    { symbol: 'SCMN', name: 'SWISSCOM N', price: 503.0, currency: 'CHF', changePct: -0.2 },
    { symbol: 'GIVN', name: 'GIVAUDAN N', price: 4000.0, currency: 'CHF', changePct: 0.7 },
    { symbol: 'ZURN', name: 'ZURICH INSURANCE N', price: 550.0, currency: 'CHF', changePct: 0.18 },
    { symbol: 'NOVN', name: 'NOVARTIS N', price: 88.56, currency: 'CHF', changePct: -0.23 },
    { symbol: 'ROG', name: 'ROCHE GS', price: 256.0, currency: 'CHF', changePct: 0.87 },
    { symbol: 'HOLN', name: 'HOLCIM N', price: 88.5, currency: 'CHF', changePct: -0.29 },
    { symbol: 'ABBN', name: 'ABB LTD N', price: 51.56, currency: 'CHF', changePct: 0.55 },
    { symbol: 'UBSG', name: 'UBS GROUP N', price: 27.12, currency: 'CHF', changePct: -0.41 },
  ],
  Shares: [
    { symbol: 'AAPL', name: 'APPLE INC', price: 227.48, currency: 'USD', changePct: 0.62 },
    { symbol: 'TSLA', name: 'TESLA INC', price: 241.05, currency: 'USD', changePct: -1.84 },
    { symbol: 'NESN', name: 'NESTLE N', price: 86.4, currency: 'CHF', changePct: 0.12 },
    { symbol: 'NVDA', name: 'NVIDIA CORP', price: 132.9, currency: 'USD', changePct: 2.31 },
    { symbol: 'LOGN', name: 'LOGITECH N', price: 74.22, currency: 'CHF', changePct: -0.37 },
  ],
  Crypto: [
    { symbol: 'BTC', name: 'BITCOIN', price: 59240.0, currency: 'CHF', changePct: 1.42 },
    { symbol: 'ETH', name: 'ETHEREUM', price: 2310.5, currency: 'CHF', changePct: 0.88 },
    { symbol: 'USDC', name: 'USD COIN', price: 0.86, currency: 'CHF', changePct: 0.01 },
    { symbol: 'SOL', name: 'SOLANA', price: 128.7, currency: 'CHF', changePct: -2.05 },
  ],
  Indices: [
    { symbol: 'SMI', name: 'SMI® PR', price: 11681.44, currency: 'CHF', changePct: 0.34, flag: true },
    { symbol: 'SPX', name: 'S&P 500', price: 5751.07, currency: 'USD', changePct: 0.41 },
    { symbol: 'DAX', name: 'DAX PERFORMANCE', price: 19120.93, currency: 'EUR', changePct: -0.15 },
    { symbol: 'NDX', name: 'NASDAQ 100', price: 20033.1, currency: 'USD', changePct: 0.67 },
  ],
}

export const CARD = { last4: '1234', available: 8522.59 }

export const CARD_TRANSACTIONS = [
  { merchant: 'SBB CFF', amount: -5.6, status: 'Pending', icon: 'train' },
  { merchant: 'Galaxus.ch', amount: -111.0, status: 'Pending', icon: 'basket' },
  { merchant: 'Hotel Geneva Center', amount: -500.0, status: 'Executed', icon: 'hotel' },
  { merchant: 'Migros Lausanne', amount: -42.35, status: 'Executed', icon: 'basket' },
] as const

export const PLANS = [
  { name: 'Global ETF savings plan', detail: 'CHF 250 every month', next: 'Next: 1 Nov', progress: 0.62 },
  { name: 'Pillar 3a', detail: 'CHF 7’258 yearly maximum', next: 'CHF 4’500 paid in', progress: 0.62 },
]

export const formatChf = (value: number, digits = 2) =>
  value.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
