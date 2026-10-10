import { useEffect, useState, type FormEvent } from 'react'
import { isAddress, type Address } from 'viem'
import { EXPLORER } from '../../config'
import { backUpToFriends, friendReady, type BackupStage } from '../../mpc/backup'
import type { Kit } from '../../mpc/kit'
import type { PhoneWallet } from '../../mpc/store'
import { External } from '../icons'

const STAGE_TEXT: Record<BackupStage, string> = {
  locking: 'Locking your kit with your password…',
  auth: 'Confirm with Face ID…',
  writing: 'Writing to Base Sepolia (about 20 s)…',
}

/** The client's side: send one encrypted piece to each friend's wallet, and the locked kit, on-chain. */
export function OnchainBackup({ wallet, kit, password, onDone, onCancel }: { wallet: PhoneWallet; kit: Kit; password: string; onDone: () => void; onCancel: () => void }) {
  const [friends, setFriends] = useState(['', '', ''])
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const [stage, setStage] = useState<BackupStage | null>(null)
  const [hash, setHash] = useState('')
  const [error, setError] = useState('')

  const entered = friends.map((f) => f.trim()).filter(Boolean)
  const lower = entered.map((f) => f.toLowerCase())

  useEffect(() => {
    for (const address of entered)
      if (isAddress(address) && ready[address.toLowerCase()] === undefined)
        friendReady(address as Address).then(
          (ok) => setReady((r) => ({ ...r, [address.toLowerCase()]: ok })),
          () => {},
        )
  }, [entered.join(','), ready])

  function problem(address: string): string | null {
    const value = address.trim()
    if (!value) return null
    if (!isAddress(value)) return 'Not a valid 0x address'
    if (value.toLowerCase() === wallet.evmAddress.toLowerCase()) return 'That is your own wallet'
    if (lower.filter((a) => a === value.toLowerCase()).length > 1) return 'Entered twice'
    const ok = ready[value.toLowerCase()]
    if (ok === undefined) return 'Checking…'
    return ok ? null : 'Has not turned on "Hold backups for friends" yet'
  }

  const valid = entered.length >= 2 && entered.every((f) => !problem(f))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || stage) return
    setError('')
    try {
      const result = await backUpToFriends(wallet, kit, password, entered, setStage)
      setHash(result.hash)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStage(null)
    }
  }

  if (hash)
    return (
      <p className="kit-note onchain-done">
        <strong>Backed up on Base Sepolia ✓</strong> Each of your {entered.length} friends now sees a piece in their app. Any 2 pieces plus your
        kit password rebuild your kit.{' '}
        <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
          View on BaseScan <External />
        </a>
      </p>
    )

  return (
    <form className="send-form onchain-form" onSubmit={submit}>
      <p className="muted small">
        Enter the backup addresses of 2 or 3 friends (they find it under <em>Backups for friends</em> in their app). Each gets one piece,
        encrypted so only they can read it. Your kit is stored on-chain locked with your password. Swissquote pays the fees.
      </p>
      {friends.map((value, i) => {
        const issue = problem(value)
        return (
          <label key={i} className="field">
            Friend {i + 1}
            {i === 2 ? ' (optional)' : ''}
            <div className="input-row">
              <input
                value={value}
                onChange={(e) => setFriends((f) => f.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            {value.trim() && <span className={issue ? 'field-hint' : 'field-hint ok'}>{issue ?? '✓ Ready to hold your piece'}</span>}
          </label>
        )
      })}
      {error && <p className="error small">{error}</p>}
      <button className="primary big" disabled={!valid || !!stage}>
        {stage ? STAGE_TEXT[stage] : `Back up to ${Math.max(entered.length, 2)} friends on chain`}
      </button>
      <button type="button" className="text-btn" onClick={onCancel} disabled={!!stage}>
        Back
      </button>
    </form>
  )
}
