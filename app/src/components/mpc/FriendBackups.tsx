import { useCallback, useEffect, useRef, useState } from 'react'
import { EXPLORER } from '../../config'
import { short } from '../../lib/format'
import { giveBack, heldPieces, inboxStatus, parseGiveBack, registerInbox, safetyCode, type HeldPiece, type InboxStatus } from '../../mpc/backup'
import type { PhoneWallet } from '../../mpc/store'
import { Copy, External } from '../icons'

/**
 * The friend's side of the on-chain backup: publish an inbox key (signed by this wallet), see whose
 * pieces this phone holds, and give a piece back when a friend sends a #give-back link.
 */
export function FriendBackups({ wallet, onToast }: { wallet: PhoneWallet; onToast: (m: string) => void }) {
  const [status, setStatus] = useState<InboxStatus | 'loading'>('loading')
  const [held, setHeld] = useState<HeldPiece[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<Uint8Array | null>(() => parseGiveBack(location.hash))
  const [code, setCode] = useState('')
  const [given, setGiven] = useState<Record<string, string>>({})
  const card = useRef<HTMLElement>(null)

  const refresh = useCallback(async () => {
    const next = await inboxStatus(wallet)
    setStatus(next)
    if (next === 'ready') setHeld(await heldPieces(wallet))
  }, [wallet])

  useEffect(() => {
    const load = () => refresh().catch(() => setError('Could not read Base Sepolia. Retrying…'))
    load()
    const timer = setInterval(load, 20_000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const onHash = () => setRequest(parseGiveBack(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!request) return
    safetyCode(request).then(setCode)
    card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [request])

  async function turnOn() {
    setBusy(true)
    setError('')
    try {
      await registerInbox(wallet)
      await refresh()
      onToast('You can now hold backups for friends')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function give(piece: HeldPiece) {
    if (!request) return
    setBusy(true)
    setError('')
    try {
      const { hash } = await giveBack(piece, request, wallet.name)
      setGiven((g) => ({ ...g, [piece.setId]: hash }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function closeRequest() {
    history.replaceState(null, '', location.pathname + location.search)
    setRequest(null)
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.evmAddress)
      onToast('Backup address copied')
    } catch {
      onToast('Could not copy, select the address manually')
    }
  }

  const current = held.filter((p) => p.current && p.complete)

  return (
    <section className="card friend-backups" ref={card}>
      <div className="card-head">
        <h2>Backups for friends</h2>
        <span className="pill soon">On chain</span>
      </div>

      {request && (
        <div className="give-back">
          <h3>A friend asks for their piece back</h3>
          <p className="kit-note">
            Safety code <strong className="safety-code">{code}</strong>. Only give a piece back if your friend asked you themselves: call
            them and check that their phone shows the same code.
          </p>
          {status === 'loading' ? (
            <p className="muted small">Reading Base Sepolia…</p>
          ) : current.length === 0 ? (
            <p className="muted small">This phone holds no current backup pieces.</p>
          ) : (
            current.map((p) =>
              given[p.setId] ? (
                <p key={p.setId} className="given">
                  Given back to {p.name ?? short(p.wallet)} ✓{' '}
                  <a href={`${EXPLORER}/tx/${given[p.setId]}`} target="_blank" rel="noreferrer">
                    View on BaseScan <External />
                  </a>
                </p>
              ) : (
                <button key={p.setId} className="primary big" onClick={() => give(p)} disabled={busy}>
                  {busy ? 'Giving back…' : `Give ${p.name ?? short(p.wallet)} the piece back`}
                </button>
              ),
            )
          )}
          <button className="text-btn" onClick={closeRequest}>
            {Object.keys(given).length ? 'Close' : 'Not now'}
          </button>
        </div>
      )}

      {status === 'loading' && !request && <p className="muted small">Reading Base Sepolia…</p>}

      {(status === 'off' || status === 'other-device') && (
        <>
          <p className="muted small">
            Friends can keep an encrypted piece of their recovery kit with you, stored on Base Sepolia. You can only read your own piece, and
            it is useless without your friend's kit password. Swissquote pays the network fees.
          </p>
          {status === 'other-device' && (
            <p className="kit-note">Your backup inbox belongs to another device. Turning it on here replaces it: pieces sent to the old one can no longer be given back from here.</p>
          )}
          <button className="secondary big" onClick={turnOn} disabled={busy}>
            {busy ? 'Confirm with Face ID…' : 'Hold backups for friends'}
          </button>
        </>
      )}

      {status === 'ready' && (
        <>
          <p className="muted small">Your backup address. Give it to friends who want you to hold a piece of their kit:</p>
          <button className="address-chip" onClick={copyAddress}>
            <code>{wallet.evmAddress}</code> <Copy />
          </button>
          {held.length === 0 ? (
            <p className="muted small">You hold no pieces yet.</p>
          ) : (
            <ul className="piece-list">
              {held.map((p) => (
                <li key={p.setId} className={p.current ? 'piece-row done' : 'piece-row'}>
                  <span>
                    Piece {p.piece} of {p.of} for {p.name ?? short(p.wallet)}
                  </span>
                  <span className={p.current ? 'pill ok' : 'pill'}>{p.current ? (p.complete ? 'current' : 'uploading') : 'replaced'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}
    </section>
  )
}
