import { explorerUrl, type FeedItem } from './live'

const short = (value: string) => (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value)

function describe(item: FeedItem): { icon: string; title: string; detail?: string; tone?: 'good' | 'bad' } {
  switch (item.type) {
    case 'wallet_created':
      return { icon: '✦', title: `Wallet created${item.name ? ` for ${item.name}` : ''}: 3 key shares`, detail: `BTC ${short(item.btcAddress)} · EVM ${short(item.evmAddress)}`, tone: 'good' }
    case 'signing': {
      const key = [...item.parties].sort().join('')
      const who = item.name ? `${item.name}: ` : ''
      if (key === 'AB') return { icon: '✍', title: `${who}phone (A) + Swissquote (B) signed` }
      if (key === 'AC') return { icon: '✍', title: `${who}phone (A) + recovery kit (C) signed`, detail: 'No Swissquote involved', tone: 'good' }
      return { icon: '✍', title: 'Swissquote + recovery kit signed' }
    }
    case 'tx_broadcast':
      return { icon: '↗', title: `Sent ${item.amount} ${item.asset}`, detail: item.chain === 'bitcoin' ? 'Bitcoin testnet' : 'Base Sepolia', tone: 'good' }
    case 'service_offline':
      return { icon: '⏻', title: 'Swissquote share service offline', tone: 'bad' }
    case 'service_online':
      return { icon: '⏻', title: 'Swissquote share service back online' }
    case 'recovery_requested':
      return item.by === 'attacker'
        ? { icon: '⚠', title: `Attacker tries to recover ${item.name ?? 'a wallet'}`, detail: 'Stolen phone + e-mail', tone: 'bad' }
        : { icon: '↺', title: `Recovery requested${item.name ? ` by ${item.name}` : ''}`, detail: 'New phone + recovery kit' }
    case 'recovery_refused':
      return { icon: '⛔', title: `Recovery refused${item.name ? ` for ${item.name}` : ''}`, detail: item.reason, tone: 'good' }
    case 'funded':
      return { icon: '🎁', title: `Welcome bonus${item.name ? ` for ${item.name}` : ''}`, detail: `${item.usdc} USDC + ${item.eth} ETH for gas from the Swissquote treasury`, tone: 'good' }
    case 'device_paired':
      return { icon: '⇄', title: `Device re-paired${item.name ? ` for ${item.name}` : ''}`, detail: 'Passkey + recovery kit issued a new phone share', tone: 'good' }
    case 'recovery_completed':
      return { icon: '✓', title: `Recovery complete${item.name ? ` for ${item.name}` : ''}`, detail: 'New phone share, same addresses', tone: 'good' }
  }
}

const SOURCE_LABEL: Record<FeedItem['source'], string> = { service: 'LIVE', chain: 'ON-CHAIN' }

export function Feed({ items, compact = false }: { items: FeedItem[]; compact?: boolean }) {
  if (items.length === 0)
    return <p className="feed-empty">Waiting for activity… create a wallet or send a payment in the app.</p>

  return (
    <ul className={`feed ${compact ? 'compact' : ''}`}>
      {items.map((item) => {
        const d = describe(item)
        const link =
          item.type === 'tx_broadcast' ? explorerUrl(item.chain, item.hash) : item.type === 'funded' ? explorerUrl('base', item.hash) : null
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
