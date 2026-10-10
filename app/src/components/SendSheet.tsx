import { useState, type FormEvent } from 'react'
import { isAddress, parseEther, parseUnits, type Hash } from 'viem'
import { EXPLORER, GASLESS } from '../config'
import { formatEth, formatUsdc, short } from '../lib/format'
import type { Transfer } from '../lib/history'
import { explainError, sendTransfer, type SmartAccount, type Token } from '../wallet'
import { Confetti } from './Confetti'
import { Check, External, Fingerprint, Spinner } from './icons'
import { Sheet } from './Sheet'

type Step =
  | { name: 'form' }
  | { name: 'review' }
  | { name: 'progress'; stage: 'signing' | 'submitted' }
  | { name: 'success'; hash: Hash; blockNumber: bigint }
  | { name: 'error'; message: string }

const QUICK_AMOUNTS: Record<Token, string[]> = { USDC: ['1', '5', '10'], ETH: ['0.0001', '0.0005', '0.001'] }

export function SendSheet({
  account,
  balances,
  onClose,
  onSent,
}: {
  account: SmartAccount
  balances: { eth: bigint; usdc: bigint } | null
  onClose: () => void
  onSent: (transfer: Transfer) => void
}) {
  const [token, setToken] = useState<Token>('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>({ name: 'form' })

  const recipient = to.trim()
  const parsed = parseAmount(amount, token)
  const available = balances ? (token === 'USDC' ? balances.usdc : balances.eth) : null
  const tooMuch = parsed !== null && available !== null && parsed > available
  const validRecipient = isAddress(recipient)
  const canContinue = validRecipient && parsed !== null && parsed > 0n && !tooMuch
  const busy = step.name === 'progress'

  async function paste() {
    try {
      setTo((await navigator.clipboard.readText()).trim())
    } catch {
      // Clipboard permission denied: the user can still type or paste manually.
    }
  }

  async function confirm() {
    setStep({ name: 'progress', stage: 'signing' })
    try {
      const { hash, blockNumber } = await sendTransfer(account, { token, to: recipient, amount }, () =>
        setStep({ name: 'progress', stage: 'submitted' }),
      )
      onSent({ hash, token, amount, to: recipient, at: Date.now() })
      setStep({ name: 'success', hash, blockNumber })
    } catch (e) {
      setStep({ name: 'error', message: explainError(e) })
    }
  }

  return (
    <Sheet title={step.name === 'success' ? 'Sent' : 'Send'} onClose={busy ? () => {} : onClose}>
      {step.name === 'form' && (
        <form
          className="send-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (canContinue) setStep({ name: 'review' })
          }}
        >
          <div className="segmented" role="tablist">
            {(['USDC', 'ETH'] as Token[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={token === t}
                className={token === t ? 'active' : ''}
                onClick={() => {
                  setToken(t)
                  setAmount('')
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <label className="amount-field">
            <span className="sr-only">Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
              placeholder="0"
              inputMode="decimal"
              autoFocus
              aria-invalid={tooMuch}
            />
            <span className="unit">{token}</span>
          </label>
          <p className={`available ${tooMuch ? 'error' : ''}`}>
            {tooMuch ? 'More than you have · ' : ''}
            Available: {available === null ? '…' : token === 'USDC' ? formatUsdc(available) : formatEth(available)}{' '}
            {token}
          </p>

          <div className="chips">
            {QUICK_AMOUNTS[token].map((value) => (
              <button key={value} type="button" className="chip" onClick={() => setAmount(value)}>
                {value}
              </button>
            ))}
            {token === 'USDC' && available !== null && available > 0n && (
              <button type="button" className="chip" onClick={() => setAmount(formatUsdc(available).replace(/,/g, ''))}>
                Max
              </button>
            )}
          </div>

          <label className="field">
            To
            <div className="input-row">
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="0x… recipient address"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="chip" onClick={paste}>
                Paste
              </button>
            </div>
          </label>
          {recipient !== '' && !validRecipient && <p className="error small">That is not a valid address.</p>}

          <button className="primary big" disabled={!canContinue}>
            Review
          </button>
        </form>
      )}

      {step.name === 'review' && (
        <div className="review">
          <p className="review-amount">
            {amount} <span>{token}</span>
          </p>
          <dl>
            <div>
              <dt>To</dt>
              <dd className="mono">{short(recipient)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Base Sepolia</dd>
            </div>
            <div>
              <dt>Network fee</dt>
              <dd>{GASLESS ? <span className="free">Free · sponsored</span> : 'Paid from your ETH'}</dd>
            </div>
          </dl>
          <button className="primary big with-icon" onClick={confirm}>
            <Fingerprint /> Confirm with passkey
          </button>
          <button className="text-btn" onClick={() => setStep({ name: 'form' })}>
            Back
          </button>
        </div>
      )}

      {step.name === 'progress' && (
        <ol className="progress">
          <ProgressItem
            state={step.stage === 'signing' ? 'active' : 'done'}
            title="Signed with your passkey"
            hint="Your face or fingerprint unlocks the key in your device's chip"
          />
          <ProgressItem
            state={step.stage === 'submitted' ? 'active' : 'waiting'}
            title="Sent to the network"
            hint="A bundler puts your signed transfer into the next block"
          />
          <ProgressItem state="waiting" title="Confirmed on-chain" hint="The smart account checks your signature" />
        </ol>
      )}

      {step.name === 'success' && (
        <div className="success-view">
          <Confetti />
          <div className="success-badge">
            <Check width="40" height="40" strokeWidth="2.6" />
          </div>
          <p className="review-amount">
            {amount} <span>{token}</span>
          </p>
          <p className="muted">
            to <span className="mono">{short(recipient)}</span> · confirmed in block {step.blockNumber.toString()}
          </p>
          <a className="explorer-link" href={`${EXPLORER}/tx/${step.hash}`} target="_blank" rel="noreferrer">
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
          <button className="primary big" onClick={() => setStep({ name: 'review' })}>
            Try again
          </button>
          <button className="text-btn" onClick={() => setStep({ name: 'form' })}>
            Edit transfer
          </button>
        </div>
      )}
    </Sheet>
  )
}

function ProgressItem({ state, title, hint }: { state: 'waiting' | 'active' | 'done'; title: string; hint: string }) {
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

function parseAmount(value: string, token: Token): bigint | null {
  if (!/^\d*\.?\d*$/.test(value) || value === '' || value === '.') return null
  try {
    return token === 'USDC' ? parseUnits(value, 6) : parseEther(value)
  } catch {
    return null
  }
}
