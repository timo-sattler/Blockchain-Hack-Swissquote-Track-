import { useEffect, useMemo, useRef, useState } from 'react'
import { erc20Abi, formatEther, formatUnits, type Address } from 'viem'
import { USDC } from '../config'
import { publicClient } from '../wallet'
import type { FeedItem, Member, Treasury } from './live'

type Balance = { usdc: bigint; eth: bigint }
type Point = { x: number; y: number }

const W = 1400
const H = 600
const CENTER = { x: W / 2, y: H / 2 }
const FRESH_MS = 6000

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const getEthBalanceAbi = [
  { type: 'function', name: 'getEthBalance', stateMutability: 'view', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

/**
 * Every client wallet around Swissquote, with who holds which key share: the client holds A (phone)
 * and C (recovery kit), Swissquote holds B for every wallet. Payments run as arrows between clients.
 */
export function NetworkGraph({ items, members: allMembers, treasury }: { items: FeedItem[]; members: Member[]; treasury: Treasury | null }) {
  const members = useMemo(() => allMembers.slice(-20), [allMembers])
  const [balances, setBalances] = useState<Record<string, Balance>>({})
  const [now, setNow] = useState(Date.now())
  const firstSeen = useRef(new Map<string, number>())
  const loadedOnce = useRef(false)

  // Wallets that exist when the page opens appear calmly; later ones pop in.
  useEffect(() => {
    for (const m of members) if (!firstSeen.current.has(m.walletId)) firstSeen.current.set(m.walletId, loadedOnce.current ? Date.now() : 0)
    if (members.length > 0) loadedOnce.current = true
  }, [members])

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

  const positions = useMemo(() => {
    const map = new Map<string, Point>()
    const n = members.length
    members.forEach((m, i) => {
      // Two wallets sit left and right; more are spread around the ring starting at the top.
      const angle = (n <= 2 ? Math.PI : -Math.PI / 2) + (i / Math.max(n, 1)) * Math.PI * 2
      map.set(m.walletId, { x: CENTER.x + Math.cos(angle) * (W * 0.36), y: CENTER.y + Math.sin(angle) * (H * 0.34) })
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

  // What is happening to each wallet right now.
  const fresh = items.filter((i) => now - i.at < FRESH_MS)
  const memberOf = (address?: string) => (address ? byAddress.get(address.toLowerCase()) : undefined)
  const activity = new Map<string, { kind: 'cosign' | 'kit' | 'attack' | 'recovered'; label: string }>()
  for (const item of [...fresh].reverse()) {
    if (item.type === 'signing') {
      const m = memberOf(item.evm)
      if (!m) continue
      const viaKit = !item.parties.includes('B')
      activity.set(m.walletId, viaKit ? { kind: 'kit', label: 'A + C sign · no Swissquote' } : { kind: 'cosign', label: 'A + B sign' })
    }
    if (item.type === 'recovery_refused' || (item.type === 'recovery_requested' && item.by === 'attacker')) {
      const m = memberOf(item.evm)
      if (m) activity.set(m.walletId, { kind: 'attack', label: 'Attack refused' })
    }
    if (item.type === 'pairing_requested') {
      const m = memberOf(item.evm)
      if (m) activity.set(m.walletId, { kind: 'recovered', label: 'New device · waiting (alerts sent)' })
    }
    if (item.type === 'recovery_completed' || item.type === 'device_paired') {
      const m = memberOf(item.evm)
      if (m) activity.set(m.walletId, { kind: 'recovered', label: 'New Share A issued (B + C)' })
    }
  }

  // Payment arrows between clients, to outside addresses, and welcome bonuses from the treasury.
  type Arrow = { id: string; from: Point; to: Point; label: string; at: number; kind: 'payment' | 'bonus' | 'external' }
  const EXTERNAL = { x: W - 100, y: H - 30 }
  const arrows: Arrow[] = []
  for (const item of items.slice(0, 40)) {
    if (item.type === 'funded') {
      const to = memberOf(item.to)
      const p = to && positions.get(to.walletId)
      if (p) arrows.push({ id: item.id, from: CENTER, to: p, label: `🎁 ${item.usdc} USDC`, at: item.at, kind: 'bonus' })
    }
    if (item.type === 'tx_broadcast' && item.from) {
      const sender = memberOf(item.from)
      const recipient = memberOf(item.to)
      const from = sender && positions.get(sender.walletId)
      if (!from) continue
      const to = recipient ? positions.get(recipient.walletId) : EXTERNAL
      if (to) arrows.push({ id: item.id, from, to, label: `${item.amount} ${item.asset}`, at: item.at, kind: recipient ? 'payment' : 'external' })
    }
  }
  const hasExternal = arrows.some((a) => a.kind === 'external')
  const compact = members.length > 10
  const nodeW = compact ? 200 : 250
  const nodeH = compact ? 96 : 118

  return (
    <svg className="network" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Client wallets, the key shares each party holds, and payments">
      <defs>
        {(
          [
            ['net-arrow', '#c7ccd8'],
            ['net-arrow-hot', '#f05a2a'],
            ['net-arrow-bonus', '#0b8f5c'],
          ] as const
        ).map(([id, color]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* Share B links: Swissquote holds one share of every wallet. */}
      {members.map((m) => {
        const p = positions.get(m.walletId)!
        const state = activity.get(m.walletId)
        const hot = state?.kind === 'cosign' || state?.kind === 'recovered'
        const bx = CENTER.x + (p.x - CENTER.x) * 0.3
        const by = CENTER.y + (p.y - CENTER.y) * 0.3
        return (
          <g key={`b-${m.walletId}`} className={`net-share-link ${hot ? 'hot' : ''} ${state?.kind === 'attack' ? 'attack' : ''}`}>
            <line x1={CENTER.x} y1={CENTER.y} x2={p.x} y2={p.y} />
            <circle cx={bx} cy={by} r="15" className="share b" />
            <text x={bx} y={by + 5} className="share-letter">
              B
            </text>
          </g>
        )
      })}

      {[...arrows].reverse().map((a) => {
        const hot = now - a.at < FRESH_MS
        // Bend arrows away from the centre so they never run through Swissquote.
        const mx = (a.from.x + a.to.x) / 2 + (a.to.y - a.from.y) * 0.32
        const my = (a.from.y + a.to.y) / 2 - (a.to.x - a.from.x) * 0.32
        const marker = hot ? (a.kind === 'bonus' ? 'url(#net-arrow-bonus)' : 'url(#net-arrow-hot)') : 'url(#net-arrow)'
        return (
          <g key={a.id} className={`net-edge ${a.kind} ${hot ? 'hot' : ''}`}>
            <path d={`M${a.from.x} ${a.from.y} Q${mx} ${my} ${a.to.x} ${a.to.y}`} markerEnd={marker} />
            {hot && (
              <text x={mx} y={my} className="net-edge-label">
                {a.label}
              </text>
            )}
          </g>
        )
      })}

      <g className="net-center">
        <circle cx={CENTER.x} cy={CENTER.y} r="96" />
        <text x={CENTER.x} y={CENTER.y - 26} className="net-center-title">
          Swissquote
        </text>
        <text x={CENTER.x} y={CENTER.y + 2} className="net-center-sub">
          holds Share B of
        </text>
        <text x={CENTER.x} y={CENTER.y + 24} className="net-center-sub">
          {members.length} {members.length === 1 ? 'wallet' : 'wallets'} · never alone
        </text>
        {treasury && (
          <text x={CENTER.x} y={CENTER.y + 52} className="net-center-sub">
            Treasury {Number(treasury.usdc).toFixed(0)} USDC
          </text>
        )}
      </g>

      {hasExternal && (
        <g className="net-external">
          <rect x={EXTERNAL.x - 70} y={EXTERNAL.y - 22} width="140" height="44" rx="22" />
          <text x={EXTERNAL.x} y={EXTERNAL.y + 6}>
            Outside wallets
          </text>
        </g>
      )}

      {members.map((m) => {
        const p = positions.get(m.walletId)!
        const b = balances[m.walletId]
        const seen = firstSeen.current.get(m.walletId) ?? 0
        const state = activity.get(m.walletId)
        const isNew = now - seen < FRESH_MS
        const x0 = p.x - nodeW / 2
        const y0 = p.y - nodeH / 2
        return (
          <g key={m.walletId} className={`net-node ${isNew ? 'fresh' : ''} ${state ? state.kind : ''}`} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
            <rect x={x0} y={y0} width={nodeW} height={nodeH} rx="18" />
            <text x={p.x} y={y0 + 34} className="net-name">
              {m.name.length > 15 ? `${m.name.slice(0, 14)}…` : m.name}
            </text>
            <text x={p.x} y={y0 + 66} className="net-usdc">
              {b ? `$${Number(formatUnits(b.usdc, 6)).toFixed(2)}` : '…'}
            </text>
            {!compact && (
              <text x={p.x} y={y0 + 92} className="net-eth">
                {b ? `${Number(formatEther(b.eth)).toFixed(5)} ETH` : ''}
              </text>
            )}
            {/* The client's own shares: A on the phone, C in the recovery kit. */}
            <g className={`share-pin ${state?.kind === 'kit' || state?.kind === 'cosign' ? 'hot' : ''}`}>
              <circle cx={x0 + 4} cy={y0 + 4} r="17" className="share a" />
              <text x={x0 + 4} y={y0 + 10} className="share-letter">
                A
              </text>
            </g>
            <g className={`share-pin ${state?.kind === 'kit' || state?.kind === 'recovered' ? 'hot' : ''}`}>
              <circle cx={x0 + nodeW - 4} cy={y0 + 4} r="17" className="share c" />
              <text x={x0 + nodeW - 4} y={y0 + 10} className="share-letter">
                C
              </text>
            </g>
            {state && (
              <text x={p.x} y={y0 + nodeH + 30} className={`net-status ${state.kind}`}>
                {state.label}
              </text>
            )}
          </g>
        )
      })}

      <g className="net-legend">
        <circle cx="26" cy={H - 70} r="12" className="share a" />
        <text x="26" y={H - 66} className="share-letter small">
          A
        </text>
        <text x="46" y={H - 65}>
          Phone (client)
        </text>
        <circle cx="26" cy={H - 42} r="12" className="share b" />
        <text x="26" y={H - 38} className="share-letter small">
          B
        </text>
        <text x="46" y={H - 37}>
          Swissquote
        </text>
        <circle cx="26" cy={H - 14} r="12" className="share c" />
        <text x="26" y={H - 10} className="share-letter small">
          C
        </text>
        <text x="46" y={H - 9}>
          Recovery kit (client) · any 2 of 3 sign
        </text>
      </g>

      {members.length === 0 && (
        <text x={CENTER.x} y={H - 40} className="net-empty">
          Waiting for the first wallet… scan the QR code to join.
        </text>
      )}
    </svg>
  )
}
