import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { formatEth, formatUsdc, short, timeAgo } from '../../lib/format'
import { shareGet } from '../../mpc/api'
import { backupAvailable } from '../../mpc/backup'
import { refreshBlocklist } from '../../mpc/screening'
import { btcBalance, evmBalances } from '../../mpc/chains'
import type { PhoneWallet } from '../../mpc/store'
import { AddFundsSheet } from '../AddFundsSheet'
import { ArrowDown, ArrowUp, Bank, Copy, External, Fingerprint, Plus, Shield } from '../icons'
import { ReceiveSheet } from '../ReceiveSheet'
import { FriendBackups } from './FriendBackups'
import { MpcSendSheet, type SentTransfer } from './MpcSendSheet'
import { RecoveryAlert, ReplacedCard, useWalletStatus } from './RecoveryWatch'

type Balances = { usdc: bigint; eth: bigint; btc: bigint }
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
  kitSavedAt,
  onToast,
  onForget,
  onReplaceKit,
}: {
  wallet: PhoneWallet
  kitSavedAt: number | null
  onToast: (m: string) => void
  onForget: () => void
  onReplaceKit: () => void
}) {
  const [balances, setBalances] = useState<Partial<Balances>>({})
  const [history, setHistory] = useState<SentTransfer[]>(() => loadHistory(wallet.walletId))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [swissquoteOnline, setSwissquoteOnline] = useState<boolean | null>(null)
  const { status, setStatus } = useWalletStatus(wallet.walletId)
  // Swissquote issued newer shares (recovery or pairing elsewhere): this phone's share is outdated.
  const replaced = !wallet.independent && !!status && status.epoch > (wallet.epoch ?? 1)

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

  const [whole, cents] = balances.usdc !== undefined ? formatUsdc(balances.usdc).split('.') : ['–', '––']

  return (
    <>
      {replaced ? (
        <ReplacedCard />
      ) : (
        <RecoveryAlert
          walletId={wallet.walletId}
          recovery={status?.recovery ?? null}
          onCancelled={(next) => {
            setStatus(next)
            onToast('Recovery cancelled')
          }}
        />
      )}

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
          {balances.btc !== undefined ? `${formatBtc(balances.btc)} BTC` : '… BTC'} ·{' '}
          {balances.eth !== undefined ? `${formatEth(balances.eth)} ETH for gas` : '… ETH'}
        </p>
        <div className="actions">
          <button onClick={() => setSheet('send')} disabled={replaced}>
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
            <button
              className="pill action"
              disabled={replaced}
              title="Kit lost or stolen? Issue a new one; the old kit stops working."
              onClick={() => {
                if (confirm('Replace your recovery kit? Phone and Swissquote issue new shares, and your old kit stops working. Use this if your kit was lost or stolen.')) onReplaceKit()
              }}
            >
              Replace
            </button>
          </li>
        </ul>
        <p className="fineprint left">
          Same key on every chain:{' '}
          <a href={`${BTC_EXPLORER}/address/${wallet.btcAddress}`} target="_blank" rel="noreferrer">
            {short(wallet.btcAddress)} <External />
          </a>{' '}
          ·{' '}
          <a href={`${EXPLORER}/address/${wallet.evmAddress}`} target="_blank" rel="noreferrer">
            {short(wallet.evmAddress)} <External />
          </a>
        </p>
      </section>

      {backupAvailable && !replaced && !wallet.independent && <FriendBackups wallet={wallet} onToast={onToast} />}

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
          if (confirm('Remove this wallet from the device? You will need your recovery kit to get it back.')) onForget()
        }}
      >
        Remove wallet from this device (simulate a lost phone)
      </button>

      {sheet === 'send' && <MpcSendSheet wallet={wallet} onClose={() => setSheet(null)} onSent={onSent} />}
      {sheet === 'receive' && (
        <ReceiveSheet
          options={[
            { label: 'USDC / ETH', network: 'Base Sepolia', address: wallet.evmAddress },
            { label: 'Bitcoin', network: 'Bitcoin testnet4', address: wallet.btcAddress },
          ]}
          onCopy={copy}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'add' && <AddFundsSheet evmAddress={wallet.evmAddress} btcAddress={wallet.btcAddress} onCopy={copy} onClose={() => setSheet(null)} />}
    </>
  )
}
