import { useState } from 'react'
import { isAddress, type Address, type Hash } from 'viem'
import { EXPLORER, RECOVERY_DELAY } from '../config'
import { formatDuration, short } from '../lib/format'
import { createRecoveryKit, setupCalls, swissquote } from '../recovery'
import { CLIENT } from '../sq/mockData'
import { explainError, sendCalls, type SmartAccount } from '../wallet'
import { Bank, Check, External, Fingerprint, Spinner, Users } from './icons'
import { Sheet } from './Sheet'

type Step = 'intro' | 'kit' | 'contact' | 'confirm' | 'done'

export function RecoverySetupSheet({
  account,
  moduleIsOwner,
  onClose,
  onDone,
}: {
  account: SmartAccount
  moduleIsOwner: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>('intro')
  const [kit] = useState(() => createRecoveryKit(account.address))
  const [kitSaved, setKitSaved] = useState(false)
  const [swissquoteGuardian, setSwissquoteGuardian] = useState<Address | null>(null)
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hash, setHash] = useState<Hash | null>(null)

  const contactAddress = contact.trim()
  const contactError = !contactAddress
    ? ''
    : !isAddress(contactAddress)
      ? 'That is not a valid guardian address.'
      : [kit.address, swissquoteGuardian, account.address].some((a) => a?.toLowerCase() === contactAddress.toLowerCase())
        ? 'Your trusted contact needs their own guardian address.'
        : ''

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (e) {
      setError(explainError(e))
    } finally {
      setBusy(false)
    }
  }

  const linkProfile = () =>
    run(async () => {
      const { guardian } = await swissquote.link(account, CLIENT.tradingAccount)
      setSwissquoteGuardian(guardian)
      setStep('kit')
    })

  const activate = () =>
    run(async () => {
      const guardians = [kit.address, swissquoteGuardian!, contactAddress as Address]
      const result = await sendCalls(account, setupCalls(account, guardians, moduleIsOwner))
      setHash(result.hash)
      setStep('done')
      onDone()
    })

  function downloadKit() {
    const url = URL.createObjectURL(new Blob([kit.text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'swissquote-recovery-kit.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Sheet title="Set up recovery" onClose={busy ? () => {} : onClose}>
      {step === 'intro' && (
        <div className="setup">
          <p className="lead left">
            If you lose this phone, any <strong>2 of these 3</strong> can move your wallet to a new passkey:
          </p>
          <ul className="guardian-list">
            <li>
              <span className="control-icon you">
                <Fingerprint />
              </span>
              <div>
                <strong>You · recovery kit</strong>
                <span>A file you keep offline, printed or on a USB stick</span>
              </div>
            </li>
            <li>
              <span className="control-icon">
                <Bank />
              </span>
              <div>
                <strong>Swissquote</strong>
                <span>Only after checking your ID and face. Email or SMS alone never works</span>
              </div>
            </li>
            <li>
              <span className="control-icon">
                <Users />
              </span>
              <div>
                <strong>A person you trust</strong>
                <span>Approves from their own phone after talking to you</span>
              </div>
            </li>
          </ul>
          <p className="fineprint left">
            Every recovery waits {formatDuration(RECOVERY_DELAY)} (72 h in production). During that time any device you
            still have can cancel it. Swissquote can never recover alone, and can never move your funds.
          </p>
          <p className="fineprint left">
            First, link this wallet to your Swissquote profile (client {CLIENT.tradingAccount}). Your passkey signs a
            proof of ownership, which also covers the Travel Rule check for transfers from your Swissquote account.
          </p>
          <button className="primary big with-icon" onClick={linkProfile} disabled={busy}>
            {busy ? <Spinner /> : <Fingerprint />} Link wallet with passkey
          </button>
        </div>
      )}

      {step === 'kit' && (
        <div className="setup">
          <span className="pill ok">
            <Check width="11" height="11" strokeWidth="3" /> Linked to your Swissquote profile
          </span>
          <h3>Save your recovery kit</h3>
          <p className="muted">
            Download it, then print it or move it to a USB stick. Do not leave it on this phone: if the phone is lost,
            the kit has to survive.
          </p>
          <button className="primary big" onClick={downloadKit}>
            Download recovery kit
          </button>
          <label className="checkbox">
            <input type="checkbox" checked={kitSaved} onChange={(e) => setKitSaved(e.target.checked)} />
            I stored it somewhere other than this phone
          </label>
          <button className="primary big" onClick={() => setStep('contact')} disabled={!kitSaved}>
            Continue
          </button>
        </div>
      )}

      {step === 'contact' && (
        <form
          className="setup"
          onSubmit={(e) => {
            e.preventDefault()
            if (contactAddress && !contactError) setStep('confirm')
          }}
        >
          <h3>Add a person you trust</h3>
          <p className="muted">
            Ask them to open the guardian page on their phone and send you their guardian address. They can never move
            your funds, and they cannot recover alone.
          </p>
          <a className="explorer-link" href={`${window.location.pathname}#guardian`} target="_blank" rel="noreferrer">
            Open the guardian page <External />
          </a>
          <label className="field">
            Their guardian address
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {contactError && <p className="error small">{contactError}</p>}
          <button className="primary big" disabled={!contactAddress || !!contactError}>
            Continue
          </button>
        </form>
      )}

      {step === 'confirm' && (
        <div className="review">
          <dl>
            <div>
              <dt>Recovery kit</dt>
              <dd className="mono">{short(kit.address)}</dd>
            </div>
            <div>
              <dt>Swissquote</dt>
              <dd className="mono">{short(swissquoteGuardian!)}</dd>
            </div>
            <div>
              <dt>Trusted contact</dt>
              <dd className="mono">{short(contactAddress)}</dd>
            </div>
            <div>
              <dt>Approvals needed</dt>
              <dd>2 of 3</dd>
            </div>
            <div>
              <dt>Time to cancel</dt>
              <dd>{formatDuration(RECOVERY_DELAY)}</dd>
            </div>
          </dl>
          <button className="primary big with-icon" onClick={activate} disabled={busy}>
            {busy ? <Spinner /> : <Fingerprint />} {busy ? 'Activating…' : 'Activate with passkey'}
          </button>
          <button className="text-btn" onClick={() => setStep('contact')} disabled={busy}>
            Back
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="success-view">
          <div className="success-badge">
            <Check width="40" height="40" strokeWidth="2.6" />
          </div>
          <p className="lead">Recovery is active</p>
          <p className="muted">The guardians are stored in the recovery contract on Base Sepolia.</p>
          {hash && (
            <a className="explorer-link" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
              See it on the blockchain <External />
            </a>
          )}
          <button className="primary big" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      {error && <p className="error center">{error}</p>}
    </Sheet>
  )
}
