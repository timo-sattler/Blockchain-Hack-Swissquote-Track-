import { Fingerprint, Shield, Users } from './icons'

export function Onboarding({
  clientName,
  busy,
  progress,
  error,
  onCreate,
  onRecover,
}: {
  clientName: string
  busy: boolean
  progress?: string
  error?: string
  onCreate: () => void
  onRecover: () => void
}) {
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

      <button className="primary big" onClick={onCreate} disabled={busy}>
        {busy ? (progress ?? 'Working…') : 'Create my wallet'}
      </button>
      {error && <p className="error center">{error}</p>}
      <button className="text-btn" onClick={onRecover} disabled={busy}>
        Lost your phone? Recover with your kit
      </button>
    </section>
  )
}
