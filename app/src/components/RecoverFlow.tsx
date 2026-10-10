import { useEffect, useState, type ReactNode } from 'react'
import type { Address, Hex } from 'viem'
import { formatDuration, short } from '../lib/format'
import {
  decodeApproval,
  executeCall,
  parseRecoveryKit,
  readRecovery,
  requestLink,
  signWithKit,
  splitPublicKey,
  startCall,
  swissquote,
  verifyApproval,
  type Approval,
  type RecoveryRequest,
  type RecoveryState,
} from '../recovery'
import { CLIENT } from '../sq/mockData'
import { createPasskey, explainError, getAccount, savePasskey, sendCalls, type Call, type StoredPasskey } from '../wallet'
import { Bank, Check, Fingerprint, Spinner, Users } from './icons'

// Survives a page reload mid-recovery. The recovery kit key is deliberately not stored.
type Progress = {
  account: Address
  passkey?: StoredPasskey
  request?: RecoveryRequest
  approvals: (Approval & { by: Guardian })[]
  started?: boolean
  seenPending?: boolean
}
type Guardian = 'kit' | 'swissquote' | 'contact'

const PROGRESS_KEY = 'sq-wallet:recovery-progress'
const APPROVAL_LIFETIME = 24 * 60 * 60

function loadProgress(): Progress | null {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null')
  } catch {
    return null
  }
}

function saveProgress(progress: Progress | null) {
  try {
    if (progress) localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
    else localStorage.removeItem(PROGRESS_KEY)
  } catch {
    // Without storage the flow still works, it just cannot resume after a reload.
  }
}

