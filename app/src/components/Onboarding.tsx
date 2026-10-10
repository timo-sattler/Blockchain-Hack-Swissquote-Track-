import { useState, type FormEvent } from 'react'
import { Fingerprint, Shield, Users } from './icons'

const NAME_KEY = 'sq-mpc:last-name'

function lastName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function Onboarding({
  busy,
  progress,
  error,
  onCreate,
  onLogin,
  onRecover,
}: {
  busy: boolean
  progress?: string
  error?: string
  onCreate: (name: string) => void
  onLogin: () => void
  onRecover: () => void
}) {
  const [name, setName] = useState(lastName)
  const trimmed = name.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trimmed.length < 2) return
    try {
      localStorage.setItem(NAME_KEY, trimmed)
    } catch {
      // Only a convenience for the next visit.
    }
    onCreate(trimmed)
  }

  return (
    <section className="onboarding">
      <div className={`orb ${busy ? 'busy' : ''}`}>
        <span className="ring" />
        <span className="ring delay" />
        <Fingerprint width="56" height="56" strokeWidth="1.4" />
      </div>
      <p className="eyebrow">{trimmed ? `Hi ${trimmed.split(' ')[0]} 👋` : 'Welcome 👋'}</p>
      <h1>
        Your keys.
        <br />
        <span className="accent-text">Your control.</span>
      </h1>
      <p className="lead">One wallet for Bitcoin and Ethereum. No seed phrase: your face or fingerprint, plus a recovery kit you keep.</p>

      <ul className="perks">
        <li>
          <span className="perk-icon">
            <Fingerprint />
          </span>
          <div>
            <strong>Sign with Face ID</strong>
            <span>Your phone holds one of three key shares. The full key never exists anywhere.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Shield />
          </span>
          <div>
            <strong>Swissquote can never act alone</strong>
            <span>It holds one share: it can check and co-sign, but not move or freeze your funds.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Users />
          </span>
          <div>
            <strong>Lose your phone, not your money</strong>
            <span>Your recovery kit plus an identity check bring the wallet back, with the same addresses.</span>
          </div>
        </li>
      </ul>

      <form className="create-form" onSubmit={submit}>
        <label className="field">
          Your name
          <div className="input-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anna Muster" autoComplete="name" maxLength={60} disabled={busy} />
          </div>
        </label>
        <button className="primary big" disabled={busy || trimmed.length < 2}>
          {busy ? (progress ?? 'Working…') : 'Create my wallet'}
        </button>
      </form>
      {error && <p className="error center">{error}</p>}

      <div className="divider">
        <span>Already have a wallet?</span>
      </div>
      <button className="secondary big with-icon" onClick={onLogin} disabled={busy}>
        <Fingerprint /> Log in with my passkey
      </button>
      <button className="text-btn" onClick={onRecover} disabled={busy}>
        Lost your phone and passkey? Recover with your kit
      </button>
    </section>
  )
}
