import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { formatDuration } from '../lib/format'
import { cancelCall, readRecovery } from '../recovery'
import { explainError, sendCalls, type SmartAccount } from '../wallet'
import { Fingerprint, Spinner } from './icons'

/** The owner's veto: warns about a recovery in progress and lets any current passkey cancel it. */
export function PendingRecoveryAlert({ account, onCancelled }: { account: SmartAccount; onCancelled: () => void }) {
  const [executeAfter, setExecuteAfter] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let stop = false
    const poll = () =>
      readRecovery(account.address as Address).then(
        (s) => !stop && setExecuteAfter(s.pending?.executeAfter ?? null),
        () => {},
      )
    poll()
    const timers = [setInterval(poll, 8000), setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)]
    return () => {
      stop = true
      timers.forEach(clearInterval)
    }
  }, [account])

  if (executeAfter === null) return null

  async function cancel() {
    setBusy(true)
    setError('')
    try {
      await sendCalls(account, [cancelCall()])
      setExecuteAfter(null)
      onCancelled()
    } catch (e) {
      setError(explainError(e))
    } finally {
      setBusy(false)
    }
  }

  const left = executeAfter - now
  return (
    <section className="alert danger big" role="alert">
      <strong>Someone is moving this wallet to a new phone</strong>
      <span>
        {left > 0
          ? `Your guardians approved a new passkey. It takes over in ${formatDuration(left)}.`
          : 'The waiting period is over. The new passkey can take over at any moment.'}{' '}
        If this is not you, cancel now.
      </span>
      <button className="primary with-icon" onClick={cancel} disabled={busy}>
        {busy ? <Spinner /> : <Fingerprint />} {busy ? 'Cancelling…' : 'This is not me · Cancel'}
      </button>
      {error && <span className="error small">{error}</span>}
    </section>
  )
}
