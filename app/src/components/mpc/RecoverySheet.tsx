import { useEffect, useState } from 'react'
import { ServiceError } from '../../mpc/api'
import { completeRecovery, describePasskeyError, recoveryStatus, requestRecovery } from '../../mpc/flows'
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
  | { name: 'restoring'; kit: Kit; step: number }
  | { name: 'backup'; kit: Kit; wallet: PhoneWallet }
  | { name: 'error'; message: string }

export function RecoverySheet({ onClose, onRecovered }: { onClose: () => void; onRecovered: (wallet: PhoneWallet) => void }) {
  const [step, setStep] = useState<Step>({ name: 'kit' })
  const [now, setNow] = useState(Date.now())

  // Countdown and polling while the recovery delay runs.
  useEffect(() => {
    if (step.name !== 'waiting') return
    const timer = window.setInterval(async () => {
      setNow(Date.now())
      if (Date.now() >= step.readyAt) {
        const status = await recoveryStatus(step.kit.walletId).catch(() => null)
        if (status?.state === 'ready') setStep({ name: 'restoring', kit: step.kit, step: -1 })
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [step])

  async function verifyIdentity(kit: Kit, kyc: 'match' | 'mismatch') {
    try {
      const status = await requestRecovery(kit, kyc)
      setStep({ name: 'waiting', kit, readyAt: status?.readyAt ?? Date.now() })
    } catch (e) {
      if (e instanceof ServiceError && e.status === 403) setStep({ name: 'refused', message: e.message })
      else setStep({ name: 'error', message: e instanceof Error ? e.message : String(e) })
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
    <Sheet title="Recover your wallet" onClose={step.name === 'restoring' && step.step >= 0 ? () => {} : onClose}>
      {step.name === 'kit' && (
        <>
          <p className="muted small sheet-intro">Step 1 of 3 · Load the recovery kit you saved when you created the wallet.</p>
          <KitPicker onUnlocked={(kit) => setStep({ name: 'identity', kit })} submitLabel="Continue" />
        </>
      )}

      {step.name === 'identity' && (
        <div className="review">
          <p className="muted small">
            Step 2 of 3 · Swissquote checks that it is really you: ID document + liveness selfie, matched against your KYC profile.{' '}
            <span className="badge mock">MOCK</span>
          </p>
          <div className="options">
            <button className="option" onClick={() => verifyIdentity(step.kit, 'match')}>
              <span className="option-icon">🙂</span>
              <div>
                <strong>Take selfie as Anna</strong>
                <span>Face matches the KYC profile</span>
              </div>
            </button>
            <button className="option" onClick={() => verifyIdentity(step.kit, 'mismatch')}>
              <span className="option-icon">🕵️</span>
              <div>
                <strong>Attacker with Anna&apos;s phone + e-mail</strong>
                <span>Demo: the face does not match</span>
              </div>
            </button>
          </div>
        </div>
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
          replacesOldKit
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
