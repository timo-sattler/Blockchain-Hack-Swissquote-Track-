import { useState, type FormEvent } from 'react'
import { backupAvailable } from '../../mpc/backup'
import { combineKitPieces, decryptKit, type Kit } from '../../mpc/kit'
import { FriendsRecovery } from './FriendsRecovery'

/** Load the recovery kit file and unlock it with its password. */
export function KitPicker({
  onUnlocked,
  submitLabel = 'Unlock kit',
  offerFriends = false,
}: {
  onUnlocked: (kit: Kit) => void
  submitLabel?: string
  /** Recovery only: friends who hold an on-chain backup give their pieces back. */
  offerFriends?: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [usePieces, setUsePieces] = useState(false)
  const [pieces, setPieces] = useState<File[]>([])
  const [askFriends, setAskFriends] = useState(false)

  if (askFriends) return <FriendsRecovery onUnlocked={onUnlocked} onBack={() => setAskFriends(false)} />

  async function submitPieces(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onUnlocked(await combineKitPieces(await Promise.all(pieces.map((p) => p.text())), password))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (usePieces)
    return (
      <form className="send-form" onSubmit={submitPieces}>
        <label className="field">
          Pieces from 2 trusted people
          <input type="file" accept="application/json,.json,text/plain,.txt" multiple onChange={(e) => setPieces([...(e.target.files ?? [])])} />
        </label>
        <label className="field">
          Your kit password
          <div className="input-row">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </label>
        <p className="muted small">Select both piece files at once. Any 2 of the 3 pieces give back your kit, locked with the password only you know.</p>
        {error && <p className="error small">{error}</p>}
        <button className="primary big" disabled={pieces.length < 2 || !password || busy}>
          {busy ? 'Rebuilding kit…' : submitLabel}
        </button>
        <button type="button" className="text-btn" onClick={() => (setUsePieces(false), setError(''))}>
          I have my kit file
        </button>
      </form>
    )

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
        <input type="file" accept="application/json,.json,text/plain,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
      <button type="button" className="text-btn" onClick={() => (setUsePieces(true), setError(''))}>
        Lost your kit? Use pieces from 2 trusted people
      </button>
      {offerFriends && backupAvailable && (
        <button type="button" className="text-btn" onClick={() => (setAskFriends(true), setError(''))}>
          Lost your kit? Ask friends who hold it on chain
        </button>
      )}
    </form>
  )
}