export function RecoverFlow({ onRecovered, onCancel }: { onRecovered: (p: StoredPasskey) => void; onCancel: () => void }) {
  const [progress, setProgressState] = useState<Progress | null>(loadProgress)
  const [state, setState] = useState<RecoveryState | null>(null)
  const [kitKey, setKitKey] = useState<Hex | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const setProgress = (next: Progress | null) => {
    setProgressState(next)
    saveProgress(next)
  }

  useEffect(() => {
    if (!progress) return
    let stop = false
    const poll = () => readRecovery(progress.account).then((s) => !stop && setState(s), () => {})
    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [progress?.account])

  // Remember once our own recovery has been seen pending on-chain (see the cancelled check below).
  useEffect(() => {
    const p = state?.pending
    const r = progress?.request
    if (p && r && p.x === r.x && p.y === r.y && !progress.seenPending) setProgress({ ...progress, seenPending: true })
  }, [state])

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await task()
    } catch (e) {
      setError(explainError(e))
    } finally {
      setBusy('')
    }
  }

  async function chooseAccount(account: Address, key: Hex | null) {
    const s = await readRecovery(account)
    if (!s.enabled) throw new Error(`Recovery is not set up for wallet ${short(account)}.`)
    setState(s)
    setKitKey(key)
    setProgress({ account, approvals: [] })
  }

  const loadKit = (text: string) =>
    run('kit', async () => {
      const { account, privateKey } = parseRecoveryKit(text)
      await chooseAccount(account, privateKey)
    })

  const findViaSwissquote = () =>
    run('lookup', async () => {
      const { accounts } = await swissquote.lookup(CLIENT.tradingAccount)
      if (accounts.length === 0) throw new Error('No wallet is linked to your Swissquote profile.')
      await chooseAccount(accounts[accounts.length - 1], null)
    })

  const newPasskey = () =>
    run('passkey', async () => {
      const passkey = await createPasskey(`Swissquote Wallet – ${CLIENT.name}`)
      const s = await readRecovery(progress!.account)
      const request = {
        account: progress!.account,
        ...splitPublicKey(passkey.publicKey),
        nonce: s.nonce.toString(),
        deadline: Math.floor(Date.now() / 1000) + APPROVAL_LIFETIME,
      }
      setProgress({ ...progress!, passkey, request, approvals: [] })
    })

  async function addApproval(by: Guardian, approval: Approval) {
    await verifyApproval(progress!.request!, approval, state!.guardians)
    const others = progress!.approvals.filter((a) => a.signer !== approval.signer)
    setProgress({ ...progress!, approvals: [...others, { ...approval, by }] })
  }

  // The new passkey's own fresh smart account submits the transactions (gas sponsored when available).
  async function submit(call: Call) {
    const submitter = await getAccount({ id: progress!.passkey!.id, publicKey: progress!.passkey!.publicKey })
    try {
      await sendCalls(submitter, [call])
    } catch (e) {
      if (/AA21|prefund|insufficient funds/i.test(String(e)))
        throw new Error(`No gas sponsor available. Send a little Base Sepolia ETH to ${submitter.address} (this phone's helper account), then try again.`)
      throw e
    }
  }

  const start = () =>
    run('start', async () => {
      await submit(startCall(progress!.request!, progress!.approvals))
      setProgress({ ...progress!, started: true })
      setState(await readRecovery(progress!.account))
    })

  const finish = () =>
    run('finish', async () => {
      await submit(executeCall(progress!.account))
      const recovered = { ...progress!.passkey!, account: progress!.account }
      savePasskey(recovered)
      setProgress(null)
      onRecovered(recovered)
    })

  function abandon() {
    setProgress(null)
    onCancel()
  }

  // ---------------------------------------------------------------- step 1: which wallet?
  if (!progress)
    return (
      <section className="recover">
        <h2>Recover your wallet</h2>
        <p className="muted">First, tell us which wallet. Your funds are safe on the blockchain.</p>
        <div className="options">
          <label className="option">
            <span className="option-icon">
              <Fingerprint />
            </span>
            <div>
              <strong>Use my recovery kit</strong>
              <span>Open the file you saved, or paste its text</span>
            </div>
            <input
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) loadKit(await file.text())
              }}
            />
          </label>
          <button className="option" onClick={findViaSwissquote} disabled={!!busy}>
            <span className="option-icon">
              <Bank />
            </span>
            <div>
              <strong>Log in to Swissquote</strong>
              <span>
                Find the wallet linked to client {CLIENT.tradingAccount} <span className="badge mock">MOCK login</span>
              </span>
            </div>
          </button>
        </div>
        <textarea
          className="code-input"
          placeholder="…or paste your recovery kit here"
          rows={3}
          onChange={(e) => e.target.value.includes('Recovery key:') && loadKit(e.target.value)}
        />
        {busy && <p className="loading"><Spinner /> Looking up your wallet…</p>}
        {error && <p className="error center">{error}</p>}
        <button className="text-btn" onClick={abandon}>
          Back
        </button>
      </section>
    )

  const { account, passkey, request, approvals, started } = progress
  const threshold = state?.threshold ?? 2
  const pending = state?.pending
  const pendingIsOurs = !!(pending && request && pending.x === request.x && pending.y === request.y)

  // ---------------------------------------------------------------- step 2: new passkey
  if (!passkey || !request)
    return (
      <section className="recover">
        <StepHeader account={account} step={1} />
        <h2>Create a passkey on this phone</h2>
        <p className="muted">It will replace the passkey on your lost phone, which stops working once recovery completes.</p>
        <button className="primary big with-icon" onClick={newPasskey} disabled={!!busy}>
          {busy ? <Spinner /> : <Fingerprint />} Create new passkey
        </button>
        {error && <p className="error center">{error}</p>}
        <button className="text-btn" onClick={abandon}>
          Cancel recovery
        </button>
      </section>
    )

  // ---------------------------------------------------------------- step 4: time-lock
  if (started || pendingIsOurs) {
    // Only call it cancelled after seeing it pending: right after starting, an RPC node may still lag.
    if (progress.seenPending && state && !pending)
      return (
        <section className="recover">
          <div className="alert danger">
            <strong>Recovery was cancelled</strong>
            <span>A device that still holds the wallet's passkey stopped it. If that was not you, contact Swissquote.</span>
          </div>
          <button className="primary big" onClick={abandon}>
            Start over
          </button>
        </section>
      )
    return (
      <section className="recover">
        <StepHeader account={account} step={3} />
        <Countdown executeAfter={pending?.executeAfter ?? null} onFinish={finish} busy={busy === 'finish'} />
        {error && <p className="error center">{error}</p>}
      </section>
    )
  }

  // ---------------------------------------------------------------- step 3: approvals
  const has = (by: Guardian) => approvals.some((a) => a.by === by)
  const guardianCount = state?.guardians.length ?? 3
  const contactCount = Math.max(1, guardianCount - 2) // everyone besides the kit and Swissquote
  const contactApprovals = approvals.filter((a) => a.by === 'contact').length
  return (
    <section className="recover">
      <StepHeader account={account} step={2} />
      <h2>
        Get {threshold} of {guardianCount} approvals <span className="pill ok">{approvals.length} / {threshold}</span>
      </h2>

      <ul className="approvals">
        <ApprovalCard icon={<Fingerprint />} title="Your recovery kit" done={has('kit')}>
          {kitKey ? (
            <button
              className="chip"
              disabled={!!busy}
              onClick={() => run('kit', async () => addApproval('kit', await signWithKit(kitKey, request)))}
            >
              Approve with kit
            </button>
          ) : (
            <label className="chip">
              Open kit file
              <input
                type="file"
                accept=".txt,text/plain"
                className="sr-only"
                onChange={(e) =>
                  run('kit', async () => {
                    const kit = parseRecoveryKit((await e.target.files?.[0]?.text()) ?? '')
                    if (kit.account !== account) throw new Error('This kit belongs to a different wallet.')
                    setKitKey(kit.privateKey)
                    await addApproval('kit', await signWithKit(kit.privateKey, request))
                  })
                }
              />
            </label>
          )}
        </ApprovalCard>

        <ApprovalCard icon={<Bank />} title="Swissquote" done={has('swissquote')}>
          <IdentityCheck account={account} request={request} onApproved={(a) => addApproval('swissquote', a)} />
        </ApprovalCard>

        <ApprovalCard
          icon={<Users />}
          title={contactCount > 1 ? `People you trust · ${contactApprovals} of ${contactCount} approved` : 'Your trusted contact'}
          done={contactApprovals >= contactCount || (contactApprovals > 0 && approvals.length >= threshold)}
        >
          <ContactApproval request={request} several={contactCount > 1} onApproved={(a) => addApproval('contact', a)} />
        </ApprovalCard>
      </ul>

      {error && <p className="error center">{error}</p>}
      <button className="primary big" disabled={approvals.length < threshold || !!busy} onClick={start}>
        {busy === 'start' ? 'Starting…' : `Start recovery (${formatDuration(state?.delay ?? 0)} waiting period)`}
      </button>
      <button className="text-btn" onClick={abandon}>
        Cancel recovery
      </button>
    </section>
  )
}

