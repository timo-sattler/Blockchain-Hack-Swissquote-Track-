import { useEffect, useState } from 'react'
import { ServiceError, shareGet } from '../../mpc/api'
import { completeRecovery, describePasskeyError, escrowStatus, recoverWithEscrow, recoveryStatus, requestRecovery, type EscrowStatus } from '../../mpc/flows'
import type { Kit } from '../../mpc/kit'
import type { PhoneWallet } from '../../mpc/store'
import { Fingerprint, Spinner } from '../icons'
import { Sheet } from '../Sheet'
import { KitBackup } from './KitBackup'
import { KitPicker } from './KitPicker'

type Step =
  | { name: 'kit' }
  | { name: 'identity'; kit: Kit }
  | { name: 'refused'; message: string }
  | { name: 'waiting'; kit: Kit; readyAt: number }
  | { name: 'cancelled' }
  | { name: 'restoring'; kit: Kit; step: number }
  | { name: 'backup'; kit: Kit; wallet: PhoneWallet; viaEscrow?: boolean }
  | { name: 'escrow'; kit: Kit }
  | { name: 'error'; message: string }

export function RecoverySheet({ onClose, onRecovered }: { onClose: () => void; onRecovered: (wallet: PhoneWallet) => void }) {
  const [step, setStep] = useState<Step>({ name: 'kit' })
  const [now, setNow] = useState(Date.now())
  const [verifying, setVerifying] = useState(false)
  // First name of the wallet's owner for the (mock) identity check buttons; Swissquote's record has it.
  const [owner, setOwner] = useState('the owner')
  const kitWalletId = 'kit' in step ? step.kit.walletId : null

  useEffect(() => {
    if (!kitWalletId) return
    shareGet<{ name: string | null }>(`/wallets/${kitWalletId}`).then(
      (w) => w.name && setOwner(w.name.trim().split(/\s+/)[0]),
      () => {}, // Swissquote offline (escrow path): keep "the owner"
    )
  }, [kitWalletId])

  // Countdown and polling while the recovery delay runs.
  useEffect(() => {
    if (step.name !== 'waiting') return
    let active = true
    const timer = window.setInterval(async () => {
      setNow(Date.now())
      // Poll throughout the delay: the owner's current passkey may cancel at any moment.
      const status = await recoveryStatus(step.kit.walletId).catch(() => null)
      if (!active) return
      if (status?.state === 'cancelled') setStep({ name: 'cancelled' })
      else if (status?.state === 'ready') setStep({ name: 'restoring', kit: step.kit, step: -1 })
    }, 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [step])

  async function verifyIdentity(kit: Kit, kyc: 'match' | 'mismatch') {
    if (verifying) return
    setVerifying(true)
    try {
      const status = await requestRecovery(kit, kyc)
      setStep({ name: 'waiting', kit, readyAt: status?.readyAt ?? Date.now() })
    } catch (e) {
      if (e instanceof ServiceError && e.status === 403) setStep({ name: 'refused', message: e.message })
      else if (!(e instanceof ServiceError) && /final_session_id/i.test(e instanceof Error ? e.message : String(e)))
        // The kit's share no longer pairs with Swissquote's: the kit was replaced or a recovery issued new shares.
        setStep({ name: 'refused', message: 'This recovery kit is no longer valid: it was replaced, or a recovery issued new shares since. Use your most recent kit.' })
      else setStep({ name: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setVerifying(false)
    }
  }

  async function restore(kit: Kit) {
    setStep({ name: 'restoring', kit, step: 0 })
    try {
      const result = await completeRecovery(kit, (s) => setStep({ name: 'restoring', kit, step: s }))
      setStep({ name: 'backup', kit: result.kit, wallet: result.wallet })
    } catch (e) {
      setStep({ name: 'error', message: describePasskeyError(e) })
    }
  }

  const secondsLeft = step.name === 'waiting' ? Math.max(0, Math.ceil((step.readyAt - now) / 1000)) : 0

  return (
    <Sheet title="Recover your wallet" onClose={verifying || (step.name === 'restoring' && step.step >= 0) ? () => {} : onClose}>
      {step.name === 'kit' && (
        <>
          <p className="muted small sheet-intro">Step 1 of 3 · Load the recovery kit you saved when you created the wallet.</p>
          <KitPicker onUnlocked={(kit) => setStep({ name: 'identity', kit })} submitLabel="Continue" offerFriends />
        </>
      )}

      {step.name === 'identity' && (
        <div className="review">
          <p className="muted small">
            Step 2 of 3 · Swissquote checks that it is really you: ID document + liveness selfie, matched against your KYC profile.{' '}
            <span className="badge mock">MOCK</span>
          </p>
          <div className="options">
            <button className="option" disabled={verifying} onClick={() => verifyIdentity(step.kit, 'match')}>
              <span className="option-icon">🙂</span>
              <div>
                <strong>Take selfie as {owner}</strong>
                <span>Face matches the KYC profile</span>
              </div>
            </button>
            <button className="option" disabled={verifying} onClick={() => verifyIdentity(step.kit, 'mismatch')}>
              <span className="option-icon">🕵️</span>
              <div>
                <strong>Attacker with {owner}&apos;s phone + e-mail</strong>
                <span>Demo: the face does not match</span>
              </div>
            </button>
          </div>
          {verifying && <p className="loading-line"><Spinner /> Verifying your recovery kit…</p>}
          <button className="text-btn" disabled={verifying} onClick={() => setStep({ name: 'escrow', kit: step.kit })}>
            Swissquote no longer exists? Recover through the independent escrow agent
          </button>
        </div>
      )}

      {step.name === 'escrow' && (
        <EscrowRecovery
          kit={step.kit}
          owner={owner}
          onRecovered={(result) => setStep({ name: 'backup', kit: result.kit, wallet: result.wallet, viaEscrow: true })}
          onBack={() => setStep({ name: 'identity', kit: step.kit })}
        />
      )}

      {step.name === 'refused' && (
        <div className="error-view">
          <div className="refused-badge">⛔</div>
          <p className="error">{step.message}</p>
          <p className="muted small">
            A stolen phone and e-mail are not enough: recovery needs the kit, a matching identity check and a waiting period with alerts.
          </p>
          <button className="primary big" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {step.name === 'waiting' && (
        <div className="review center">
          <p className="muted small">Step 3 of 3 · Safety delay. Every device of yours has been alerted and can still stop this.</p>
          <p className="countdown">{secondsLeft}s</p>
          <p className="muted small">Demo delay. In production: 48 hours.</p>
        </div>
      )}

      {step.name === 'cancelled' && (
        <div className="error-view">
          <div className="refused-badge">✋</div>
          <p className="error">Recovery cancelled</p>
          <p className="muted small">
            A device that still holds this wallet's passkey stopped the recovery. If you are the owner and still have your
            phone, you do not need to recover. If not, contact Swissquote.
          </p>
          <button className="primary big" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {step.name === 'restoring' && (
        <div className="review">
          {step.step < 0 ? (
            <>
              <p className="muted small">
                The delay is over. Create a passkey on this new phone, then your kit and Swissquote rebuild your phone&apos;s share.
              </p>
              <button className="primary big with-icon" onClick={() => restore(step.kit)}>
                <Fingerprint /> Create passkey and restore
              </button>
            </>
          ) : (
            <p className="loading-line">
              <Spinner /> Rebuilding your phone share with Swissquote and your kit… ({step.step}/4)
            </p>
          )}
        </div>
      )}

      {step.name === 'backup' && (
        <KitBackup
          kit={step.kit}
          title="Save your new recovery kit"
          note={
            step.viaEscrow
              ? 'Swissquote is gone, so from now on you sign with this phone + your new kit. Delete the old kit file, and consider moving your funds to a new wallet provider.'
              : "Then delete your old kit file. It no longer works with Swissquote, but together with the lost phone's old share it could still sign."
          }
          onSaved={() => {
            onRecovered(step.wallet)
            onClose()
          }}
        />
      )}

      {step.name === 'error' && (
        <div className="error-view">
          <p className="error">{step.message}</p>
          <button className="primary big" onClick={() => setStep({ name: 'kit' })}>
            Start again
          </button>
        </div>
      )}
    </Sheet>
  )
}

/**
 * Swissquote is gone and the phone is lost. The independent escrow agent (mock notary) holds a copy of
 * Share B and stands in for Swissquote once, after Swissquote has been unreachable for a while and the
 * client passes the agent's identity check. Kit + escrow rebuild the phone share; the agent then
 * deletes its copy.
 */
function EscrowRecovery({
  kit,
  owner,
  onRecovered,
  onBack,
}: {
  kit: Kit
  owner: string
  onRecovered: (result: { wallet: PhoneWallet; kit: Kit }) => void
  onBack: () => void
}) {
  const [status, setStatus] = useState<EscrowStatus | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const poll = () =>
      escrowStatus(kit.walletId).then(
        (s) => (setStatus(s), setUnreachable(false)),
        () => setUnreachable(true),
      )
    poll()
    const timers = [window.setInterval(poll, 2000), window.setInterval(() => setNow(Date.now()), 1000)]
    return () => timers.forEach(window.clearInterval)
  }, [kit.walletId])

  async function recover(kyc: 'match' | 'mismatch') {
    setBusy(0)
    setError('')
    try {
      onRecovered(await recoverWithEscrow(kit, kyc, setBusy))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const wait = status?.releaseAfter ? Math.max(0, Math.ceil((status.releaseAfter - now) / 1000)) : null
  return (
    <div className="review">
      <p className="muted small">
        If Swissquote ceases operations, an independent escrow agent (for example a Swiss notary) holds a copy of Swissquote&apos;s
        share. It steps in exactly once, to rebuild your phone share together with your kit, and then deletes its copy.{' '}
        <span className="badge mock">MOCK</span>
      </p>
      {unreachable ? (
        <p className="error small">The escrow agent is unreachable (in services/: npm run escrow).</p>
      ) : (
        <ul className="escrow-status">
          <li>Escrow holds Swissquote&apos;s share: <strong>{status ? (status.deposited ? 'yes' : 'no') : '…'}</strong></li>
          <li>
            Swissquote:{' '}
            <strong>
              {!status ? '…' : status.swissquoteOnline ? 'still operating (use the normal recovery)' : wait ? `unreachable, escrow can step in in ${wait}s` : 'gone · escrow can step in'}
            </strong>
          </li>
        </ul>
      )}
      {busy !== null ? (
        <p className="loading-line">
          <Spinner /> Rebuilding your phone share with the escrow agent and your kit… ({busy}/4)
        </p>
      ) : (
        <div className="options">
          <button className="option" onClick={() => recover('match')}>
            <span className="option-icon">🙂</span>
            <div>
              <strong>Notary identity check as {owner}</strong>
              <span>ID + selfie verified by the escrow agent</span>
            </div>
          </button>
          <button className="option" onClick={() => recover('mismatch')}>
            <span className="option-icon">🕵️</span>
            <div>
              <strong>Attacker with {owner}&apos;s kit</strong>
              <span>Demo: the identity check fails</span>
            </div>
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      <button className="text-btn" onClick={onBack} disabled={busy !== null}>
        Back
      </button>
    </div>
  )
}
