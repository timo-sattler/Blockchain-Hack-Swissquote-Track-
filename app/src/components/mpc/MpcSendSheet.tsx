import { useState, type FormEvent } from 'react'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { ServiceError } from '../../mpc/api'
import { isStablecoin, type Asset } from '../../mpc/chains'
import { describePasskeyError, send, type SendStage } from '../../mpc/flows'
import type { PhoneWallet } from '../../mpc/store'
import { Confetti } from '../Confetti'
import { Check, External, Fingerprint, Shield, Spinner } from '../icons'
import { Sheet } from '../Sheet'

export type SentTransfer = { hash: string; chain: 'bitcoin' | 'base'; asset: Asset; amount: string; to: string; at: number; viaKit: boolean; sponsored?: boolean }

type Step =
  | { name: 'form' }
  | { name: 'progress'; stage: SendStage }
  | { name: 'success'; transfer: SentTransfer }
  | { name: 'error'; message: string; swissquoteDown: boolean; needsConfirm: boolean }
  | { name: 'blocked'; to: string; reason: string; offline: boolean }

// Clearly fake addresses on the share service's mock blocklist, for showing the screening in a demo.
const DEMO_SCAM: Record<Asset, string> = {
  USDC: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0',
  EURC: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0',
  ETH: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0',
  BTC: 'tb1qh2at4w46h2at4w46h2at4w46h2at4w46jvgsm3',
}

const QUICK: Record<Asset, string[]> = { USDC: ['1', '5', '10'], EURC: ['1', '5', '10'], ETH: ['0.0001', '0.0005'], BTC: ['0.0001', '0.0005', '0.001'] }

