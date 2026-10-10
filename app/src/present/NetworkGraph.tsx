import { useEffect, useMemo, useRef, useState } from 'react'
import { erc20Abi, formatEther, formatUnits, type Address } from 'viem'
import { SHARE_URL, USDC } from '../config'
import { publicClient } from '../wallet'
import type { FeedItem } from './live'

type Member = { walletId: string; name: string; evmAddress: string; btcAddress: string; createdAt: number }
type Balance = { usdc: bigint; eth: bigint }
type Treasury = { address: string; usdc: string; eth: string; walletsFundable: number }

const W = 1000
const H = 600
const CENTER = { x: W / 2, y: H / 2 }
const FRESH_MS = 6000

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const getEthBalanceAbi = [
  { type: 'function', name: 'getEthBalance', stateMutability: 'view', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

/** Every client wallet as a node around Swissquote; every payment as an arrow from sender to recipient. */
export function NetworkGraph({ items }: { items: FeedItem[] }) {
  const [members, setMembers] = useState<Member[]>([])
  const [balances, setBalances] = useState<Record<string, Balance>>({})
  const [treasury, setTreasury] = useState<Treasury | null>(null)
  const [now, setNow] = useState(Date.now())
  const firstSeen = useRef(new Map<string, number>())
  const loadedOnce = useRef(false)

  // Directory of wallets from the share service.
  useEffect(() => {
    const load = async () => {
      try {
        const [list, t] = await Promise.all([
          fetch(`${SHARE_URL}/wallets`).then((r) => r.json() as Promise<Member[]>),
          fetch(`${SHARE_URL}/treasury`).then((r) => (r.ok ? (r.json() as Promise<Treasury>) : null)),
        ])
        // Wallets that exist when the slide opens appear calmly; later ones pop in.
        for (const m of list) if (!firstSeen.current.has(m.walletId)) firstSeen.current.set(m.walletId, loadedOnce.current ? Date.now() : 0)
        loadedOnce.current = true
        setMembers(list.slice(-24))
        setTreasury(t)
      } catch {
        // Share service offline: keep the last known picture.
      }
    }
    load()
    const timer = window.setInterval(load, 3000)
    return () => window.clearInterval(timer)
  }, [])

  // Balances of all members in one multicall (USDC + ETH), refreshed regularly and right after payments.
  const paymentCount = items.filter((i) => i.type === 'tx_broadcast' || i.type === 'funded').length
  useEffect(() => {
    if (members.length === 0) return
    let cancelled = false
    const load = async () => {
      const addresses = members.map((m) => m.evmAddress as Address)
      try {
        const results = await publicClient.multicall({
          allowFailure: true,
          contracts: [
            ...addresses.map((a) => ({ address: USDC, abi: erc20Abi, functionName: 'balanceOf' as const, args: [a] as const })),
            ...addresses.map((a) => ({ address: MULTICALL3, abi: getEthBalanceAbi, functionName: 'getEthBalance' as const, args: [a] as const })),
          ],
        })
        if (cancelled) return
        const next: Record<string, Balance> = {}
        members.forEach((m, i) => {
          const usdc = results[i]
          const eth = results[i + members.length]
          next[m.walletId] = {
            usdc: usdc.status === 'success' ? (usdc.result as bigint) : 0n,
            eth: eth.status === 'success' ? (eth.result as bigint) : 0n,
          }
        })
        setBalances(next)
      } catch {
        // RPC hiccup: try again on the next tick.
      }
    }
    load()
    const soon = window.setTimeout(load, 4000) // payments land in a block within seconds
    const timer = window.setInterval(load, 10_000)
    return () => {
      cancelled = true
      window.clearTimeout(soon)
      window.clearInterval(timer)
    }
  }, [members, paymentCount])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  // Place members on an ellipse around Swissquote.
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    const n = members.length
    members.forEach((m, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2
      map.set(m.walletId, { x: CENTER.x + Math.cos(angle) * 390, y: CENTER.y + Math.sin(angle) * 225 })
    })
    return map
  }, [members])

  const byAddress = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) {
      map.set(m.evmAddress.toLowerCase(), m)
      map.set(m.btcAddress.toLowerCase(), m)
    }
    return map
  }, [members])

  // Arrows: payments between members, to outside addresses, and welcome bonuses from the treasury.
  type Arrow = { id: string; from: { x: number; y: number }; to: { x: number; y: number }; label: string; at: number; kind: 'payment' | 'bonus' | 'external' }
  const EXTERNAL = { x: W - 70, y: H - 40 }
  const arrows: Arrow[] = []
  for (const item of items.slice(0, 40)) {
    if (item.source === 'simulated') continue
    if (item.type === 'funded') {
      const to = byAddress.get(item.to.toLowerCase())
      const p = to && positions.get(to.walletId)
      if (p) arrows.push({ id: item.id, from: CENTER, to: p, label: `🎁 ${item.usdc} USDC`, at: item.at, kind: 'bonus' })
    }
    if (item.type === 'tx_broadcast' && item.from) {
      const sender = byAddress.get(item.from.toLowerCase())
      const recipient = item.to ? byAddress.get(item.to.toLowerCase()) : undefined
      const from = sender && positions.get(sender.walletId)
      if (!from) continue
      const to = recipient ? positions.get(recipient.walletId) : EXTERNAL
      if (to) arrows.push({ id: item.id, from, to, label: `${item.amount} ${item.asset}`, at: item.at, kind: recipient ? 'payment' : 'external' })
    }
  }
  const hasExternal = arrows.some((a) => a.kind === 'external')
  const compact = members.length > 12

  return (
    <svg className="network" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Live network of client wallets and payments">
      <defs>
        <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#c7ccd8" />
        </marker>
        <marker id="net-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#f05a2a" />
        </marker>
        <marker id="net-arrow-bonus" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#0b8f5c" />
        </marker>
      </defs>

      {[...arrows].reverse().map((a) => {
        const hot = now - a.at < FRESH_MS
        const mx = (a.from.x + a.to.x) / 2 + (a.to.y - a.from.y) * 0.15
        const my = (a.from.y + a.to.y) / 2 - (a.to.x - a.from.x) * 0.15
        const d = `M${a.from.x} ${a.from.y} Q${mx} ${my} ${a.to.x} ${a.to.y}`
        const marker = hot ? (a.kind === 'bonus' ? 'url(#net-arrow-bonus)' : 'url(#net-arrow-hot)') : 'url(#net-arrow)'
        return (
          <g key={a.id} className={`net-edge ${a.kind} ${hot ? 'hot' : ''}`}>
            <path d={d} markerEnd={marker} />
            {hot && (
              <text x={mx} y={my} className="net-edge-label">
                {a.label}
              </text>
            )}
          </g>
        )
      })}

      <g className="net-center">
        <circle cx={CENTER.x} cy={CENTER.y} r="68" />
        <text x={CENTER.x} y={CENTER.y - 10} className="net-center-title">
          Swissquote
        </text>
        <text x={CENTER.x} y={CENTER.y + 14} className="net-center-sub">
          co-signer · treasury
        </text>
        {treasury && (
          <text x={CENTER.x} y={CENTER.y + 36} className="net-center-sub">
            {Number(treasury.usdc).toFixed(0)} USDC left
          </text>
        )}
      </g>

      {hasExternal && (
        <g className="net-external">
          <rect x={EXTERNAL.x - 60} y={EXTERNAL.y - 22} width="120" height="44" rx="22" />
          <text x={EXTERNAL.x} y={EXTERNAL.y + 5}>
            Outside wallets
          </text>
        </g>
      )}

      {members.map((m) => {
        const p = positions.get(m.walletId)!
        const b = balances[m.walletId]
        const seen = firstSeen.current.get(m.walletId) ?? 0
        const fresh = now - seen < FRESH_MS
        const w = compact ? 140 : 172
        const h = compact ? 62 : 76
        return (
          <g key={m.walletId} className={`net-node ${fresh ? 'fresh' : ''}`} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
            <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx="16" />
            <text x={p.x} y={p.y - (compact ? 8 : 12)} className="net-name">
              {m.name.length > 16 ? `${m.name.slice(0, 15)}…` : m.name}
            </text>
            <text x={p.x} y={p.y + (compact ? 12 : 12)} className="net-usdc">
              {b ? `$${Number(formatUnits(b.usdc, 6)).toFixed(2)}` : '…'}
            </text>
            {!compact && (
              <text x={p.x} y={p.y + 30} className="net-eth">
                {b ? `${Number(formatEther(b.eth)).toFixed(5)} ETH` : ''}
              </text>
            )}
          </g>
        )
      })}

      {members.length === 0 && (
        <text x={CENTER.x} y={H - 40} className="net-empty">
          Waiting for the first wallet… scan the QR code to join.
        </text>
      )}
    </svg>
  )
}
