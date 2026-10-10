import { useState, type FormEvent } from 'react'
import { download, encryptKit, type Kit } from '../../mpc/kit'
import { Shield } from '../icons'

/** Share C leaves the phone only as a password-encrypted file the client keeps (cloud drive, USB stick). */
export function KitBackup({ kit, title, onSaved }: { kit: Kit; title: string; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const tooShort = password.length > 0 && password.length < 8
  const mismatch = repeat.length > 0 && repeat !== password

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    download(await encryptKit(kit, password), `swissquote-recovery-kit-${kit.walletId.slice(0, 8)}.json`)
    setBusy(false)
    onSaved()
  }

  return (
    <section className="card kit-backup">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="pill soon">Share C</span>
      </div>
      <p className="muted small">
        Your recovery kit is the third key share. With it you can sign without Swissquote, and recover the wallet if you lose your phone.
        Store the file in your iCloud / Google Drive or on a USB stick, and remember the password.
      </p>
      <form className="send-form" onSubmit={submit}>
        <label className="field">
          Kit password (min. 8 characters)
          <div className="input-row">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
        </label>
        <label className="field">
          Repeat password
          <div className="input-row">
            <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </div>
        </label>
        {(tooShort || mismatch) && <p className="error small">{tooShort ? 'Use at least 8 characters.' : 'Passwords do not match.'}</p>}
        <button className="primary big with-icon" disabled={password.length < 8 || repeat !== password || busy}>
          <Shield /> Encrypt and download kit
        </button>
      </form>
    </section>
  )
}
