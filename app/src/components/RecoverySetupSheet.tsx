import { useState } from 'react'
import { getAddress, isAddress, type Address, type Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { EXPLORER, RECOVERY_DELAY } from '../config'
import { formatDuration, short } from '../lib/format'
import {
  createRecoveryKit,
  loadGuardianLabels,
  MAX_CONTACTS,
  parseRecoveryKit,
  saveGuardianLabels,
  setupCalls,
  suggestedThreshold,
  swissquote,
  type GuardianLabel,
  type RecoveryState,
} from '../recovery'
import { CLIENT } from '../sq/mockData'
import { explainError, sendCalls, type SmartAccount } from '../wallet'
import { Bank, Check, External, Fingerprint, Spinner, Users } from './icons'
import { Sheet } from './Sheet'

type Step = 'intro' | 'kit' | 'contacts' | 'confirm' | 'done'
type Contact = { name: string; address: string }

/** First-time setup, or changing the guardians later (then the current recovery kit is kept). */
export function RecoverySetupSheet({
  account,
  current,
  moduleIsOwner,
  onClose,
  onDone,
}: {
  account: SmartAccount
  current: RecoveryState
  moduleIsOwner: boolean
  onClose: () => void
  onDone: () => void
}) {
  const editing = current.enabled
  // What this device remembers about the guardians that are on-chain right now.
  const [known] = useState(() =>
    editing
      ? loadGuardianLabels(account.address).filter((g) =>
          current.guardians.some((onChain) => onChain.toLowerCase() === g.address.toLowerCase()),
        )
      : [],
  )
  const [keptKit, setKeptKit] = useState<Address | null>(known.find((g) => g.kind === 'kit')?.address ?? null)

  const [step, setStep] = useState<Step>('intro')
  const [newKit] = useState(() => createRecoveryKit(account.address))
  const [useNewKit, setUseNewKit] = useState(!keptKit)
  const [kitSaved, setKitSaved] = useState(false)
  const [swissquoteGuardian, setSwissquoteGuardian] = useState<Address | null>(null)
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const existing = known.filter((g) => g.kind === 'contact').map((g) => ({ name: g.name, address: g.address }))
    return existing.length ? existing : [{ name: '', address: '' }]
  })
  const [chosenThreshold, setChosenThreshold] = useState<number | null>(editing && known.length ? current.threshold : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hash, setHash] = useState<Hash | null>(null)

  const kitAddress = useNewKit ? newKit.address : keptKit!
  const guardianCount = 2 + contacts.length
  const threshold = Math.min(chosenThreshold ?? suggestedThreshold(guardianCount), guardianCount)

  const contactErrors = contacts.map((c, i) => {
    const address = c.address.trim().toLowerCase()
    if (!address) return ''
    if (!isAddress(address)) return 'Not a valid guardian address.'
    const taken = [kitAddress, swissquoteGuardian, account.address].some((a) => a?.toLowerCase() === address)
    const duplicate = contacts.some((other, j) => j !== i && other.address.trim().toLowerCase() === address)
    if (taken || duplicate) return 'Every guardian needs their own address.'
    return ''
  })
  const contactsValid = contacts.every((c, i) => c.address.trim() && !contactErrors[i])

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

  const begin = () =>
    run(async () => {
      // First time: prove ownership and link the wallet. Later: the wallet is already linked.
      const guardian = editing ? (await swissquote.info()).address : (await swissquote.link(account, CLIENT.tradingAccount)).guardian
      setSwissquoteGuardian(guardian)
      // Knowing the kit and Swissquote, every other guardian on-chain is a contact: keep them.
      if (editing && keptKit && !contacts.some((c) => c.address)) {
        const others = current.guardians.filter((g) => ![keptKit, guardian].some((k) => k.toLowerCase() === g.toLowerCase()))
        if (others.length) setContacts(others.map((address) => ({ name: '', address })))
      }
      setStep(useNewKit ? 'kit' : 'contacts')
    })

  const activate = () =>
    run(async () => {
      const labels: GuardianLabel[] = [
        { address: kitAddress, kind: 'kit', name: 'Recovery kit' },
        { address: swissquoteGuardian!, kind: 'swissquote', name: 'Swissquote' },
        ...contacts.map((c, i) => ({
          address: getAddress(c.address.trim()),
          kind: 'contact' as const,
          name: c.name.trim() || `Contact ${i + 1}`,
        })),
      ]
      const calls = setupCalls(account, labels.map((g) => g.address), threshold, moduleIsOwner)
      const result = await sendCalls(account, calls)
      saveGuardianLabels(account.address, labels)
      setHash(result.hash)
      setStep('done')
      onDone()
    })

  function downloadKit() {
    const url = URL.createObjectURL(new Blob([newKit.text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'swissquote-recovery-kit.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  // A different number of guardians needs a fresh look at the threshold: go back to the recommendation.
  function changeContacts(next: Contact[]) {
    setContacts(next)
    setChosenThreshold(null)
  }

  const updateContact = (i: number, patch: Partial<Contact>) =>
    setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <Sheet title={editing ? 'Manage guardians' : 'Set up recovery'} onClose={busy ? () => {} : onClose}>
      {step === 'intro' && (
        <div className="setup">
          <p className="lead left">
            {editing
              ? 'Add or remove the people who can help you recover. Your recovery kit and Swissquote stay guardians.'
              : 'If you lose this phone, your guardians together can move your wallet to a new passkey:'}
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
                <strong>Up to {MAX_CONTACTS} people you trust</strong>
                <span>Each approves from their own phone after talking to you</span>
              </div>
            </li>
          </ul>
          <p className="fineprint left">
            You choose how many approvals are needed (at least 2). Every recovery then waits{' '}
            {formatDuration(RECOVERY_DELAY)} (72 h in production), and any device you still have can cancel it.
            Swissquote can never recover alone, and can never move your funds.
          </p>
          {!editing && (
            <p className="fineprint left">
              First, link this wallet to your Swissquote profile (client {CLIENT.tradingAccount}). Your passkey signs a
              proof of ownership, which also covers the Travel Rule check for transfers from your Swissquote account.
            </p>
          )}
          {editing && !keptKit && (
            <div className="alert warn">
              <strong>Keep your current recovery kit?</strong>
              <span>This device does not remember your guardians. Open your kit file to keep it, or continue to make a new one.</span>
              <label className="chip">
                Open kit file
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={(e) =>
                    run(async () => {
                      const kit = parseRecoveryKit((await e.target.files?.[0]?.text()) ?? '')
                      const address = privateKeyToAccount(kit.privateKey).address
                      if (kit.account !== account.address || !current.guardians.includes(address))
                        throw new Error('This kit is not a guardian of this wallet.')
                      setKeptKit(address)
                      setUseNewKit(false)
                    })
                  }
                />
              </label>
            </div>
          )}
          {editing && keptKit && !known.length && (
            <span className="pill ok">
              <Check width="11" height="11" strokeWidth="3" /> Current recovery kit recognised
            </span>
          )}
          <button className="primary big with-icon" onClick={begin} disabled={busy}>
            {busy ? <Spinner /> : editing ? null : <Fingerprint />} {editing ? 'Continue' : 'Link wallet with passkey'}
          </button>
        </div>
      )}

      {step === 'kit' && (
        <div className="setup">
          {!editing && (
            <span className="pill ok">
              <Check width="11" height="11" strokeWidth="3" /> Linked to your Swissquote profile
            </span>
          )}
          <h3>Save your recovery kit</h3>
          <p className="muted">
            Download it, then print it or move it to a USB stick. Do not leave it on this phone: if the phone is lost,
            the kit has to survive.{editing && ' Your old kit stops working once you save.'}
          </p>
          <button className="primary big" onClick={downloadKit}>
            Download recovery kit
          </button>
          <label className="checkbox">
            <input type="checkbox" checked={kitSaved} onChange={(e) => setKitSaved(e.target.checked)} />
            I stored it somewhere other than this phone
          </label>
          <button className="primary big" onClick={() => setStep('contacts')} disabled={!kitSaved}>
            Continue
          </button>
        </div>
      )}

      {step === 'contacts' && (
        <form
          className="setup"
          onSubmit={(e) => {
            e.preventDefault()
            if (contactsValid) setStep('confirm')
          }}
        >
          <h3>People you trust</h3>
          <p className="muted">
            Each person opens the guardian page on their phone and sends you their guardian address. They can never
            move your funds.
          </p>
          <a className="explorer-link" href={`${window.location.pathname}#guardian`} target="_blank" rel="noreferrer">
            Open the guardian page <External />
          </a>

          {contacts.map((contact, i) => (
            <div className="contact-row" key={i}>
              <div className="contact-row-head">
                <input
                  className="name-input"
                  value={contact.name}
                  onChange={(e) => updateContact(i, { name: e.target.value })}
                  placeholder={`Contact ${i + 1} name`}
                  aria-label={`Contact ${i + 1} name`}
                />
                {contacts.length > 1 && (
                  <button type="button" className="text-btn danger" onClick={() => changeContacts(contacts.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <label className="field">
                <span className="sr-only">Guardian address</span>
                <input
                  value={contact.address}
                  onChange={(e) => updateContact(i, { address: e.target.value })}
                  placeholder="Their guardian address 0x…"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              {contactErrors[i] && <p className="error small">{contactErrors[i]}</p>}
            </div>
          ))}

          {contacts.length < MAX_CONTACTS && (
            <button type="button" className="chip" onClick={() => changeContacts([...contacts, { name: '', address: '' }])}>
              + Add another person
            </button>
          )}

          <div className="threshold">
            <strong>Approvals needed to recover</strong>
            <div className="segmented" role="radiogroup">
              {Array.from({ length: guardianCount - 1 }, (_, i) => i + 2).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={threshold === n}
                  className={threshold === n ? 'active' : ''}
                  onClick={() => setChosenThreshold(n)}
                >
                  {n} of {guardianCount}
                </button>
              ))}
            </div>
            <span className="muted small">
              {threshold === suggestedThreshold(guardianCount) ? 'Recommended. ' : ''}
              Lost phone: your kit and Swissquote
              {threshold > 2 ? ` plus ${threshold - 2} ${threshold - 2 === 1 ? 'person' : 'people'}` : ''}. Swissquote
              gone: your kit and {threshold - 1} {threshold - 1 === 1 ? 'person' : 'people'}.
            </span>
          </div>

          <button className="primary big" disabled={!contactsValid}>
            Continue
          </button>
          {editing && keptKit && !useNewKit && (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setUseNewKit(true)
                setStep('kit')
              }}
            >
              Lost your recovery kit? Make a new one
            </button>
          )}
        </form>
      )}

      {step === 'confirm' && (
        <div className="review">
          <dl>
            <div>
              <dt>Recovery kit</dt>
              <dd className="mono">{useNewKit ? `New · ${short(kitAddress)}` : short(kitAddress)}</dd>
            </div>
            <div>
              <dt>Swissquote</dt>
              <dd className="mono">{short(swissquoteGuardian!)}</dd>
            </div>
            {contacts.map((c, i) => (
              <div key={i}>
                <dt>{c.name.trim() || `Contact ${i + 1}`}</dt>
                <dd className="mono">{short(c.address.trim())}</dd>
              </div>
            ))}
            <div>
              <dt>Approvals needed</dt>
              <dd>
                {threshold} of {guardianCount}
              </dd>
            </div>
            <div>
              <dt>Time to cancel</dt>
              <dd>{formatDuration(RECOVERY_DELAY)}</dd>
            </div>
          </dl>
          <button className="primary big with-icon" onClick={activate} disabled={busy}>
            {busy ? <Spinner /> : <Fingerprint />} {busy ? 'Saving…' : editing ? 'Save with passkey' : 'Activate with passkey'}
          </button>
          <button className="text-btn" onClick={() => setStep('contacts')} disabled={busy}>
            Back
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="success-view">
          <div className="success-badge">
            <Check width="40" height="40" strokeWidth="2.6" />
          </div>
          <p className="lead">{editing ? 'Guardians updated' : 'Recovery is active'}</p>
          <p className="muted">
            {threshold} of {guardianCount} guardians can now recover your wallet. Stored in the recovery contract on Base
            Sepolia.
          </p>
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
