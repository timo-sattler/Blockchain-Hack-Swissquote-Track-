import { useState } from 'react'
import { describePasskeyError, joinDevice, type DeviceLink } from '../../mpc/flows'
import type { PhoneWallet } from '../../mpc/store'
import { Fingerprint } from '../icons'

function guessName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'Another device'
}

/** Opened from the "Add a device" link: this device gets its own passkey and a copy of the key part. */
export function JoinDevice({ link, replacesWallet, onJoined, onCancel }: { link: DeviceLink; replacesWallet: boolean; onJoined: (w: PhoneWallet) => void; onCancel: () => void }) {
  const [name, setName] = useState(guessName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function join() {
    setBusy(true)
    setError('')
    try {
      onJoined(await joinDevice(link, name.trim() || guessName()))
    } catch (e) {
      setError(describePasskeyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card join-device">
      <div className="card-head">
        <h2>Add this device to your wallet</h2>
        <span className="pill soon">Your key part</span>
      </div>
      <p className="muted small">
        This device creates its own passkey (Face ID / fingerprint) and receives an identical copy of your key part. Every payment still needs
        Swissquote's part too.
      </p>
      {replacesWallet && <p className="kit-note">This device already holds another wallet. Adding it here replaces that wallet on this device.</p>}
      <label className="field">
        Device name
        <div className="input-row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={busy} />
        </div>
      </label>
      <button className="primary big with-icon" onClick={join} disabled={busy}>
        <Fingerprint /> {busy ? 'Adding this device…' : 'Create passkey and add this device'}
      </button>
      {error && <p className="error small">{error}</p>}
      <button className="text-btn" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </section>
  )
}
