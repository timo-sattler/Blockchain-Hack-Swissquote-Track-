import { useState } from 'react'
import { createPasskey, explainError, type StoredPasskey } from '../wallet'
import { Fingerprint, Shield, Users } from './icons'

export function Onboarding({ clientName, onCreated }: { clientName: string; onCreated: (p: StoredPasskey) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    try {
      onCreated(await createPasskey(`Swissquote Wallet – ${clientName}`))
    } catch (e) {
      setError(explainError(e))
      setBusy(false)
    }
  }

  return (
    <section className="onboarding">
      <div className={`orb ${busy ? 'busy' : ''}`}>
        <span className="ring" />
        <span className="ring delay" />
        <Fingerprint width="56" height="56" strokeWidth="1.4" />
      </div>
      <p className="eyebrow">Hi {clientName.split(' ')[0]} 👋</p>
      <h1>
        Your keys.
        <br />
        <span className="accent-text">Your control.</span>
      </h1>
      <p className="lead">
        A self-custody wallet that feels like your banking app. No seed phrase to write down. Just your face or
        fingerprint.
      </p>

      <ul className="perks">
        <li>
          <span className="perk-icon">
            <Fingerprint />
          </span>
          <div>
            <strong>Sign with Face ID</strong>
            <span>Your key lives in your phone's secure chip and never leaves it.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Shield />
          </span>
          <div>
            <strong>Only you can move funds</strong>
            <span>Not even Swissquote. The blockchain enforces it.</span>
          </div>
        </li>
        <li>
          <span className="perk-icon">
            <Users />
          </span>
          <div>
            <strong>Lose your phone, not your money</strong>
            <span>Recover with guardians you choose. Coming next.</span>
          </div>
        </li>
      </ul>

      <button className="primary big" onClick={create} disabled={busy}>
        {busy ? 'Waiting for your passkey…' : 'Create my wallet'}
      </button>
      {error && <p className="error center">{error}</p>}
      <p className="fineprint">Takes about 5 seconds · Base Sepolia testnet</p>
    </section>
  )
}
