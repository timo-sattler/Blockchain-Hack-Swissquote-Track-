import { useCallback, useEffect, useState } from 'react'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { short, timeAgo } from '../../lib/format'
import { describePasskeyError, escrowStatus, removeDevice, takeOver, walletDetails, type DeviceInfo, type EscrowStatus } from '../../mpc/flows'
import type { PhoneWallet } from '../../mpc/store'
import { Bank, External, Fingerprint } from '../icons'
import { AddDeviceSheet } from './AddDeviceSheet'
import { KeyInspectorSheet } from './KeyInspectorSheet'

/**
 * One key, two parts: the client's part (identical copies on their devices) and Swissquote's part.
 * Also shows the grace period when Swissquote is unreachable, and the takeover once it is over.
 */
export function useKeyParts(wallet: PhoneWallet, swissquoteOnline: boolean | null, onToast: (m: string) => void, onWalletChange: (w: PhoneWallet) => void) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [escrow, setEscrow] = useState<EscrowStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    walletDetails(wallet.walletId).then((d) => setDevices(d.devices), () => {})
  }, [wallet.walletId])

  useEffect(() => {
    refresh()
  }, [refresh, swissquoteOnline])

  // Swissquote unreachable: the wallet is paused; the escrow agent counts down the grace period.
  useEffect(() => {
    if (swissquoteOnline !== false || wallet.independent) return setEscrow(null)
    const poll = () => escrowStatus(wallet.walletId).then(setEscrow, () => setEscrow(null))
    poll()
    const timer = setInterval(() => (poll(), setNow(Date.now())), 1000)
    return () => clearInterval(timer)
  }, [swissquoteOnline, wallet.walletId, wallet.independent])

  async function remove(device: DeviceInfo) {
    if (!confirm(`Remove “${device.name}”? Swissquote will refuse its passkey, so the copy of your key part on it becomes useless.`)) return
    setBusy(true)
    setError('')
    try {
      const details = await removeDevice(wallet, device.id)
      setDevices(details.devices)
      onToast(`${device.name} removed`)
    } catch (e) {
      setError(describePasskeyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function takeOverWallet() {
    setBusy(true)
    setError('')
    try {
      onWalletChange(await takeOver(wallet))
      onToast('Your device now holds the whole wallet')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removedHere = !wallet.independent && devices.length > 0 && !!wallet.credentialId && !devices.some((d) => d.id === wallet.credentialId)
  const graceLeft = escrow?.releaseAfter ? Math.max(0, Math.ceil((escrow.releaseAfter - now) / 1000)) : null
  const grace = escrow?.graceSeconds ?? 30

  return { wallet, swissquoteOnline, devices, adding, setAdding, busy, escrow, error, refresh, remove, takeOverWallet, removedHere, graceLeft, grace, onToast }
}

export type KeyParts = ReturnType<typeof useKeyParts>

/** At the top of the wallet: device removed, wallet paused (grace period), or taken over. */
export function WalletNotices({ parts }: { parts: KeyParts }) {
  const { wallet, swissquoteOnline, escrow, busy, removedHere, graceLeft, grace, takeOverWallet, error } = parts
  return (
    <>
      {removedHere && (
        <section className="card notice-card paused">
          <strong>This device was removed from your wallet</strong>
          <span>Swissquote no longer accepts this device's Face ID, so its copy of your key part is useless. To use the wallet here again, add this device from one of your other devices.</span>
        </section>
      )}
      {wallet.independent ? (
        <section className="card notice-card ok">
          <strong>Your device holds the whole wallet</strong>
          <span>
            Swissquote was gone for the whole grace period, so the escrow agent handed over its copy of Swissquote's part. You now sign alone, on
            this device. Payments are no longer screened or free.
          </span>
        </section>
      ) : (
        swissquoteOnline === false && (
          <section className="card notice-card paused">
            <strong>Swissquote is unreachable: your wallet is paused</strong>
            <span>
              Every payment needs Swissquote's part. If Swissquote stays unreachable for the grace period (six months; {grace} s in this demo), the
              independent escrow agent hands its copy of Swissquote's part to your device.
            </span>
            {escrow?.deposited === false && <span className="error small">The escrow agent holds no copy for this wallet.</span>}
            {graceLeft !== null && graceLeft > 0 && <span className="countdown">Grace period: {graceLeft} s left</span>}
            {graceLeft === 0 && escrow?.deposited && (
              <button className="primary big" onClick={takeOverWallet} disabled={busy}>
                {busy ? 'Proving this device holds your key part…' : 'Take over my wallet'}
              </button>
            )}
          </section>
        )
      )}

      {error && (wallet.independent || swissquoteOnline === false) && <p className="error small">{error}</p>}
    </>
  )
}

/** One key, two parts: the client's part (identical copies on their devices) and Swissquote's part. */
export function KeyPartsCard({ parts }: { parts: KeyParts }) {
  const { wallet, swissquoteOnline, devices, adding, setAdding, busy, error, refresh, remove, onToast } = parts
  const [inspecting, setInspecting] = useState(false)
  return (
    <>
      <section className="card control">
        <div className="card-head">
          <h2>Your key: two parts</h2>
          <span className="badge ok">Both needed</span>
        </div>
        <ul className="control-list">
          <li>
            <span className="control-icon you">
              <Fingerprint />
            </span>
            <div>
              <strong>Your part</strong>
              <span>On your devices, each unlocked with its own Face ID</span>
            </div>
            <span className="pill ok">{devices.length || 1} device{devices.length > 1 ? 's' : ''}</span>
          </li>
          {devices.map((d) => (
            <li key={d.id} className="device-row">
              <span />
              <div>
                <strong>
                  {d.name}
                  {d.id === wallet.credentialId && <em> · this device</em>}
                </strong>
                <span>Added {timeAgo(d.addedAt)}</span>
              </div>
              {d.id !== wallet.credentialId && devices.length > 1 && !wallet.independent ? (
                <button className="pill action" onClick={() => remove(d)} disabled={busy || !swissquoteOnline}>
                  Remove
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
          <li>
            <span className="control-icon">
              <Bank />
            </span>
            <div>
              <strong>Swissquote's part</strong>
              <span>{wallet.independent ? 'Released to your device after the grace period' : 'Blocks malicious addresses, pays the fee. Never acts alone'}</span>
            </div>
            <span className={`pill ${wallet.independent ? '' : swissquoteOnline ? 'ok' : swissquoteOnline === false ? 'down' : ''}`}>
              {wallet.independent ? 'Released' : swissquoteOnline === null ? '…' : swissquoteOnline ? 'Online' : 'Offline'}
            </span>
          </li>
        </ul>
        {!wallet.independent && (
          <button className="secondary" onClick={() => setAdding(true)} disabled={!swissquoteOnline}>
            Add a device
          </button>
        )}
        <button className="text-btn" onClick={() => setInspecting(true)}>
          How my key works
        </button>
        {error && <p className="error small">{error}</p>}
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

      {inspecting && <KeyInspectorSheet wallet={wallet} onClose={() => setInspecting(false)} />}
      {adding && (
        <AddDeviceSheet
          wallet={wallet}
          deviceCount={devices.length}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false)
            refresh()
            onToast(`${name} added: it can now sign with Swissquote`)
          }}
        />
      )}
    </>
  )
}
