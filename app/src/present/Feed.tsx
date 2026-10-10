import { explorerUrl, type FeedItem } from './live'

const short = (value: string) => (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value)

function describe(item: FeedItem): { icon: string; title: string; detail?: string; tone?: 'good' | 'bad' } {
  switch (item.type) {
    case 'wallet_created':
      return { icon: '✦', title: `Wallet created${item.name ? ` for ${item.name}` : ''}: 3 key shares`, detail: `BTC ${short(item.btcAddress)} · EVM ${short(item.evmAddress)}`, tone: 'good' }
    case 'signing': {
      const key = [...item.parties].sort().join('')
      if (key === 'AB') return { icon: '✍', title: 'Phone + Swissquote co-signed' }
      if (key === 'AC') return { icon: '✍', title: 'Phone + recovery kit signed', detail: 'No Swissquote involved', tone: 'good' }
      return { icon: '✍', title: 'Swissquote + recovery kit signed' }
    }
    case 'tx_broadcast':
      return {
        icon: '↗',
        title: `Sent ${item.amount} ${item.asset}`,
        detail: `${item.chain === 'bitcoin' ? 'Bitcoin testnet' : 'Base Sepolia'}${item.sponsored ? ' · network fee paid by Swissquote' : ''}`,
        tone: 'good',
      }
    case 'service_offline':
      return { icon: '⏻', title: 'Swissquote share service offline', tone: 'bad' }
    case 'service_online':
      return { icon: '⏻', title: 'Swissquote share service back online' }
    case 'recovery_requested':
      return item.by === 'attacker'
        ? { icon: '⚠', title: 'Recovery requested with stolen phone + e-mail', tone: 'bad' }
        : { icon: '↺', title: 'Recovery requested: new phone + kit' }
    case 'recovery_refused':
      return { icon: '⛔', title: 'Recovery refused', detail: item.reason, tone: 'good' }
    case 'funded':
      return { icon: '🎁', title: `Welcome bonus${item.name ? ` for ${item.name}` : ''}`, detail: `${item.usdc} USDC + ${item.eth} ETH for gas from the Swissquote treasury`, tone: 'good' }
    case 'device_paired':
      return { icon: '⇄', title: `Device re-paired${item.name ? ` for ${item.name}` : ''}`, detail: 'Passkey + recovery kit issued a new phone share', tone: 'good' }
    case 'recovery_completed':
      return { icon: '✓', title: 'Recovery complete', detail: 'New phone share, same addresses', tone: 'good' }
    case 'recovery_cancelled':
      return { icon: '✋', title: `Recovery cancelled by the owner${item.name ? ` (${item.name})` : ''}`, detail: 'Their current passkey vetoed it during the delay', tone: 'good' }
    case 'replaced_device_refused':
      return { icon: '⛔', title: 'Replaced phone tried to sign', detail: 'Its old key share no longer works with Swissquote', tone: 'good' }
    case 'payment_blocked':
      return { icon: '⛔', title: `Payment blocked${item.name ? ` for ${item.name}` : ''}: ${short(item.to)}`, detail: `Recipient is ${item.reason}. Swissquote refused to co-sign; nothing was signed`, tone: 'bad' }
    case 'inbox_registered':
      return { icon: '✉', title: `${item.name ?? 'A client'} can now hold friends' backups`, detail: 'Inbox key published on Base Sepolia, signed by their own wallet', tone: 'good' }
    case 'backup_onchain':
      return { icon: '⛓', title: `Kit backed up to ${item.friends} friends${item.name ? ` by ${item.name}` : ''}`, detail: 'On Base Sepolia: locked with the password, one encrypted piece per friend · fees paid by Swissquote', tone: 'good' }
    case 'piece_returned':
      return { icon: '↩', title: `${item.name ?? 'A friend'} gave a backup piece back`, detail: 'Encrypted to the recovering phone only, on Base Sepolia', tone: 'good' }
    case 'kit_replaced':
      return { icon: '⟳', title: `Recovery kit replaced${item.name ? ` for ${item.name}` : ''}`, detail: 'Phone + Swissquote issued new shares: the old kit is worthless', tone: 'good' }
    case 'escrow_deposited':
      return { icon: '⚖', title: 'Escrow agent holds a copy of Share B', detail: 'Independent notary, released only if Swissquote is gone' }
    case 'escrow_released':
      return { icon: '⚖', title: `Escrow released Share B${item.name ? ` to ${item.name}` : ''}`, detail: 'Swissquote is gone: kit + escrow restore the wallet', tone: 'good' }
    case 'escrow_refused':
      return { icon: '⛔', title: 'Escrow release refused', detail: item.reason, tone: 'good' }
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
