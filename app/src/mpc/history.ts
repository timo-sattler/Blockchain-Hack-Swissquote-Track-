// Wallet activity read from public explorers (Blockscout for Base Sepolia, mempool.space for Bitcoin),
// so incoming payments, faucet top-ups and the welcome bonus show up too, not only what this device sent.
import { formatEther, formatUnits } from 'viem'
import { MEMPOOL_API, SHARE_URL, USDC } from '../config'
import type { Asset } from './chains'
import type { PhoneWallet } from './store'

const BLOCKSCOUT = 'https://base-sepolia.blockscout.com/api/v2'

export type ActivityItem = {
  hash: string
  chain: 'base' | 'bitcoin'
  asset: Asset
  direction: 'in' | 'out'
  amount: string
  counterparty: string // address
  label: string // "Maxi", "Swissquote welcome bonus", or a short address
  at: number
}

type Directory = Map<string, string>

/** Names for known addresses: other clients' wallets and the Swissquote treasury. */
async function directory(): Promise<Directory> {
  const names: Directory = new Map()
  const [wallets, treasury] = await Promise.all([
    fetch(`${SHARE_URL}/wallets`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${SHARE_URL}/treasury`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])
  for (const w of wallets as { name: string; evmAddress: string; btcAddress: string }[]) {
    names.set(w.evmAddress.toLowerCase(), w.name)
    names.set(w.btcAddress.toLowerCase(), w.name)
  }
  if (treasury?.address) names.set(treasury.address.toLowerCase(), 'Swissquote welcome bonus')
  return names
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const labelFor = (names: Directory, address: string) => names.get(address.toLowerCase()) ?? short(address)

type BlockscoutAddress = { hash: string }
type TokenTransfer = { transaction_hash: string; timestamp: string; from: BlockscoutAddress; to: BlockscoutAddress; token: { address_hash?: string; address?: string }; total: { value: string; decimals: string } }
type BlockscoutTx = { hash: string; timestamp: string; from: BlockscoutAddress; to: BlockscoutAddress | null; value: string; status: string }

async function baseActivity(address: string, names: Directory): Promise<ActivityItem[]> {
  const own = address.toLowerCase()
  const [tokens, txs] = await Promise.all([
    fetch(`${BLOCKSCOUT}/addresses/${address}/token-transfers?type=ERC-20`).then((r) => (r.ok ? r.json() : { items: [] })),
    fetch(`${BLOCKSCOUT}/addresses/${address}/transactions`).then((r) => (r.ok ? r.json() : { items: [] })),
  ])
  const items: ActivityItem[] = []
  for (const t of (tokens.items ?? []) as TokenTransfer[]) {
    const token = (t.token.address_hash ?? t.token.address ?? '').toLowerCase()
    if (token !== USDC.toLowerCase()) continue
    const incoming = t.to.hash.toLowerCase() === own
    const other = incoming ? t.from.hash : t.to.hash
    items.push({
      hash: t.transaction_hash,
      chain: 'base',
      asset: 'USDC',
      direction: incoming ? 'in' : 'out',
      amount: formatUnits(BigInt(t.total.value), Number(t.total.decimals)),
      counterparty: other,
      label: labelFor(names, other),
      at: Date.parse(t.timestamp),
    })
  }
  for (const tx of (txs.items ?? []) as BlockscoutTx[]) {
    if (tx.status !== 'ok' || !tx.to || BigInt(tx.value) === 0n) continue
    const incoming = tx.to.hash.toLowerCase() === own
    const other = incoming ? tx.from.hash : tx.to.hash
    items.push({
      hash: tx.hash,
      chain: 'base',
      asset: 'ETH',
      direction: incoming ? 'in' : 'out',
      amount: formatEther(BigInt(tx.value)),
      counterparty: other,
      label: labelFor(names, other),
      at: Date.parse(tx.timestamp),
    })
  }
  return items
}

type MempoolTx = {
  txid: string
  status: { block_time?: number }
  vin: { prevout?: { scriptpubkey_address?: string; value: number } }[]
  vout: { scriptpubkey_address?: string; value: number }[]
}

async function bitcoinActivity(address: string, names: Directory): Promise<ActivityItem[]> {
  const response = await fetch(`${MEMPOOL_API}/address/${address}/txs`)
  if (!response.ok) return []
  const txs = (await response.json()) as MempoolTx[]
  return txs.map((tx) => {
    const spent = tx.vin.filter((i) => i.prevout?.scriptpubkey_address === address).reduce((s, i) => s + (i.prevout?.value ?? 0), 0)
    const received = tx.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0)
    const outgoing = spent > 0
    const other = outgoing
      ? (tx.vout.find((o) => o.scriptpubkey_address !== address)?.scriptpubkey_address ?? '')
      : (tx.vin[0]?.prevout?.scriptpubkey_address ?? '')
    const sats = outgoing ? spent - received : received
    return {
      hash: tx.txid,
      chain: 'bitcoin' as const,
      asset: 'BTC' as const,
      direction: outgoing ? ('out' as const) : ('in' as const),
      amount: (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
      counterparty: other,
      label: other ? labelFor(names, other) : 'Bitcoin network',
      at: tx.status.block_time ? tx.status.block_time * 1000 : Date.now(),
    }
  })
}

/** Everything that moved in or out of the wallet, newest first. */
export async function loadActivity(wallet: PhoneWallet): Promise<ActivityItem[]> {
  const names = await directory()
  const results = await Promise.allSettled([baseActivity(wallet.evmAddress, names), bitcoinActivity(wallet.btcAddress, names)])
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  return items.sort((a, b) => b.at - a.at).slice(0, 40)
}
