import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { formatEth, formatUsdc, short, timeAgo } from '../../lib/format'
import { shareGet } from '../../mpc/api'
import { btcBalance, evmBalances, type Asset } from '../../mpc/chains'
import { loadActivity, type ActivityItem } from '../../mpc/history'
import { cachedPrices, fetchPrices, formatChf, type Prices } from '../../mpc/prices'
import type { PhoneWallet } from '../../mpc/store'
import { AddFundsSheet } from '../AddFundsSheet'
import { ArrowDown, ArrowUp, Bank, Copy, Fingerprint, Plus, Shield } from '../icons'
import { ReceiveSheet } from '../ReceiveSheet'
import { MpcSendSheet, type SentTransfer } from './MpcSendSheet'

type Balances = { usdc: bigint; eth: bigint; btc: bigint }
type SheetName = { kind: 'send'; asset: Asset } | { kind: 'receive'; asset: Asset } | { kind: 'add' } | null

const ASSETS: { asset: Asset; name: string; network: string; icon: string; color: string; note?: string }[] = [
  { asset: 'BTC', name: 'Bitcoin', network: 'Bitcoin testnet4', icon: '₿', color: '#f7931a' },
  { asset: 'ETH', name: 'Ethereum', network: 'Base Sepolia', icon: 'Ξ', color: '#627eea', note: 'also pays network fees' },
  { asset: 'USDC', name: 'USD Coin', network: 'Base Sepolia', icon: '$', color: '#2775ca' },
]

// Transfers this device sent (to label kit signatures and show them before the explorer indexes them).
const sentKey = (walletId: string) => `sq-mpc:history:${walletId}`
function loadSent(walletId: string): SentTransfer[] {
  try {
    return JSON.parse(localStorage.getItem(sentKey(walletId)) ?? '[]')
  } catch {
    return []
  }
}

const amountOf = (b: Partial<Balances>, asset: Asset): number | null => {
  if (asset === 'BTC') return b.btc === undefined ? null : Number(b.btc) / 1e8
  if (asset === 'ETH') return b.eth === undefined ? null : Number(formatEth(b.eth).replace(/,/g, ''))
  return b.usdc === undefined ? null : Number(formatUsdc(b.usdc).replace(/,/g, ''))
}

const formatAmount = (asset: Asset, value: number) =>
  asset === 'USDC'
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toLocaleString('en-US', { maximumFractionDigits: asset === 'BTC' ? 8 : 6 })

