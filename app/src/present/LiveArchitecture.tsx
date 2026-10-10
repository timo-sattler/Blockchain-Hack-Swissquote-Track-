import { useEffect, useState } from 'react'
import type { FeedItem } from './live'

type NodeId = 'phone' | 'sq' | 'copy' | 'escrow' | 'compliance' | 'registry' | 'sponsor' | 'btc' | 'base'
type EdgeId = 'phone-sq' | 'phone-copy' | 'copy-sq' | 'sq-mocks' | 'phone-btc' | 'phone-base'
type Highlight = { nodes: NodeId[]; edges: EdgeId[]; alert?: NodeId[] }

const FLASH_MS = 3200

/** What lights up for each event. */
function highlightFor(item: FeedItem): Highlight {
  switch (item.type) {
    case 'wallet_created':
      return { nodes: ['phone', 'sq', 'registry'], edges: ['phone-sq', 'sq-mocks'] }
    case 'signing':
      return item.alone ? { nodes: ['copy'], edges: [] } : { nodes: ['phone', 'sq', 'compliance'], edges: ['phone-sq', 'sq-mocks'] }
    case 'funded':
      return { nodes: ['sq', 'base'], edges: [] }
    case 'tx_broadcast':
      if (item.chain === 'bitcoin') return { nodes: ['phone', 'btc'], edges: ['phone-btc'] }
      return item.sponsored ? { nodes: ['sponsor', 'base'], edges: ['sq-mocks'] } : { nodes: ['phone', 'base'], edges: ['phone-base'] }
    case 'escrow_deposited':
      return { nodes: ['sq', 'escrow'], edges: ['sq-mocks'] }
    case 'payment_blocked':
      return { nodes: ['phone'], edges: ['phone-sq'], alert: ['sq', 'compliance'] }
    case 'device_added':
      return { nodes: ['phone', 'copy', 'sq'], edges: ['phone-copy', 'copy-sq'] }
    case 'device_removed':
      return { nodes: ['copy', 'sq'], edges: ['copy-sq'], alert: ['phone'] }
    case 'takeover_released':
      return { nodes: ['copy', 'escrow'], edges: [], alert: ['sq'] }
    default:
      return { nodes: [], edges: [] }
  }
}

export function LiveArchitecture({ items, shareOnline }: { items: FeedItem[]; shareOnline: boolean | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 400)
    return () => window.clearInterval(timer)
  }, [])

  const recent = items.filter((i) => now - i.at < FLASH_MS && i.source !== 'chain')
  const lit = recent.map(highlightFor)
  const on = (id: NodeId) => lit.some((h) => h.nodes.includes(id))
  const alert = (id: NodeId) => lit.some((h) => h.alert?.includes(id))
  const edgeOn = (id: EdgeId) => lit.some((h) => h.edges.includes(id))

  // Live: the hub reports the share service's health. Simulated runs carry their own offline/online events.
  const lastSimulated = items.find((i) => i.source === 'simulated' && (i.type === 'service_offline' || i.type === 'service_online'))
  const sqDown = lastSimulated ? lastSimulated.type === 'service_offline' : shareOnline === false

  const cls = (id: NodeId, extra = '') =>
    ['la-node', extra, on(id) ? 'on' : '', alert(id) ? 'alert' : '', id === 'sq' && sqDown ? 'down' : ''].join(' ')

  return (
    <svg className="live-arch" viewBox="0 0 1000 470" role="img" aria-label="Live architecture: the client's devices, Swissquote share service and blockchains">
      <defs>
        <marker id="la-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#9aa1ad" />
        </marker>
        <marker id="la-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#f05a2a" />
        </marker>
      </defs>

      {/* edges first, so nodes sit on top */}
      <g className="la-edges">
        <Edge on={edgeOn('phone-sq')} d="M290 100H375" both />
        <Edge on={edgeOn('phone-copy')} d="M165 160V318" both />
        <Edge on={edgeOn('copy-sq')} d="M290 385H335V135H375" both />
        <Edge on={edgeOn('sq-mocks')} d="M500 160V226" />
        <Edge on={edgeOn('phone-btc')} d="M165 40V18H680V85H710" />
        <Edge on={edgeOn('phone-base')} d="M680 85V205H710" />
      </g>

      <g className={cls('phone', 'share-a')}>
        <rect x="40" y="40" width="250" height="120" rx="14" />
        <circle cx="66" cy="68" r="13" className="badge" />
        <text x="66" y="73" className="badge-text">A</text>
        <text x="88" y="74" className="title">Your laptop</text>
        <text x="58" y="104" className="sub">Swissquote app · your part (A)</text>
        <text x="58" y="128" className="sub">Unlocked by Face ID</text>
      </g>

      <g className={cls('copy', 'share-c')}>
        <rect x="40" y="320" width="250" height="120" rx="14" />
        <circle cx="66" cy="348" r="13" className="badge" />
        <text x="66" y="353" className="badge-text">A</text>
        <text x="88" y="354" className="title">Your phone</text>
        <text x="58" y="384" className="sub">Identical copy of your part,</text>
        <text x="58" y="408" className="sub">its own Face ID passkey</text>
      </g>

      <g className={cls('sq', 'share-b mock')}>
        <rect x="375" y="40" width="250" height="120" rx="14" />
        <circle cx="401" cy="68" r="13" className="badge" />
        <text x="401" y="73" className="badge-text">B</text>
        <text x="423" y="74" className="title">Swissquote</text>
        <text x="393" y="104" className="sub">Share service · own process</text>
        <text x="393" y="128" className="sub">{sqDown ? 'OFFLINE' : 'Co-signs, never alone'}</text>
      </g>

      {(
        [
          ['escrow', 375, 228, 'Escrow agent'],
          ['compliance', 505, 228, 'Screening'],
          ['registry', 375, 308, 'Wallet registry'],
          ['sponsor', 505, 308, 'Fee sponsor'],
        ] as const
      ).map(([id, x, y, label]) => (
        <g key={id} className={cls(id, 'mock small')}>
          <rect x={x} y={y} width="120" height="64" rx="10" />
          <text x={x + 60} y={y + 38} className="small-label">
            {label}
          </text>
        </g>
      ))}

      <g className={cls('btc', 'chain')}>
        <rect x="710" y="40" width="250" height="90" rx="14" />
        <text x="730" y="76" className="title">Bitcoin testnet</text>
        <text x="730" y="104" className="sub">Same key · SegWit address</text>
      </g>
      <g className={cls('base', 'chain')}>
        <rect x="710" y="160" width="250" height="90" rx="14" />
        <text x="730" y="196" className="title">Base Sepolia</text>
        <text x="730" y="224" className="sub">Same key · any EVM chain</text>
      </g>

      <text x="710" y="300" className="legend">Solid = real</text>
      <text x="710" y="324" className="legend">Dashed = mocked</text>
      <text x="710" y="348" className="legend">Glow = happening now</text>
    </svg>
  )
}

function Edge({ on, d, both = false }: { on: boolean; d: string; both?: boolean }) {
  const marker = on ? 'url(#la-arrow-on)' : 'url(#la-arrow)'
  return <path className={on ? 'on' : ''} d={d} markerStart={both ? marker : undefined} markerEnd={marker} />
}
