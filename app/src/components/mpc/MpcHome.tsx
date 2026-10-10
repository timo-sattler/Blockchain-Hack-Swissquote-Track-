import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { formatEth, formatUsdc, short, timeAgo } from '../../lib/format'
import { shareGet } from '../../mpc/api'
import { refreshBlocklist } from '../../mpc/screening'
import { btcBalance, evmBalances } from '../../mpc/chains'
import type { PhoneWallet } from '../../mpc/store'
import { AddFundsSheet } from '../AddFundsSheet'
import { ArrowDown, ArrowUp, Copy, Plus } from '../icons'
import { ReceiveSheet } from '../ReceiveSheet'
import { EVM_NETWORKS, otherNetworkAddresses } from '../../mpc/networks'
import { KeyPartsCard, useKeyParts, WalletNotices } from './KeyPartsCard'
import { MpcSendSheet, type SentTransfer } from './MpcSendSheet'

type Balances = { usdc: bigint; eurc: bigint; eth: bigint; btc: bigint }
type SheetName = 'send' | 'receive' | 'add' | null

const historyKey = (walletId: string) => `sq-mpc:history:${walletId}`
function loadHistory(walletId: string): SentTransfer[] {
  try {
    return JSON.parse(localStorage.getItem(historyKey(walletId)) ?? '[]')
  } catch {
    return []
  }
}

const formatBtc = (sats: bigint) => (Number(sats) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 })

export function MpcHome({
  wallet,
  fresh,
  onToast,
  onForget,
  onWalletChange,
}: {
  wallet: PhoneWallet
  fresh: boolean
  onToast: (m: string) => void
  onForget: () => void
  onWalletChange: (w: PhoneWallet) => void
}) {
  const [balances, setBalances] = useState<Partial<Balances>>({})
  const [history, setHistory] = useState<SentTransfer[]>(() => loadHistory(wallet.walletId))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [swissquoteOnline, setSwissquoteOnline] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const [evm, btc] = await Promise.allSettled([evmBalances(wallet.evmAddress as Address), btcBalance(wallet.btcAddress)])
    setBalances((b) => ({
      ...b,
      ...(evm.status === 'fulfilled' ? evm.value : {}),
      ...(btc.status === 'fulfilled' ? { btc: btc.value } : {}),
    }))
  }, [wallet])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 12_000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    refreshBlocklist() // kept on the device, so kit payments are screened even while Swissquote is down
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
    const next = [transfer, ...history].slice(0, 30)
    setHistory(next)
    try {
      localStorage.setItem(historyKey(wallet.walletId), JSON.stringify(next))
    } catch {
      // Activity is a convenience; the explorers are the source of truth.
    }
    setTimeout(refresh, 4000)
  }

  const parts = useKeyParts(wallet, swissquoteOnline, onToast, onWalletChange)
  const other = useMemo(() => otherNetworkAddresses(wallet.publicKey), [wallet.publicKey])
  const [whole, cents] = balances.usdc !== undefined ? formatUsdc(balances.usdc).split('.') : ['–', '––']

  return (
    <>
      {fresh && (
        <div className="welcome">
          <strong>Your wallet is ready 🎉</strong>
          <span>Your key part is on this device, Swissquote holds the other part. Tip: add your phone or a second laptop below, so you never depend on one device.</span>
        </div>
      )}

      <WalletNotices parts={parts} />

      <section className="balance-card">
        <div className="balance-top">
          <span className="network">
            <i /> Bitcoin + Base · Testnets
          </span>
          <button className="address-chip" onClick={() => setSheet('receive')}>
            {short(wallet.evmAddress)} <Copy />
          </button>
        </div>
        <p className="balance-label">{wallet.name ? `${wallet.name.split(' ')[0]}’s wallet · USDC` : 'USDC balance'}</p>
        <p className="balance">
          <span className="currency">$</span>
          {whole}
          <span className="cents">.{cents}</span>
        </p>
        <p className="balance-sub">
          {balances.eurc !== undefined ? `€${formatUsdc(balances.eurc)} EURC` : '… EURC'} ·{' '}
          {balances.btc !== undefined ? `${formatBtc(balances.btc)} BTC` : '… BTC'} ·{' '}
          {balances.eth !== undefined ? `${formatEth(balances.eth)} ETH for gas` : '… ETH'}
        </p>
        <div className="actions">
          <button onClick={() => setSheet('send')}>
            <span>
              <ArrowUp />
            </span>
            Send
          </button>
          <button onClick={() => setSheet('receive')}>
            <span>
              <ArrowDown />
            </span>
            Receive
          </button>
          <button onClick={() => setSheet('add')}>
            <span>
              <Plus />
            </span>
            Add funds
          </button>
        </div>
      </section>

      <KeyPartsCard parts={parts} />

      <section className="card">
        <div className="card-head">
          <h2>Activity</h2>
        </div>
        {history.length === 0 ? (
          <p className="empty-state">No transfers yet. Add test funds, then send your first payment.</p>
        ) : (
          <ul className="activity">
            {history.map((t) => (
              <li key={t.hash}>
                <span className="activity-icon">
                  <ArrowUp />
                </span>
                <div>
                  <strong>Sent to {short(t.to)}</strong>
                  <span>
                    {timeAgo(t.at)} · {t.viaKit ? 'phone + kit' : 'phone + Swissquote'}
                  </span>
                </div>
                <a href={t.chain === 'base' ? `${EXPLORER}/tx/${t.hash}` : `${BTC_EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="activity-amount">
                  −{t.amount} {t.asset}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="text-btn danger"
        onClick={() => {
          if (confirm('Remove the wallet from this device? It stays on your other devices; to use it here again, add this device from one of them.')) onForget()
        }}
      >
        Remove wallet from this device (simulate a lost device)
      </button>

      {sheet === 'send' && <MpcSendSheet wallet={wallet} onClose={() => setSheet(null)} onSent={onSent} />}
      {sheet === 'receive' && (
        <ReceiveSheet
          options={[
            { label: 'USDC · EURC · ETH', network: 'Base Sepolia', address: wallet.evmAddress },
            { label: 'Bitcoin', network: 'Bitcoin testnet4', address: wallet.btcAddress },
          ]}
          others={[
            { name: EVM_NETWORKS.join(' · '), detail: 'The same 0x address on every Ethereum-type network, for any token there', address: wallet.evmAddress },
            { name: 'Litecoin', detail: 'SegWit address from the same key', address: other.litecoin },
            { name: 'Dogecoin', detail: 'Address from the same key', address: other.dogecoin },
            { name: 'Tron', detail: 'Address from the same key (USDT on Tron)', address: other.tron },
          ]}
          onCopy={copy}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'add' && <AddFundsSheet evmAddress={wallet.evmAddress} btcAddress={wallet.btcAddress} onCopy={copy} onClose={() => setSheet(null)} />}
    </>
  )
}
