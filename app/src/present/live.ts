import { useCallback, useEffect, useRef, useState } from 'react'
import { createPublicClient, formatUnits, http, isAddress, parseAbiItem, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { BTC_EXPLORER, HUB_URL, MEMPOOL_API, RPC_URL, USDC } from '../config'

/** Key-share holders: A = client phone, B = Swissquote share service, C = recovery kit. */
export type Party = 'A' | 'B' | 'C'
export type Chain = 'bitcoin' | 'base'

/**
 * Events the services and the wallet app publish through the event hub (services/hub.mjs).
 * The service emits exactly these JSON objects, one per `data:` line.
 */
export type WalletEvent =
  | { type: 'wallet_created'; btcAddress: string; evmAddress: string }
  | { type: 'signing'; parties: Party[] }
  | { type: 'tx_broadcast'; chain: Chain; hash: string; amount: string; asset: string }
  | { type: 'service_offline' }
  | { type: 'service_online' }
  | { type: 'recovery_requested'; by: 'client' | 'attacker' }
  | { type: 'recovery_refused'; reason: string }
  | { type: 'recovery_completed' }

export type FeedItem = WalletEvent & { id: string; at: number; source: 'service' | 'chain' | 'simulated' }

/** Connection to the event hub (not the share service: its health arrives as events). */
export type ServiceStatus = 'connected' | 'offline'

const EVENTS_URL = import.meta.env.VITE_EVENTS_URL || `${HUB_URL}/events`
export const EVM_EXPLORER = 'https://sepolia.basescan.org'

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

// Scripted run for rehearsals and as a fallback when the venue Wi-Fi fails. Always labelled as simulated.
const SCRIPT: { delay: number; event: WalletEvent }[] = [
  { delay: 0, event: { type: 'wallet_created', btcAddress: 'tb1qvspd68u7ag9dsc6avpth75k3uakqez6qz7rhrl', evmAddress: '0x953Df09FeA8f51A93583B2B71a7847318eD44810' } },
  { delay: 3500, event: { type: 'signing', parties: ['A', 'B'] } },
  { delay: 1800, event: { type: 'tx_broadcast', chain: 'base', hash: 'simulated', amount: '20', asset: 'USDC' } },
  { delay: 3500, event: { type: 'signing', parties: ['A', 'B'] } },
  { delay: 1800, event: { type: 'tx_broadcast', chain: 'bitcoin', hash: 'simulated', amount: '0.0005', asset: 'BTC' } },
  { delay: 3500, event: { type: 'service_offline' } },
  { delay: 2500, event: { type: 'signing', parties: ['A', 'C'] } },
  { delay: 1800, event: { type: 'tx_broadcast', chain: 'base', hash: 'simulated', amount: '5', asset: 'USDC' } },
  { delay: 3000, event: { type: 'service_online' } },
  { delay: 2500, event: { type: 'recovery_requested', by: 'attacker' } },
  { delay: 2500, event: { type: 'recovery_refused', reason: 'Liveness selfie does not match the KYC profile' } },
  { delay: 3500, event: { type: 'recovery_requested', by: 'client' } },
  { delay: 3000, event: { type: 'recovery_completed' } },
]

let counter = 0
const nextId = () => `${Date.now()}-${counter++}`

/** Live feed: share-service events, on-chain transfers of the known wallets, and the optional simulation. */
export function useLiveFeed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [status, setStatus] = useState<ServiceStatus>('offline')
  const [shareOnline, setShareOnline] = useState<boolean | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [wallet, setWallet] = useState<{ btc: string; evm: string } | null>(initialWallet)
  const timers = useRef<number[]>([])

  const push = useCallback((event: WalletEvent, source: FeedItem['source'], at = Date.now(), id = nextId()) => {
    setItems((current) => {
      const duplicate = current.some(
        (i) => i.id === id || (event.type === 'tx_broadcast' && i.type === 'tx_broadcast' && i.hash === event.hash && i.source !== 'simulated'),
      )
      return duplicate ? current : [{ ...event, id, at, source }, ...current].sort((a, b) => b.at - a.at).slice(0, 60)
    })
    if (event.type === 'wallet_created' && source !== 'simulated') setWallet({ btc: event.btcAddress, evm: event.evmAddress })
    if (event.type === 'service_offline' || event.type === 'service_online') setShareOnline(event.type === 'service_online')
  }, [])

  // Event hub stream: first the current state and history, then every event as it happens.
  useEffect(() => {
    const source = new EventSource(EVENTS_URL)
    source.onopen = () => setStatus('connected')
    source.onerror = () => setStatus('offline')
    source.addEventListener('state', (message) => {
      const state = JSON.parse((message as MessageEvent).data) as { shareOnline: boolean | null; history: (WalletEvent & { id: string; at: number })[] }
      setShareOnline(state.shareOnline)
      setItems((current) => current.filter((i) => i.source !== 'service'))
      for (const entry of state.history) push(entry, 'service', entry.at, entry.id)
    })
    source.onmessage = (message) => {
      try {
        const entry = JSON.parse(message.data) as WalletEvent & { id: string; at: number }
        push(entry, 'service', entry.at, entry.id)
      } catch {
        // Ignore malformed lines.
      }
    }
    return () => source.close()
  }, [push])

  // On-chain transfers, read straight from the chains so they don't depend on our own services.
  useEffect(() => {
    if (!wallet) return
    let stopped = false
    const poll = async () => {
      const found = await Promise.allSettled([baseTransfers(wallet.evm), bitcoinTransfers(wallet.btc)])
      if (stopped) return
      for (const result of found) {
        if (result.status !== 'fulfilled') continue
        for (const tx of result.value) push(tx.event, 'chain', tx.at, `chain-${tx.event.hash}`)
      }
    }
    poll()
    const timer = window.setInterval(poll, 10_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [wallet, push])

  const simulate = useCallback(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setSimulating(true)
    let elapsed = 0
    for (const step of SCRIPT) {
      elapsed += step.delay
      timers.current.push(window.setTimeout(() => push(step.event, 'simulated'), elapsed))
    }
    timers.current.push(window.setTimeout(() => setSimulating(false), elapsed + 1500))
  }, [push])

  const clear = useCallback(() => {
    timers.current.forEach(window.clearTimeout)
    setSimulating(false)
    setItems([])
  }, [])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  return { items, status, shareOnline, simulating, simulate, clear, wallet }
}

/** Wallet addresses can be passed in the URL (?evm=0x…&btc=tb1…) to watch an existing wallet. */
function initialWallet() {
  const params = new URLSearchParams(window.location.search)
  const evm = params.get('evm') ?? ''
  const btc = params.get('btc') ?? ''
  return evm || btc ? { evm, btc } : null
}

type ChainTx = { event: Extract<WalletEvent, { type: 'tx_broadcast' }>; at: number }

async function baseTransfers(address: string): Promise<ChainTx[]> {
  if (!isAddress(address)) return []
  const latest = await publicClient.getBlockNumber()
  const fromBlock = latest > 2000n ? latest - 2000n : 0n // roughly the last hour on Base
  const logs = await publicClient.getLogs({ address: USDC, event: transferEvent, args: { from: address as Address }, fromBlock })
  return logs.map((log) => ({
    event: { type: 'tx_broadcast', chain: 'base', hash: log.transactionHash, amount: formatUnits(log.args.value ?? 0n, 6), asset: 'USDC' },
    at: Date.now() - Number(latest - log.blockNumber) * 2000,
  }))
}

type MempoolTx = { txid: string; status: { confirmed: boolean; block_time?: number }; vin: { prevout?: { scriptpubkey_address?: string } }[]; vout: { scriptpubkey_address?: string; value: number }[] }

async function bitcoinTransfers(address: string): Promise<ChainTx[]> {
  if (!address.startsWith('tb1')) return []
  const response = await fetch(`${MEMPOOL_API}/address/${address}/txs`)
  if (!response.ok) return []
  const txs = (await response.json()) as MempoolTx[]
  return txs
    .filter((tx) => tx.vin.some((input) => input.prevout?.scriptpubkey_address === address)) // outgoing only
    .map((tx) => {
      const sent = tx.vout.filter((o) => o.scriptpubkey_address !== address).reduce((sum, o) => sum + o.value, 0)
      return {
        event: { type: 'tx_broadcast', chain: 'bitcoin', hash: tx.txid, amount: (sent / 1e8).toString(), asset: 'BTC' },
        at: tx.status.block_time ? tx.status.block_time * 1000 : Date.now(),
      }
    })
}

export const explorerUrl = (chain: Chain, hash: string) =>
  chain === 'base' ? `${EVM_EXPLORER}/tx/${hash}` : `${BTC_EXPLORER}/tx/${hash}`