export function MpcHome({ wallet, kitSavedAt, onToast, onForget }: { wallet: PhoneWallet; kitSavedAt: number | null; onToast: (m: string) => void; onForget: () => void }) {
  const [balances, setBalances] = useState<Partial<Balances>>({})
  const [prices, setPrices] = useState<Prices | null>(cachedPrices)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [sent, setSent] = useState<SentTransfer[]>(() => loadSent(wallet.walletId))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [swissquoteOnline, setSwissquoteOnline] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const [evm, btc, history] = await Promise.allSettled([evmBalances(wallet.evmAddress as Address), btcBalance(wallet.btcAddress), loadActivity(wallet)])
    setBalances((b) => ({
      ...b,
      ...(evm.status === 'fulfilled' ? evm.value : {}),
      ...(btc.status === 'fulfilled' ? { btc: btc.value } : {}),
    }))
    if (history.status === 'fulfilled') setActivity(history.value)
  }, [wallet])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    fetchPrices().then((p) => p && setPrices(p))
    const timer = setInterval(() => fetchPrices().then((p) => p && setPrices(p)), 120_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const check = () => shareGet('/health').then(() => setSwissquoteOnline(true), () => setSwissquoteOnline(false))
    check()
    const timer = setInterval(check, 3000)
    return () => clearInterval(timer)
  }, [])

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      onToast('Address copied')
    } catch {
      onToast('Could not copy, select the address manually')
    }
  }

  function onSent(transfer: SentTransfer) {
    const next = [transfer, ...sent].slice(0, 50)
    setSent(next)
    try {
      localStorage.setItem(sentKey(wallet.walletId), JSON.stringify(next))
    } catch {
      // Only used to label transfers signed with the kit.
    }
    setTimeout(refresh, 4000)
  }

  const rows = ASSETS.map((a) => {
    const amount = amountOf(balances, a.asset)
    const chf = amount !== null && prices ? amount * prices[a.asset] : null
    return { ...a, amount, chf }
  })
  const loaded = rows.every((r) => r.amount !== null)
  const total = loaded && prices ? rows.reduce((sum, r) => sum + (r.chf ?? 0), 0) : null
  const [whole, cents] = total !== null ? formatChf(total).split('.') : ['–', '––']

  // Explorer history, plus transfers this device sent that are not indexed yet.
  const viaKit = new Set(sent.filter((s) => s.viaKit).map((s) => s.hash))
  const pending: ActivityItem[] = sent
    .filter((s) => !(activity ?? []).some((a) => a.hash === s.hash))
    .map((s) => ({ hash: s.hash, chain: s.chain, asset: s.asset, direction: 'out', amount: s.amount, counterparty: s.to, label: short(s.to), at: s.at }))
  const items = [...pending, ...(activity ?? [])].sort((a, b) => b.at - a.at)

  return (
    <>
      <section className="balance-card">
        <div className="balance-top">
          <span className="network">
            <i /> Bitcoin + Base · Testnets
          </span>
          <button className="address-chip" onClick={() => setSheet({ kind: 'receive', asset: 'USDC' })}>
            {short(wallet.evmAddress)} <Copy />
          </button>
        </div>
        <p className="balance-label">{wallet.name ? `${wallet.name.split(' ')[0]}’s wallet · total value` : 'Total value'}</p>
        <p className="balance">
          <span className="currency">CHF</span>
          {whole}
          <span className="cents">.{cents}</span>
        </p>
        <p className="balance-sub">Indicative mainnet prices · testnet coins have no real value</p>
        <div className="actions">
          <button onClick={() => setSheet({ kind: 'send', asset: 'USDC' })}>
            <span>
              <ArrowUp />
            </span>
            Send
          </button>
          <button onClick={() => setSheet({ kind: 'receive', asset: 'USDC' })}>
            <span>
              <ArrowDown />
            </span>
            Receive
          </button>
          <button onClick={() => setSheet({ kind: 'add' })}>
            <span>
              <Plus />
            </span>
            Add funds
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Assets</h2>
          <span className="badge">One key · all chains</span>
        </div>
        <ul className="assets">
          {rows.map((r) => (
            <li key={r.asset}>
              <span className="asset-icon" style={{ background: r.color }}>
                {r.icon}
              </span>
              <div className="asset-name">
                <strong>{r.name}</strong>
                <span>
                  {r.network}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </div>
              <div className="asset-amount">
                <strong>{r.amount === null ? '…' : `${formatAmount(r.asset, r.amount)} ${r.asset}`}</strong>
                <span>{r.chf === null ? '' : `≈ CHF ${formatChf(r.chf)}`}</span>
              </div>
              <div className="asset-actions">
                <button className="icon-btn small" aria-label={`Send ${r.name}`} title={`Send ${r.name}`} onClick={() => setSheet({ kind: 'send', asset: r.asset })}>
                  <ArrowUp />
                </button>
                <button className="icon-btn small" aria-label={`Receive ${r.name}`} title={`Receive ${r.name}`} onClick={() => setSheet({ kind: 'receive', asset: r.asset })}>
                  <ArrowDown />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {prices && (
          <p className="fineprint left">
            1 BTC ≈ CHF {formatChf(prices.BTC)} · 1 ETH ≈ CHF {formatChf(prices.ETH)} · 1 USDC ≈ CHF {formatChf(prices.USDC)} · CoinGecko, indicative
          </p>
        )}
      </section>

      <section className="card control">
        <div className="card-head">
          <h2>Who holds your key shares</h2>
          <span className="badge ok">Any 2 of 3 sign</span>
        </div>
        <ul className="control-list">
          <li>
            <span className="control-icon you">
              <Fingerprint />
            </span>
            <div>
              <strong>A · This phone</strong>
              <span>Unlocked with Face ID for every payment</span>
            </div>
            <span className="pill ok">Here</span>
          </li>
          <li>
            <span className="control-icon">
              <Bank />
            </span>
            <div>
              <strong>B · Swissquote</strong>
              <span>Checks and co-signs. Cannot act alone</span>
            </div>
            <span className={`pill ${swissquoteOnline ? 'ok' : swissquoteOnline === false ? 'down' : ''}`}>
              {swissquoteOnline === null ? '…' : swissquoteOnline ? 'Online' : 'Offline'}
            </span>
          </li>
          <li>
            <span className="control-icon">
              <Shield />
            </span>
            <div>
              <strong>C · Your recovery kit</strong>
              <span>{kitSavedAt ? `Saved ${timeAgo(kitSavedAt)}` : 'Encrypted file you keep'}</span>
            </div>
            <span className="pill">Yours</span>
          </li>
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Activity</h2>
          <button className="subtle-link" onClick={refresh}>
            Refresh
          </button>
        </div>
        {activity === null && items.length === 0 ? (
          <p className="empty-state">Loading activity from the blockchains…</p>
        ) : items.length === 0 ? (
          <p className="empty-state">No transactions yet. Add test funds, then send your first payment.</p>
        ) : (
          <ul className="activity">
            {items.map((t) => (
              <li key={`${t.hash}-${t.asset}-${t.direction}`}>
                <span className={`activity-icon ${t.direction}`}>{t.direction === 'in' ? <ArrowDown /> : <ArrowUp />}</span>
                <div>
                  <strong>{t.direction === 'in' ? `From ${t.label}` : `To ${t.label}`}</strong>
                  <span>
                    {timeAgo(t.at)} · {t.chain === 'base' ? 'Base' : 'Bitcoin'}
                    {t.direction === 'out' && viaKit.has(t.hash) ? ' · signed with kit' : ''}
                  </span>
                </div>
                <a
                  href={t.chain === 'base' ? `${EXPLORER}/tx/${t.hash}` : `${BTC_EXPLORER}/tx/${t.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`activity-amount ${t.direction}`}
                >
                  {t.direction === 'in' ? '+' : '−'}
                  {formatAmount(t.asset, Number(t.amount))} {t.asset}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="text-btn danger"
        onClick={() => {
          if (confirm('Remove this wallet from the device? You will need your recovery kit to get it back.')) onForget()
        }}
      >
        Remove wallet from this device (simulate a lost phone)
      </button>

      {sheet?.kind === 'send' && <MpcSendSheet wallet={wallet} initialAsset={sheet.asset} onClose={() => setSheet(null)} onSent={onSent} />}
      {sheet?.kind === 'receive' && (
        <ReceiveSheet
          options={[
            { label: 'USDC / ETH', network: 'Base Sepolia', address: wallet.evmAddress },
            { label: 'Bitcoin', network: 'Bitcoin testnet4', address: wallet.btcAddress },
          ]}
          initial={sheet.asset === 'BTC' ? 1 : 0}
          onCopy={copy}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'add' && <AddFundsSheet evmAddress={wallet.evmAddress} btcAddress={wallet.btcAddress} onCopy={copy} onClose={() => setSheet(null)} />}
    </>
  )
}
