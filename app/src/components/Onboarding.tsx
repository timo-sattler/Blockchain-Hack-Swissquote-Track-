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
}: {
  busy: boolean
  progress?: string
  error?: string
  onCreate: (name: string) => void
  onLogin: () => void
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
      <p className="lead">One wallet for Bitcoin and Ethereum. No seed phrase: one key in two parts, one on your devices (Face ID), one at Swissquote.</p>

      <ul className="perks">
        <li>
          <span className="perk-icon">
            <Fingerprint />
          </span>
          <div>
            <strong>Sign with Face ID</strong>
            <span>Your device holds your part of the key. Every payment needs it plus Swissquote's part; the full key never exists anywhere.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Shield />
          </span>
          <div>
            <strong>Safer and free with Swissquote</strong>
            <span>It blocks payments to malicious addresses and pays the network fee. It can never move your money alone.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Users />
          </span>
          <div>
            <strong>A copy on your other devices</strong>
            <span>Add a phone or second laptop with its own Face ID. If Swissquote is ever gone, you get full control after a grace period.</span>
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
      <p className="muted small center">Your wallet is on another device? Tap “Add a device” there and open the link on this one.</p>
    </section>
  )
}
