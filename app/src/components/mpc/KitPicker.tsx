import { useState, type FormEvent } from 'react'
import { decryptKit, type Kit } from '../../mpc/kit'

/** Load the recovery kit file and unlock it with its password. */
export function KitPicker({ onUnlocked, submitLabel = 'Unlock kit' }: { onUnlocked: (kit: Kit) => void; submitLabel?: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onUnlocked(await decryptKit(await file.text(), password))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="send-form" onSubmit={submit}>
      <label className="field">
        Recovery kit file
        <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="field">
        Kit password
        <div className="input-row">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
      </label>
      {error && <p className="error small">{error}</p>}
      <button className="primary big" disabled={!file || !password || busy}>
        {busy ? 'Unlocking…' : submitLabel}
      </button>
    </form>
  )
}
