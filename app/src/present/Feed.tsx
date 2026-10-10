import { explorerUrl, type FeedItem } from './live'

const short = (value: string) => (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value)

function describe(item: FeedItem): { icon: string; title: string; detail?: string; tone?: 'good' | 'bad' } {
  switch (item.type) {
    case 'wallet_created':
      return { icon: '✦', title: `Wallet created${item.name ? ` for ${item.name}` : ''}: one key, two parts`, detail: `BTC ${short(item.btcAddress)} · EVM ${short(item.evmAddress)}`, tone: 'good' }
    case 'signing':
      return item.alone
        ? { icon: '✍', title: 'Signed on the device alone', detail: "Both parts on the device after the grace period", tone: 'good' }
        : { icon: '✍', title: 'Client part + Swissquote co-signed', detail: 'Screened by Swissquote first' }
    case 'tx_broadcast':
      return {
        icon: '↗',
        title: `Sent ${item.amount} ${item.asset}`,
        detail: `${item.chain === 'bitcoin' ? 'Bitcoin testnet' : 'Base Sepolia'}${item.sponsored ? ' · network fee paid by Swissquote' : ''}`,
        tone: 'good',
      }
    case 'service_offline':
      return { icon: '⏻', title: 'Swissquote share service offline', detail: 'Wallets are paused; the grace period starts', tone: 'bad' }
    case 'service_online':
      return { icon: '⏻', title: 'Swissquote share service back online' }
    case 'payment_blocked':
      return { icon: '⛔', title: `Payment blocked${item.name ? ` for ${item.name}` : ''}: ${short(item.to)}`, detail: `Recipient is ${item.reason}. Swissquote refused to co-sign; nothing was signed`, tone: 'bad' }
    case 'device_added':
      return { icon: '⧉', title: `${item.name ?? 'A client'} added a device: ${item.device}`, detail: 'Identical copy of the key part, its own Face ID passkey. Swissquote could not read the copy', tone: 'good' }
    case 'device_removed':
      return { icon: '⊘', title: `${item.name ?? 'A client'} removed a device: ${item.device}`, detail: 'Swissquote refuses its passkey: that copy of the key part is now useless' }
    case 'replaced_device_refused':
      return { icon: '⛔', title: `Outdated device refused${item.name ? ` for ${item.name}` : ''}`, tone: 'bad' }
    case 'escrow_deposited':
      return { icon: '⚖', title: "Escrow agent holds a copy of Swissquote's part", detail: 'Released only after the grace period, if Swissquote is gone' }
    case 'escrow_refused':
      return { icon: '⚖', title: 'Escrow agent refused', detail: item.reason, tone: 'bad' }
    case 'takeover_released':
      return { icon: '⚖', title: `Grace period over${item.name ? ` for ${item.name}` : ''}`, detail: "The escrow agent handed its copy of Swissquote's part to the client's device: it now signs alone", tone: 'good' }
    case 'funded':
      return { icon: '🎁', title: `Welcome bonus for ${item.name ?? short(item.to)}`, detail: `${item.usdc} USDC + ${item.eth} ETH from Swissquote's treasury (testnet)` }
  }
}

const SOURCE_LABEL: Record<FeedItem['source'], string> = { service: 'LIVE', chain: 'ON-CHAIN', simulated: 'SIMULATED' }

export function Feed({ items, compact = false }: { items: FeedItem[]; compact?: boolean }) {
  if (items.length === 0)
    return <p className="feed-empty">Waiting for activity… create a wallet or send a payment in the app.</p>

  return (
    <ul className={`feed ${compact ? 'compact' : ''}`}>
      {items.map((item) => {
        const d = describe(item)
        const link =
          item.type === 'tx_broadcast' && item.hash !== 'simulated' ? explorerUrl(item.chain, item.hash) : item.type === 'funded' ? explorerUrl('base', item.hash) : null
        return (
          <li key={item.id} className={d.tone ?? ''}>
            <span className="feed-icon">{d.icon}</span>
            <div>
              <strong>{d.title}</strong>
              {d.detail && <span>{d.detail}</span>}
            </div>
            <div className="feed-meta">
              <span className={`src ${item.source}`}>{SOURCE_LABEL[item.source]}</span>
              <time>{new Date(item.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              {link && (
                <a href={link} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