export function MpcSendSheet({ wallet, onClose, onSent }: { wallet: PhoneWallet; onClose: () => void; onSent: (t: SentTransfer) => void }) {
  const [asset, setAsset] = useState<Asset>('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>({ name: 'form' })
  // After the grace period the device holds both parts and signs alone (no Swissquote, no screening by it).
  const alone = !!wallet.independent
  // USDC and EURC sent with Swissquote are gasless by default: the client needs no ETH at all.
  const [payFeeMyself, setPayFeeMyself] = useState(false)
  const gasless = isStablecoin(asset) && !alone && !payFeeMyself
  const busy = step.name === 'progress'

  async function run(confirmHighValue = false) {
    setStep({ name: 'progress', stage: alone ? 'signing' : 'auth' })
    try {
      const request = { asset, to: to.trim(), amount, confirmHighValue, gasless }
      const result = await send(wallet, request, (stage) => setStep({ name: 'progress', stage }))
      const transfer = { ...result, asset, amount, to: to.trim(), at: Date.now(), viaKit: alone }
      onSent(transfer)
      setStep({ name: 'success', transfer })
    } catch (e) {
      if (e instanceof ServiceError && e.details.blocked) return setStep({ name: 'blocked', to: to.trim(), reason: String(e.details.reason), offline: !!e.details.offline })
      const swissquoteDown = e instanceof ServiceError && (e.status === 0 || e.status >= 500)
      const needsConfirm = e instanceof ServiceError && e.status === 428
      setStep({ name: 'error', message: describePasskeyError(e), swissquoteDown, needsConfirm })
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (to.trim() && Number(amount) > 0) run()
  }

  const explorer = (t: SentTransfer) => (t.chain === 'base' ? `${EXPLORER}/tx/${t.hash}` : `${BTC_EXPLORER}/tx/${t.hash}`)

  return (
    <Sheet title={step.name === 'success' ? 'Sent' : 'Send'} onClose={busy ? () => {} : onClose}>
      {step.name === 'form' && (
        <form className="send-form" onSubmit={submit}>
          <div className="segmented four" role="tablist">
            {(['USDC', 'EURC', 'ETH', 'BTC'] as Asset[]).map((a) => (
              <button key={a} type="button" role="tab" aria-selected={asset === a} className={asset === a ? 'active' : ''} onClick={() => (setAsset(a), setAmount(''))}>
                {a}
              </button>
            ))}
          </div>
          <label className="amount-field">
            <span className="sr-only">Amount</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0" inputMode="decimal" autoFocus />
            <span className="unit">{asset}</span>
          </label>
          <p className="available">{asset === 'BTC' ? 'Bitcoin testnet4' : 'Base Sepolia'}</p>
          <div className="chips">
            {QUICK[asset].map((v) => (
              <button key={v} type="button" className="chip" onClick={() => setAmount(v)}>
                {v}
              </button>
            ))}
          </div>
          <label className="field">
            To
            <div className="input-row">
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={asset === 'BTC' ? 'tb1… address' : '0x… address'} spellCheck={false} autoComplete="off" />
            </div>
          </label>
          {!alone && (
            <button type="button" className="text-btn demo-scam" onClick={() => setTo(DEMO_SCAM[asset])}>
              Demo: use a known scam address
            </button>
          )}
          {isStablecoin(asset) && !alone && (
            <label className="fee-row">
              <span>
                Network fee: <strong>{gasless ? 'Free · paid by Swissquote' : 'Paid from your ETH'}</strong>
              </span>
              <span className="fee-toggle">
                <input type="checkbox" checked={payFeeMyself} onChange={(e) => setPayFeeMyself(e.target.checked)} /> Pay it myself
              </span>
            </label>
          )}
          {alone && <p className="notice small">Your device holds both parts since the takeover: it signs alone, without Swissquote.</p>}
          <button className="primary big with-icon" disabled={!to.trim() || !(Number(amount) > 0)}>
            <Fingerprint /> {alone ? 'Sign on this device' : 'Confirm with Face ID'}
          </button>
        </form>
      )}

      {step.name === 'progress' && (
        <ol className="progress">
          <Item state={step.stage === 'auth' ? 'active' : 'done'} title={alone ? 'Both parts on this device' : 'Face ID confirmed'} hint={alone ? 'Released by the escrow agent after the grace period' : 'Swissquote verifies your passkey before co-signing'} />
          <Item
            state={step.stage === 'signing' ? 'active' : step.stage === 'broadcast' ? 'done' : 'waiting'}
            title={alone ? 'This device signs (both parts)' : 'Your part + Swissquote sign (MPC)'}
            hint={alone ? 'No Swissquote involvement' : 'Swissquote checks the recipient and the transaction, then co-signs'}
          />
          <Item
            state={step.stage === 'broadcast' ? 'active' : 'waiting'}
            title={gasless ? 'Swissquote submits it and pays the fee' : 'Sent to the network'}
            hint={asset === 'BTC' ? 'Bitcoin testnet4' : gasless ? `Gasless ${asset}: you need no ETH` : 'Base Sepolia'}
          />
        </ol>
      )}

      {step.name === 'success' && (
        <div className="success-view">
          <Confetti />
          <div className="success-badge">
            <Check width="40" height="40" strokeWidth="2.6" />
          </div>
          <p className="review-amount">
            {step.transfer.amount} <span>{step.transfer.asset}</span>
          </p>
          <p className="muted">{step.transfer.viaKit ? 'Signed on this device (both parts)' : 'Signed with your part + Swissquote'}</p>
          {step.transfer.sponsored && <p className="free">Network fee paid by Swissquote</p>}
          <a className="explorer-link" href={explorer(step.transfer)} target="_blank" rel="noreferrer">
            See it on the blockchain <External />
          </a>
          <button className="primary big" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      {step.name === 'blocked' && (
        <div className="blocked-view">
          <div className="blocked-badge">
            <Shield />
          </div>
          <h3>Blocked by Swissquote</h3>
          <p>
            <code>{step.to}</code> is {step.reason}.
          </p>
          <p className="muted small">
            {step.offline
              ? "Swissquote is offline, so this phone checked its latest copy of Swissquote's list. Nothing was signed and no money moved."
              : 'Swissquote checks every recipient before it co-signs. Nothing was signed and no money moved.'}
          </p>
          <button className="primary big" onClick={onClose}>
            Back to my wallet
          </button>
        </div>
      )}

      {step.name === 'error' && (
        <div className="error-view">
          <p className="error">{step.message}</p>
          {step.needsConfirm && (
            <button className="primary big" onClick={() => run(true)}>
              Yes, I confirm this high-value transfer
            </button>
          )}
          {step.swissquoteDown && (
            <>
              <p className="muted small">
                Swissquote is unreachable, so your wallet is paused: every payment needs Swissquote's part. If it stays unreachable for the grace
                period, the escrow agent hands its copy to your device (see the home screen).
              </p>
              <button className="primary big" onClick={onClose}>
                Back to my wallet
              </button>
            </>
          )}
          {!step.needsConfirm && !step.swissquoteDown && (
            <button className="primary big" onClick={() => run()}>
              Try again
            </button>
          )}
          <button className="text-btn" onClick={() => setStep({ name: 'form' })}>
            Edit transfer
          </button>
        </div>
      )}

    </Sheet>
  )
}

function Item({ state, title, hint }: { state: 'waiting' | 'active' | 'done'; title: string; hint: string }) {
  return (
    <li className={state}>
      <span className="dot">{state === 'done' ? <Check width="16" height="16" strokeWidth="3" /> : state === 'active' ? <Spinner /> : null}</span>
      <div>
        <strong>{title}</strong>
        <span>{hint}</span>
      </div>
    </li>
  )
}
