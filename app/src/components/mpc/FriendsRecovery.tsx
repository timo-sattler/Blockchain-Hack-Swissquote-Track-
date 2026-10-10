import { useEffect, useState, type FormEvent } from 'react'
import { bestSet, clearPieceRequest, pieceRequest, rebuildKitFromChain, requestLink, returnedPieces, safetyCode, type ReturnedPiece } from '../../mpc/backup'
import type { Kit } from '../../mpc/kit'

/**
 * New phone, kit lost too: send friends a link with this phone's one-time key. Their apps give the
 * pieces back on-chain, encrypted to that key; 2 pieces + the kit password rebuild the kit.
 */
export function FriendsRecovery({ onUnlocked, onBack }: { onUnlocked: (kit: Kit) => void; onBack: () => void }) {
  const [request, setRequest] = useState<Awaited<ReturnType<typeof pieceRequest>> | null>(null)
  const [link, setLink] = useState('')
  const [code, setCode] = useState('')
  const [returned, setReturned] = useState<ReturnedPiece[]>([])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    pieceRequest().then(async (r) => {
      setRequest(r)
      setLink(requestLink(r.publicRaw))
      setCode(await safetyCode(r.publicRaw))
    })
  }, [])

  useEffect(() => {
    if (!request) return
    let stopped = false
    const poll = () => returnedPieces(request).then((list) => !stopped && setReturned(list), () => {})
    poll()
    const timer = setInterval(poll, 4000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [request])

  const best = bestSet(returned)
  const count = best?.pieces.length ?? 0
  const threshold = best?.threshold ?? 2

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the link and copy it manually.')
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: 'Please give back my Swissquote backup piece', text: `My safety code is ${code}.`, url: link })
    } catch {
      // cancelled
    }
  }

  async function rebuild(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const kit = await rebuildKitFromChain(returned, password)
      clearPieceRequest()
      onUnlocked(kit)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="send-form friends-recovery">
      <p className="muted small">
        Send this link to the friends who hold your backup. When they open it in their Swissquote app, they can give their piece back to
        this phone, on Base Sepolia.
      </p>
      <code className="request-link">{link || 'Creating a one-time key…'}</code>
      <div className="piece-actions">
        <button type="button" className="secondary" onClick={copy} disabled={!link}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {typeof navigator.share === 'function' && (
          <button type="button" className="secondary" onClick={shareLink} disabled={!link}>
            Send…
          </button>
        )}
      </div>
      <p className="kit-note">
        Safety code <strong className="safety-code">{code}</strong>. Your friends see the same code: tell it to them on the phone, so they
        know the request really comes from you.
      </p>
      <p className="pieces-back">
        <strong>
          {count} of {threshold}
        </strong>{' '}
        pieces back
        {best && best.pieces.some((p) => p.from) ? ` · from ${best.pieces.map((p) => p.from ?? `friend ${p.piece}`).join(', ')}` : ''}
        {count < threshold && <span className="muted"> · waiting for your friends…</span>}
      </p>
      {count >= threshold && (
        <form onSubmit={rebuild}>
          <label className="field">
            Your kit password
            <div className="input-row">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </label>
          <button className="primary big" disabled={!password || busy}>
            {busy ? 'Rebuilding your kit…' : 'Rebuild my kit'}
          </button>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
      <button type="button" className="text-btn" onClick={onBack}>
        I have my kit file
      </button>
    </div>
  )
}
