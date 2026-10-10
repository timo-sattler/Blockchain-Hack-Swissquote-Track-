import { useCallback, useEffect, useState } from 'react'
import { EXPLORER, GASLESS } from '../config'
import { formatEth, formatUsdc, short, timeAgo } from '../lib/format'
import { loadHistory, saveHistory, type Transfer } from '../lib/history'
import { getBalances, type SmartAccount, type StoredPasskey } from '../wallet'
import { AddFundsSheet } from './AddFundsSheet'
import { Confetti } from './Confetti'
import { ControlCard } from './ControlCard'
import { PendingRecoveryAlert } from './PendingRecoveryAlert'
import { ArrowDown, ArrowUp, Copy, External, Plus } from './icons'
import { ReceiveSheet } from './ReceiveSheet'
import { SendSheet } from './SendSheet'

type SheetName = 'send' | 'receive' | 'add' | null

export function WalletHome({
  account,
  passkey,
  justCreated,
  onToast,
  onForget,
}: {
  account: SmartAccount
  passkey: StoredPasskey
  justCreated: boolean
  onToast: (message: string) => void
  onForget: () => void
}) {
  const [balances, setBalances] = useState<{ eth: bigint; usdc: bigint } | null>(null)
  const [history, setHistory] = useState<Transfer[]>(() => loadHistory(account.address))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setBalances(await getBalances(account.address))
    } catch {
      // Keep the last known balances when the RPC hiccups.
    }
  }, [account])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 12_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(account.address)
      onToast('Address copied')
    } catch {
      onToast('Could not copy, select the address manually')
    }
  }

  function onSent(transfer: Transfer) {
    const next = [transfer, ...history]
    setHistory(next)
    saveHistory(account.address, next)
    refresh()
    setRefreshKey((k) => k + 1)
  }

  const empty = balances !== null && balances.usdc === 0n && balances.eth === 0n
  const [whole, cents] = balances ? formatUsdc(balances.usdc).split('.') : ['–', '––']

  return (
    <>
      {justCreated && (
        <div className="welcome">
          <Confetti pieces={36} />
          <strong>Your wallet is ready 🎉</strong>
          <span>Secured by your passkey. No seed phrase needed.</span>
        </div>
      )}

      <PendingRecoveryAlert account={account} onCancelled={() => setRefreshKey((k) => k + 1)} />

      <section className="balance-card">
        <div className="balance-top">
          <span className="network">
            <i /> Base Sepolia · Testnet
          </span>
          <button className="address-chip" onClick={copyAddress} title={account.address}>
            {short(account.address)} <Copy />
          </button>
        </div>
        <p className="balance-label">Total balance</p>
        <p className="balance">
          <span className="currency">$</span>
          {whole}
          <span className="cents">.{cents}</span>
        </p>
        <p className="balance-sub">
          {balances ? `${formatUsdc(balances.usdc)} USDC` : 'Loading…'}
          {balances && (!GASLESS || balances.eth > 0n) && ` · ${formatEth(balances.eth)} ETH for gas`}
          {GASLESS && ' · Gas-free transfers'}
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

      {empty && (
        <button className="nudge" onClick={() => setSheet('add')}>
          <span className="nudge-emoji">🚀</span>
          <div>
            <strong>Add some test funds to get started</strong>
            <span>Free USDC from a faucet, ready in under a minute</span>
          </div>
        </button>
      )}

      <ControlCard
        account={account}
        passkeyPublicKey={passkey.publicKey}
        refreshKey={refreshKey}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />

      <section className="card">
        <div className="card-head">
          <h2>Activity</h2>
          <a className="subtle-link" href={`${EXPLORER}/address/${account.address}`} target="_blank" rel="noreferrer">
            All on explorer <External />
          </a>
        </div>
        {history.length === 0 ? (
          <p className="empty-state">No transfers yet. Your first one will show up here.</p>
        ) : (
          <ul className="activity">
            {history.map((t) => (
              <li key={t.hash}>
                <span className="activity-icon">
                  <ArrowUp />
                </span>
                <div>
                  <strong>Sent to {short(t.to)}</strong>
                  <span>{timeAgo(t.at)}</span>
                </div>
                <a href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="activity-amount">
                  −{t.amount} {t.token}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="text-btn danger"
        onClick={() => {
          if (confirm('Remove this wallet from the device? Without the passkey you will need recovery to access it.'))
            onForget()
        }}
      >
        Remove wallet from this device
      </button>

      {sheet === 'send' && (
        <SendSheet account={account} balances={balances} onClose={() => setSheet(null)} onSent={onSent} />
      )}
      {sheet === 'receive' && (
        <ReceiveSheet address={account.address} onCopy={copyAddress} onClose={() => setSheet(null)} />
      )}
      {sheet === 'add' && <AddFundsSheet onCopyAddress={copyAddress} onClose={() => setSheet(null)} />}
    </>
  )
}
