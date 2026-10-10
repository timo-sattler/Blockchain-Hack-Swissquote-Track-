import { useState, type FormEvent } from 'react'
import { backupAvailable } from '../../mpc/backup'
import { download, encryptKit, splitKitForTrustedPeople, type Kit } from '../../mpc/kit'
import { loadPhoneWallet } from '../../mpc/store'
import { Check, Shield } from '../icons'
import { OnchainBackup } from './OnchainBackup'

/** Phones (iOS Safari, Android Chrome) can hand a file straight to Mail or a messenger. */
function canShareFiles() {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['{}'], 'piece.txt', { type: 'text/plain' })] })
  } catch {
    return false
  }
}

/** Share C leaves the phone only as a password-encrypted file the client keeps (cloud drive, USB stick). */
export function KitBackup({ kit, title, note, onSaved }: { kit: Kit; title: string; note?: string; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pieces, setPieces] = useState<Blob[] | null>(null)
  const [handedOut, setHandedOut] = useState<number[]>([])
  const [canShare] = useState(canShareFiles)
  const allHandedOut = pieces !== null && handedOut.length === pieces.length
  const [onchain, setOnchain] = useState<'off' | 'form' | 'done'>('off')
  // On-chain backup needs this phone's wallet (phone + Swissquote sign it), so not for an escrow-recovered wallet.
  const [phone] = useState(() => {
    const w = loadPhoneWallet()
    return backupAvailable && w && !w.independent && w.evmAddress.toLowerCase() === kit.evmAddress.toLowerCase() ? w : null
  })
  const finished = allHandedOut || onchain === 'done'
  const tooShort = password.length > 0 && password.length < 8
  const mismatch = repeat.length > 0 && repeat !== password

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || password.length < 8 || repeat !== password) return
    setBusy(true)
    setError('')
    try {
      download(await encryptKit(kit, password), `swissquote-recovery-kit-${kit.walletId.slice(0, 8)}.json`)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your recovery kit. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function createPieces() {
    setBusy(true)
    setError('')
    try {
      setPieces(await splitKitForTrustedPeople(kit, password))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the pieces.')
    } finally {
      setBusy(false)
    }
  }

  const pieceName = (i: number) => `swissquote-kit-piece-${i + 1}-of-${pieces?.length ?? 3}-${kit.walletId.slice(0, 8)}.json`
  const handOut = (i: number) => setHandedOut((done) => (done.includes(i) ? done : [...done, i]))

  // One file per tap: browsers allow a single download per click and silently drop the rest.
  function savePiece(i: number) {
    if (!pieces) return
    download(pieces[i], pieceName(i))
    handOut(i)
  }

  async function sendPiece(i: number) {
    if (!pieces) return
    setError('')
    try {
      // Shared as .txt: Chrome only lets a short list of file types through the share sheet, and .json is not on it.
      const file = new File([pieces[i]], pieceName(i).replace(/\.json$/, '.txt'), { type: 'text/plain' })
      await navigator.share({ files: [file], title: `Swissquote kit piece ${i + 1}` })
      handOut(i)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('Sending did not work. Use Download instead.')
    }
  }

  if (saved)
    return (
      <section className="card kit-backup">
        <div className="card-head">
          <h2>Kit saved ✓</h2>
          <span className="pill soon">Share C</span>
        </div>
        <p className="muted small">
          <strong>Recommended:</strong> also split a backup among 3 people you trust. If you ever lose your phone <em>and</em> your kit,
          any 2 of them give you back their pieces, and <strong>your kit password</strong> opens the rebuilt kit. The pieces are locked
          with that password, which only you know: even two of them together cannot use them. A recovery also still needs your identity
          check and the waiting period.
        </p>
        {phone && onchain !== 'off' ? (
          <OnchainBackup wallet={phone} kit={kit} password={password} onDone={() => setOnchain('done')} onCancel={() => setOnchain('off')} />
        ) : pieces ? (
          <>
            <ul className="piece-list">
              {pieces.map((_, i) => (
                <li key={i} className={handedOut.includes(i) ? 'piece-row done' : 'piece-row'}>
                  <span>
                    Piece {i + 1} of {pieces.length} {handedOut.includes(i) && <Check className="piece-check" />}
                  </span>
                  <span className="piece-actions">
                    {canShare && (
                      <button className="secondary" onClick={() => sendPiece(i)}>
                        Send
                      </button>
                    )}
                    <button className="secondary" onClick={() => savePiece(i)}>
                      Download
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="kit-note">
              Give one piece to each person, for example by e-mail or messenger, and keep your kit password to yourself. Pieces stop
              working after a recovery or a kit replacement: you then create new ones.
            </p>
          </>
        ) : (
          <>
            {phone && (
              <button className="primary big" onClick={() => setOnchain('form')}>
                Send to friends' wallets (on chain)
              </button>
            )}
            <button className={phone ? 'secondary big' : 'primary big'} onClick={createPieces} disabled={busy}>
              {busy ? 'Creating pieces…' : 'Create 3 pieces for trusted people'}
            </button>
          </>
        )}
        {error && <p className="error small">{error}</p>}
        {onchain !== 'form' && (
          <button className={finished ? 'primary big' : 'text-btn'} onClick={onSaved}>
            {finished ? 'Done' : pieces ? `Done (${handedOut.length} of ${pieces.length} pieces saved)` : 'Skip for now'}
          </button>
        )}
      </section>
    )

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
      {note && <p className="kit-note">{note}</p>}
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
        {error && <p className="error small">{error}</p>}
        <button className="primary big with-icon" disabled={password.length < 8 || repeat !== password || busy}>
          <Shield /> Encrypt and download kit
        </button>
      </form>
    </section>
  )
}
