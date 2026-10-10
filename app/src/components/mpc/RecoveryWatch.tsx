import { useCallback, useEffect, useState } from 'react'
import { cancelRecovery, describePasskeyError, walletStatus, type RecoveryStatus, type WalletStatus } from '../../mpc/flows'
import { Fingerprint, Spinner } from '../icons'

/** Polls what Swissquote knows about the wallet: share generation and any recovery in progress. */
export function useWalletStatus(walletId: string) {
  const [status, setStatus] = useState<WalletStatus | null>(null)
  const refresh = useCallback(() => walletStatus(walletId).then(setStatus, () => {}), [walletId])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])
  return { status, setStatus }
}

/**
 * Owner veto. Every device that still holds the wallet sees a recovery as soon as it is requested,
 * and the current passkey can stop it until MPC recovery successfully commits the new shares.
 */
export function RecoveryAlert({
  walletId,
  recovery,
  onCancelled,
}: {
  walletId: string
  recovery: RecoveryStatus
  onCancelled: (status: WalletStatus) => void
}) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = recovery?.state === 'pending' || recovery?.state === 'ready'

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  async function cancel() {
    setBusy(true)
    setError('')
    try {
      onCancelled(await cancelRecovery(walletId))
    } catch (e) {
      setError(describePasskeyError(e))
    } finally {
      setBusy(false)
    }
  }

  const secondsLeft = Math.max(0, Math.ceil(((recovery?.readyAt ?? now) - now) / 1000))
  return (
    <section className="recovery-alert" role="alert">
      <strong>Someone is recovering this wallet on a new phone</strong>
      {recovery?.canCancel ? (
        <>
          <span>
            {secondsLeft > 0
              ? `They passed the identity check and loaded the recovery kit. In ${secondsLeft}s (48 h in production) they get a new key share.`
              : 'The waiting period is over. You can still cancel until recovery completes.'}{' '}
            If this is not you, stop it now.
          </span>
          <button className="primary with-icon" onClick={cancel} disabled={busy}>
            {busy ? <Spinner /> : <Fingerprint />} {busy ? 'Cancelling…' : 'This is not me · Cancel recovery'}
          </button>
        </>
      ) : (
        <span>Recovery has completed. Contact Swissquote if you did not request it.</span>
      )}
      {error && <span className="error small">{error}</span>}
    </section>
  )
}

/** Shown on a phone whose share was replaced by a recovery or a newly paired device. */
export function ReplacedCard() {
  return (
    <section className="recovery-alert locked" role="alert">
      <strong>This phone no longer controls the wallet</strong>
      <span>
        A recovery or a newly paired device issued new key shares. Swissquote no longer co-signs with this phone's share. If
        you did not do this, contact Swissquote.
      </span>
    </section>
  )
}
