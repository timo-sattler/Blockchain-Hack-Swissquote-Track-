import { useState, type FormEvent } from 'react'
import { download, encryptKit, type Kit } from '../../mpc/kit'
import { Shield } from '../icons'

/**
 * Anyone who copies the kit file can try passwords offline as fast as their hardware allows, so the
 * password must be long: 12+ characters mixing at least three kinds, or a passphrase of 16+.
 */
export function passwordProblem(password: string): string | null {
  if (password.length >= 16) return null
  if (password.length < 12) return 'Use at least 12 characters, or a passphrase of 16+ (e.g. four random words).'
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  return kinds >= 3 ? null : 'Mix at least three of: lowercase, uppercase, digits, symbols. Or use 16+ characters.'
}

/** Share C leaves the phone only as a password-encrypted file the client keeps (cloud drive, USB stick). */
export function KitBackup({ kit, title, replacesOldKit = false, onSaved }: { kit: Kit; title: string; replacesOldKit?: boolean; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = password ? passwordProblem(password) : null
  const mismatch = repeat.length > 0 && repeat !== password
  const ok = password.length > 0 && !problem && repeat === password

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
      {replacesOldKit && (
        <p className="notice warn small">
          <strong>Delete your old kit file.</strong> It no longer works with Swissquote, but together with your old phone it could still
          sign. Keep only this new one.
        </p>
      )}
      <p className="muted small">
        Your recovery kit is the third key share. With it you can sign without Swissquote, and recover the wallet if you lose your phone.
      </p>
      <p className="muted small">
        <strong>Where to keep it:</strong> a USB stick, a password manager, or a cloud drive that is <em>not</em> the account your passkey
        syncs to (e.g. not iCloud if your passkey is in iCloud Keychain). Write the password down somewhere else.
      </p>
      <form className="send-form" onSubmit={submit}>
        <label className="field">
          Kit password
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
        {password && (problem || mismatch) ? (
          <p className="error small">{problem ?? 'Passwords do not match.'}</p>
        ) : password && !problem ? (
          <p className="success small">Strong enough.</p>
        ) : null}
        <button className="primary big with-icon" disabled={!ok || busy}>
          <Shield /> Encrypt and download kit
        </button>
      </form>
    </section>
  )
}
