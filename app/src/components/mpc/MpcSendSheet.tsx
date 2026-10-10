import { useState, type FormEvent } from 'react'
import { BTC_EXPLORER, EXPLORER } from '../../config'
import { ServiceError } from '../../mpc/api'
import type { Asset } from '../../mpc/chains'
import { describePasskeyError, send, type SendStage } from '../../mpc/flows'
import type { Kit } from '../../mpc/kit'
import type { PhoneWallet } from '../../mpc/store'
import { Confetti } from '../Confetti'
import { Check, External, Fingerprint, Spinner } from '../icons'
import { Sheet } from '../Sheet'
import { KitPicker } from './KitPicker'

export type SentTransfer = { hash: string; chain: 'bitcoin' | 'base'; asset: Asset; amount: string; to: string; at: number; viaKit: boolean }

type Step =
  | { name: 'form' }
  | { name: 'progress'; stage: SendStage }
  | { name: 'success'; transfer: SentTransfer }
  | { name: 'error'; message: string; swissquoteDown: boolean; needsConfirm: boolean }
  | { name: 'kit' }

const QUICK: Record<Asset, string[]> = { USDC: ['1', '5', '10'], ETH: ['0.0001', '0.0005'], BTC: ['0.0001', '0.0005', '0.001'] }

export function MpcSendSheet({
  wallet,
  initialAsset = 'USDC',
  onClose,
  onSent,
}: {
  wallet: PhoneWallet
  initialAsset?: Asset
  onClose: () => void
  onSent: (t: SentTransfer) => void
}) {
  const [asset, setAsset] = useState<Asset>(initialAsset)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>({ name: 'form' })
  const [kit, setKit] = useState<Kit | null>(null)
  const busy = step.name === 'progress'

  async function run(withKit: Kit | null, confirmHighValue = false) {
    setStep({ name: 'progress', stage: withKit ? 'signing' : 'auth' })
    try {
      const result = await send(wallet, { asset, to: to.trim(), amount, confirmHighValue }, (stage) => setStep({ name: 'progress', stage }), withKit ?? undefined)
      const transfer = { ...result, asset, amount, to: to.trim(), at: Date.now(), viaKit: !!withKit }
      onSent(transfer)
      setStep({ name: 'success', transfer })
    } catch (e) {
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
          <Item state={step.stage === 'broadcast' ? 'active' : 'waiting'} title="Sent to the network" hint={asset === 'BTC' ? 'Bitcoin testnet4' : 'Base Sepolia'} />
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
          <a className="explorer-link" href={explorer(step.transfer)} target="_blank" rel="noreferrer">
            See it on the blockchain <External />
          </a>
          <button className="primary big" onClick={onClose}>
            Done
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
