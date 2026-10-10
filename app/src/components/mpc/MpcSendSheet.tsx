import { useState, type FormEvent } from 'react'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { ServiceError } from '../../mpc/api'
import type { Asset } from '../../mpc/chains'
import { describePasskeyError, send, type SendStage } from '../../mpc/flows'
import type { Kit } from '../../mpc/kit'
import type { PhoneWallet } from '../../mpc/store'
import { Confetti } from '../Confetti'
import { Check, External, Fingerprint, Shield, Spinner } from '../icons'
import { Sheet } from '../Sheet'
import { KitPicker } from './KitPicker'

export type SentTransfer = { hash: string; chain: 'bitcoin' | 'base'; asset: Asset; amount: string; to: string; at: number; viaKit: boolean; sponsored?: boolean }

type Step =
  | { name: 'form' }
  | { name: 'progress'; stage: SendStage }
  | { name: 'success'; transfer: SentTransfer }
  | { name: 'error'; message: string; swissquoteDown: boolean; needsConfirm: boolean }
  | { name: 'blocked'; to: string; reason: string; offline: boolean }
  | { name: 'kit' }

// Clearly fake addresses on the share service's mock blocklist, for showing the screening in a demo.
const DEMO_SCAM: Record<Asset, string> = {
  USDC: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0',
  ETH: '0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0',
  BTC: 'tb1qh2at4w46h2at4w46h2at4w46h2at4w46jvgsm3',
}

const QUICK: Record<Asset, string[]> = { USDC: ['1', '5', '10'], ETH: ['0.0001', '0.0005'], BTC: ['0.0001', '0.0005', '0.001'] }

export function MpcSendSheet({ wallet, onClose, onSent }: { wallet: PhoneWallet; onClose: () => void; onSent: (t: SentTransfer) => void }) {
  const [asset, setAsset] = useState<Asset>('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>({ name: 'form' })
  const [kit, setKit] = useState<Kit | null>(null)
  // USDC sent with Swissquote is gasless by default: the client needs no ETH at all.
  const [payFeeMyself, setPayFeeMyself] = useState(false)
  const gasless = asset === 'USDC' && !kit && !payFeeMyself
  const busy = step.name === 'progress'

  async function run(withKit: Kit | null, confirmHighValue = false) {
    setStep({ name: 'progress', stage: withKit ? 'signing' : 'auth' })
    try {
      const request = { asset, to: to.trim(), amount, confirmHighValue, gasless: gasless && !withKit }
      const result = await send(wallet, request, (stage) => setStep({ name: 'progress', stage }), withKit ?? undefined)
      const transfer = { ...result, asset, amount, to: to.trim(), at: Date.now(), viaKit: !!withKit }
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
    if (to.trim() && Number(amount) > 0) run(kit)
  }

  const explorer = (t: SentTransfer) => (t.chain === 'base' ? `${EXPLORER}/tx/${t.hash}` : `${BTC_EXPLORER}/tx/${t.hash}`)

  return (
    <Sheet title={step.name === 'success' ? 'Sent' : step.name === 'kit' ? 'Sign with your recovery kit' : 'Send'} onClose={busy ? () => {} : onClose}>
      {step.name === 'form' && (
        <form className="send-form" onSubmit={submit}>
          <div className="segmented three" role="tablist">
            {(['USDC', 'ETH', 'BTC'] as Asset[]).map((a) => (
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
          {!kit && (
            <button type="button" className="text-btn demo-scam" onClick={() => setTo(DEMO_SCAM[asset])}>
              Demo: use a known scam address
            </button>
          )}
          {asset === 'USDC' && !kit && (
            <label className="fee-row">
              <span>
                Network fee: <strong>{gasless ? 'Free · paid by Swissquote' : 'Paid from your ETH'}</strong>
              </span>
              <span className="fee-toggle">
                <input type="checkbox" checked={payFeeMyself} onChange={(e) => setPayFeeMyself(e.target.checked)} /> Pay it myself
              </span>
            </label>
          )}
          {kit && <p className="notice small">Signing with your recovery kit: Swissquote is not involved.</p>}
          <button className="primary big with-icon" disabled={!to.trim() || !(Number(amount) > 0)}>
            <Fingerprint /> {kit ? 'Sign with phone + kit' : 'Confirm with passkey'}
          </button>
        </form>
      )}

      {step.name === 'progress' && (
        <ol className="progress">
          <Item state={step.stage === 'auth' ? 'active' : 'done'} title={kit ? 'Recovery kit unlocked' : 'Face ID confirmed'} hint={kit ? 'Phone and kit sign together on this device' : 'Swissquote verifies your passkey before co-signing'} />
          <Item
            state={step.stage === 'signing' ? 'active' : step.stage === 'broadcast' ? 'done' : 'waiting'}
            title={kit ? 'Phone + kit sign (MPC)' : 'Phone + Swissquote sign (MPC)'}
            hint={kit ? 'No Swissquote involvement at all' : 'Swissquote decodes and checks the transaction, then co-signs'}
          />
          <Item
            state={step.stage === 'broadcast' ? 'active' : 'waiting'}
            title={gasless ? 'Swissquote submits it and pays the fee' : 'Sent to the network'}
            hint={asset === 'BTC' ? 'Bitcoin testnet4' : gasless ? 'Gasless USDC: you need no ETH' : 'Base Sepolia'}
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
          <p className="muted">{step.transfer.viaKit ? 'Signed with phone + recovery kit' : 'Signed with phone + Swissquote'}</p>
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
              : 'Swissquote checks every recipient before a payment is signed, also when you sign with your kit. Nothing was signed and no money moved.'}
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
            <button className="primary big" onClick={() => run(kit, true)}>
              Yes, I confirm this high-value transfer
            </button>
          )}
          {step.swissquoteDown && (
            <>
              <p className="muted small">Swissquote can't co-sign right now. You don't need it: your phone and your recovery kit are two of three shares.</p>
              <button className="primary big" onClick={() => setStep({ name: 'kit' })}>
                Sign with my recovery kit instead
              </button>
            </>
          )}
          {!step.needsConfirm && !step.swissquoteDown && (
            <button className="primary big" onClick={() => run(kit)}>
              Try again
            </button>
          )}
          <button className="text-btn" onClick={() => setStep({ name: 'form' })}>
            Edit transfer
          </button>
        </div>
      )}

      {step.name === 'kit' && (
        <KitPicker
          submitLabel="Unlock and sign"
          onUnlocked={(k) => {
            if (k.walletId !== wallet.walletId) return setStep({ name: 'error', message: 'This kit belongs to a different wallet.', swissquoteDown: false, needsConfirm: false })
            setKit(k)
            run(k)
          }}
        />
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
