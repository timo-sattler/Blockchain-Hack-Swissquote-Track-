import { useCallback, useEffect, useRef, useState } from 'react'
import { createPublicClient, formatUnits, http, isAddress, parseAbiItem, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { BTC_EXPLORER, HUB_URL, MEMPOOL_API, RPC_URL, SHARE_URL, USDC } from '../config'

/** Key-share holders: A = client phone, B = Swissquote share service, C = recovery kit. */
export type Party = 'A' | 'B' | 'C'
export type Chain = 'bitcoin' | 'base'

/** Events the services and the wallet app publish through the event hub (services/hub.mjs). */
export type WalletEvent =
  | { type: 'wallet_created'; btcAddress: string; evmAddress: string; name?: string }
  | { type: 'signing'; parties: Party[]; name?: string; evm?: string }
  | { type: 'tx_broadcast'; chain: Chain; hash: string; amount: string; asset: string; from?: string; to?: string }
  | { type: 'service_offline' }
  | { type: 'service_online' }
  | { type: 'recovery_requested'; by: 'client' | 'attacker'; name?: string; evm?: string }
  | { type: 'recovery_refused'; reason: string; name?: string; evm?: string }
  | { type: 'recovery_completed'; name?: string; evm?: string }
  | { type: 'device_paired'; name?: string; evm?: string }
  | { type: 'funded'; name?: string; to: string; usdc: string; eth: string; hash: string }

/** `service` = reported by the hub, `chain` = found directly on the blockchain. */
export type FeedItem = WalletEvent & { id: string; at: number; source: 'service' | 'chain' }

/** A client wallet from the share service's directory. */
export type Member = { walletId: string; name: string; evmAddress: string; btcAddress: string; createdAt: number }

export type Treasury = { address: string; usdc: string; eth: string; walletsFundable: number }

/** Connection to the event hub (the share service's health arrives as events). */
export type ServiceStatus = 'connected' | 'offline'

const EVENTS_URL = `${HUB_URL}/events`
export const EVM_EXPLORER = 'https://sepolia.basescan.org'
const MAX_WATCHED = 24 // keeps the public explorer APIs within their rate limits

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

/** Everything the live dashboard shows: events, wallets, treasury and the services' health. */
export function useLiveData() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [status, setStatus] = useState<ServiceStatus>('offline')
  const [shareOnline, setShareOnline] = useState<boolean | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [treasury, setTreasury] = useState<Treasury | null>(null)
  const resetAt = useRef(0)

  const push = useCallback((event: WalletEvent, source: FeedItem['source'], at: number, id: string) => {
    if (at < resetAt.current) return
    setItems((current) => {
      const duplicate = current.some((i) => i.id === id || (event.type === 'tx_broadcast' && i.type === 'tx_broadcast' && i.hash === event.hash))
      return duplicate ? current : [{ ...event, id, at, source }, ...current].sort((a, b) => b.at - a.at).slice(0, 80)
    })
    if (event.type === 'service_offline' || event.type === 'service_online') setShareOnline(event.type === 'service_online')
  }, [])

  // Event hub: first the current state and history, then every event as it happens.
  // Some tunnels buffer server-sent events; if no state arrives within 3 s, poll the hub instead.
  useEffect(() => {
    type HubState = { shareOnline: boolean | null; history: (WalletEvent & { id: string; at: number })[]; resetAt?: number }
    let streaming = false
    let pollTimer: number | undefined

    const applyState = (state: HubState, replace: boolean) => {
      setShareOnline(state.shareOnline)
      if (state.resetAt && state.resetAt > resetAt.current) {
        resetAt.current = state.resetAt
        setItems((current) => current.filter((i) => i.at >= resetAt.current))
      }
      if (replace) setItems((current) => current.filter((i) => i.source !== 'service'))
      for (const entry of state.history) push(entry, 'service', entry.at, entry.id)
    }

    const source = new EventSource(EVENTS_URL)
    source.onopen = () => setStatus('connected')
    source.onerror = () => !pollTimer && setStatus('offline')
    source.addEventListener('state', (message) => {
      streaming = true
      setStatus('connected')
      applyState(JSON.parse((message as MessageEvent).data), true)
    })
    source.onmessage = (message) => {
      try {
        const entry = JSON.parse(message.data) as WalletEvent & { id: string; at: number }
        push(entry, 'service', entry.at, entry.id)
      } catch {
        // Ignore malformed lines.
      }
    }

    const fallback = window.setTimeout(() => {
      if (streaming) return
      source.close()
      const poll = async () => {
        try {
          const response = await fetch(`${HUB_URL}/state`, { cache: 'no-store' })
          applyState((await response.json()) as HubState, false)
          setStatus('connected')
        } catch {
          setStatus('offline')
        }
      }
      poll()
      pollTimer = window.setInterval(poll, 1000)
    }, 3000)

    return () => {
      source.close()
      window.clearTimeout(fallback)
      window.clearInterval(pollTimer)
    }
  }, [push])

  // Wallet directory and treasury from the share service (kept as-is while it is offline).
  useEffect(() => {
    const load = async () => {
      try {
        const [list, t] = await Promise.all([
          fetch(`${SHARE_URL}/wallets`).then((r) => r.json() as Promise<Member[]>),
          fetch(`${SHARE_URL}/treasury`).then((r) => (r.ok ? (r.json() as Promise<Treasury>) : null)),
        ])
        setMembers((current) => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
        setTreasury(t)
      } catch {
        // Share service offline.
      }
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => window.clearInterval(timer)
  }, [])

  // Transfers found directly on the chains, so the dashboard does not depend on our own services.
  useEffect(() => {
    const watched = members.slice(-MAX_WATCHED)
    if (watched.length === 0) return
    let stopped = false
    const poll = async () => {
      const found = await Promise.allSettled(watched.flatMap((m) => [baseTransfers(m.evmAddress), bitcoinTransfers(m.btcAddress)]))
      if (stopped) return
      for (const result of found) {
        if (result.status !== 'fulfilled') continue
        for (const tx of result.value) push(tx.event, 'chain', tx.at, `chain-${tx.event.hash}`)
      }
    }
    poll()
    const timer = window.setInterval(poll, 15_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [members, push])

  /** Clears the activity and the payment arrows for every viewer (wallets stay). */
  const reset = useCallback(async () => {
    await fetch(`${HUB_URL}/reset`, { method: 'POST' })
    resetAt.current = Date.now()
    setItems([])
  }, [])

  return { items, status, shareOnline, members, treasury, reset }
}

type ChainTx = { event: Extract<WalletEvent, { type: 'tx_broadcast' }>; at: number }

async function baseTransfers(address: string): Promise<ChainTx[]> {
  if (!isAddress(address)) return []
  const latest = await publicClient.getBlockNumber()
  const fromBlock = latest > 199n ? latest - 199n : 0n // the public RPC allows 200 blocks (~7 min on Base) per query
  const logs = await publicClient.getLogs({ address: USDC, event: transferEvent, args: { from: address as Address }, fromBlock })
  return logs.map((log) => ({
    event: {
      type: 'tx_broadcast',
      chain: 'base',
      hash: log.transactionHash,
      amount: formatUnits(log.args.value ?? 0n, 6),
      asset: 'USDC',
      from: address,
      to: log.args.to,
    },
    at: Date.now() - Number(latest - log.blockNumber) * 2000,
  }))
}

type MempoolTx = {
  txid: string
  status: { confirmed: boolean; block_time?: number }
  vin: { prevout?: { scriptpubkey_address?: string } }[]
  vout: { scriptpubkey_address?: string; value: number }[]
}

async function bitcoinTransfers(address: string): Promise<ChainTx[]> {
  if (!address.startsWith('tb1')) return []
  const response = await fetch(`${MEMPOOL_API}/address/${address}/txs`)
  if (!response.ok) return []
  const txs = (await response.json()) as MempoolTx[]
  return txs
    .filter((tx) => tx.vin.some((input) => input.prevout?.scriptpubkey_address === address)) // outgoing only
    .map((tx) => {
      const outputs = tx.vout.filter((o) => o.scriptpubkey_address !== address)
      const sent = outputs.reduce((sum, o) => sum + o.value, 0)
      return {
        event: { type: 'tx_broadcast', chain: 'bitcoin', hash: tx.txid, amount: (sent / 1e8).toString(), asset: 'BTC', from: address, to: outputs[0]?.scriptpubkey_address },
        at: tx.status.block_time ? tx.status.block_time * 1000 : Date.now(),
      }
    })
}

export const explorerUrl = (chain: Chain, hash: string) => (chain === 'base' ? `${EVM_EXPLORER}/tx/${hash}` : `${BTC_EXPLORER}/tx/${hash}`)