function StepHeader({ account, step }: { account: Address; step: 1 | 2 | 3 }) {
  return (
    <div className="step-header">
      <span className="badge">Wallet {short(account)}</span>
      <ol className="steps" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <li key={n} className={n < step ? 'done' : n === step ? 'active' : ''} />
        ))}
      </ol>
    </div>
  )
}

function ApprovalCard({ icon, title, done, children }: { icon: ReactNode; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className={done ? 'done' : ''}>
      <span className="control-icon">{icon}</span>
      <div className="approval-body">
        <strong>{title}</strong>
        {done ? (
          <span className="pill ok">
            <Check width="11" height="11" strokeWidth="3" /> Approved
          </span>
        ) : (
          children
        )}
      </div>
    </li>
  )
}

/**
 * MOCK identity check in front of the Swissquote guardian. The policy is enforced by the guardian
 * service, not here: it refuses unless the ID document and face match, whatever else is presented.
 */
function IdentityCheck({ account, request, onApproved }: { account: Address; request: RecoveryRequest; onApproved: (a: Approval) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')

  async function verify(asAttacker: boolean) {
    setBusy(true)
    setRefusal('')
    try {
      const { session } = await swissquote.verifyIdentity({
        clientId: CLIENT.tradingAccount,
        account,
        // The attacker has the stolen phone (SMS) and the hacked email, but not the client's face.
        checks: { emailOtp: true, smsOtp: true, idDocument: !asAttacker, faceMatch: !asAttacker },
      })
      await onApproved(await swissquote.approve(session, request))
    } catch (e) {
      setRefusal(explainError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span className="muted small">Email + SMS code, then ID document and a live selfie</span>
      <div className="chips">
        <button className="chip" disabled={busy} onClick={() => verify(false)}>
          {busy ? 'Checking…' : 'Scan my ID and face'}
        </button>
        <button className="chip danger" disabled={busy} onClick={() => verify(true)}>
          Simulate attacker
        </button>
      </div>
      {refusal && <p className="refusal">⛔ {refusal}</p>}
    </>
  )
}

function ContactApproval({
  request,
  several,
  onApproved,
}: {
  request: RecoveryRequest
  several: boolean
  onApproved: (a: Approval) => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const link = requestLink(request, CLIENT.name)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      window.prompt('Copy this link and send it to your contact', link)
    }
  }

  async function submit(value: string) {
    setCode(value)
    setError('')
    if (!value.trim().startsWith('SQA-')) return
    try {
      await onApproved(decodeApproval(value))
      setCode('') // ready for the next person's code
    } catch (e) {
      setError(explainError(e))
    }
  }

  return (
    <>
      <span className="muted small">
        {several
          ? 'Send the same link to each of them. They call you, approve, and send back a code'
          : 'Send them a link. They call you, approve, and send back a code'}
      </span>
      <div className="chips">
        <button className="chip" onClick={copy}>
          {copied ? 'Link copied' : 'Copy request link'}
        </button>
        <a className="chip" href={link} target="_blank" rel="noreferrer">
          Open as contact
        </a>
      </div>
      <input
        className="code-input"
        value={code}
        onChange={(e) => submit(e.target.value)}
        placeholder="Paste their approval code (SQA-…)"
        spellCheck={false}
      />
      {error && <p className="error small">{error}</p>}
    </>
  )
}

function Countdown({ executeAfter, onFinish, busy }: { executeAfter: number | null; onFinish: () => void; busy: boolean }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  // A few seconds of margin so the block timestamp has also passed the deadline.
  const left = executeAfter === null ? null : Math.max(0, executeAfter + 3 - now)
  return (
    <div className="countdown">
      <h2>Waiting period</h2>
      <p className="countdown-time">{left === null ? '…' : formatClock(left)}</p>
      <p className="muted">
        Your guardians approved. If anyone still has your old phone, it now shows a warning and can cancel. Swissquote
        has notified you on every channel.
      </p>
      <button className="primary big with-icon" disabled={left !== 0 || busy} onClick={onFinish}>
        {busy ? <Spinner /> : <Fingerprint />} {busy ? 'Finishing…' : 'Finish recovery'}
      </button>
    </div>
  )
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${s.toString().padStart(2, '0')}`
}
