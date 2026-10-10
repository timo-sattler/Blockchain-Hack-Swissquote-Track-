import { secp256k1 } from '@noble/curves/secp256k1.js'
import { useEffect, useState } from 'react'
import { short } from '../../lib/format'
import { escrowPart, fingerprintOf, swissquotePart, type PartsInfo } from '../../mpc/flows'
import { lastTranscript } from '../../mpc/protocol'
import type { PhoneWallet } from '../../mpc/store'
import { Sheet } from '../Sheet'

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * What the key really is, with live data from this wallet: the parts (as fingerprints, never the parts),
 * who holds which, and the exact messages that travelled during the last signature.
 */
export function KeyInspectorSheet({ wallet, onClose }: { wallet: PhoneWallet; onClose: () => void }) {
  const [mine, setMine] = useState('')
  const [bank, setBank] = useState('')
  const [sq, setSq] = useState<PartsInfo | null>(null)
  const [escrow, setEscrow] = useState<{ deposited: boolean; fingerprint: string | null } | null>(null)
  const [transcript] = useState(lastTranscript)

  useEffect(() => {
    fingerprintOf(wallet.share).then(setMine)
    if (wallet.bankShare) fingerprintOf(wallet.bankShare).then(setBank)
    swissquotePart(wallet.walletId).then(setSq, () => setSq(null))
    escrowPart(wallet.walletId).then(setEscrow, () => setEscrow(null))
  }, [wallet])

  const publicKey = hex(secp256k1.Point.fromBytes(wallet.publicKey).toBytes(true))
  const sent = transcript?.steps.filter((s) => s.from === 'device') ?? []
  const received = transcript?.steps.filter((s) => s.from === 'swissquote') ?? []
  const total = (steps: typeof sent) => steps.reduce((n, s) => n + s.bytes, 0)

  return (
    <Sheet title="How my key works" onClose={onClose}>
      <div className="inspector">
        <section>
          <h3>The private key never exists</h3>
          <p className="muted small">
            A normal wallet has one secret number, the private key. Yours was never created: this device and Swissquote each generated a part, and
            every signature is computed jointly from the two parts without ever putting them together.
          </p>
          <div className="kv">
            <span>Public key (the only whole piece; safe to share)</span>
            <code>{short(publicKey)}</code>
            <span>Addresses derived from it</span>
            <code>
              {short(wallet.evmAddress)} · {short(wallet.btcAddress)}
            </code>
          </div>
        </section>

        <section>
          <h3>Who holds what</h3>
          <ul className="parts">
            <li>
              <strong>Your part · this device</strong>
              <span>
                {kb(wallet.share.length)} · fingerprint <code>{mine || '…'}</code>
              </span>
              <em>Your other devices hold an identical copy: the same fingerprint. Used only with Face ID.</em>
            </li>
            <li>
              <strong>Swissquote's part</strong>
              <span>
                {sq ? (
                  <>
                    {kb(sq.swissquote.bytes)} · fingerprint <code>{sq.swissquote.fingerprint}</code>
                  </>
                ) : wallet.independent && bank ? (
                  <>
                    on this device since the takeover · fingerprint <code>{bank}</code>
                  </>
                ) : (
                  'Swissquote unreachable'
                )}
              </span>
              {sq && mine && <em className={sq.swissquote.fingerprint !== mine ? 'ok' : 'bad'}>{sq.swissquote.fingerprint !== mine ? 'A different part from yours' : 'Same as yours?!'}</em>}
            </li>
            <li>
              <strong>Escrow agent</strong>
              <span>
                {escrow?.deposited && escrow.fingerprint ? (
                  <>
                    copy · fingerprint <code>{escrow.fingerprint}</code>
                  </>
                ) : escrow ? (
                  'holds nothing (released or never deposited)'
                ) : (
                  'unreachable'
                )}
              </span>
              {escrow?.fingerprint && sq && (
                <em className={escrow.fingerprint === sq.swissquote.fingerprint ? 'ok' : 'bad'}>
                  {escrow.fingerprint === sq.swissquote.fingerprint
                    ? "Identical to Swissquote's: a copy of the same part, so Swissquote and the agent together still hold only one part"
                    : 'Differs from Swissquote’s part'}
                </em>
              )}
            </li>
          </ul>
        </section>

        <section>
          <h3>What travelled during the last {transcript?.kind === 'create' ? 'key creation' : 'signature'}</h3>
          {transcript ? (
            <>
              <ol className="transcript">
                {transcript.steps.map((s, i) => (
                  <li key={i} className={s.from}>
                    <span>{s.from === 'device' ? 'This device → Swissquote' : 'Swissquote → this device'}</span>
                    <span>
                      {s.messages} message{s.messages === 1 ? '' : 's'} · {s.bytes.toLocaleString('en')} bytes
                    </span>
                  </li>
                ))}
              </ol>
              <p className="muted small">
                In total {total(sent).toLocaleString('en')} bytes out and {total(received).toLocaleString('en')} bytes in. Your part is{' '}
                {kb(transcript.partBytes)} and never left this device; only these protocol messages travelled.
                {transcript.kind === 'sign' ? ' The finished signature only appeared here, on this device.' : ''}
              </p>
            </>
          ) : (
            <p className="muted small">Send a payment to see the messages of a signature.</p>
          )}
        </section>

        <section>
          <h3>Could Swissquote sign alone?</h3>
          <p className="muted small">
            No. We attack it with everything Swissquote holds: Swissquote alone, Swissquote with the escrow agent's copy, Swissquote with a forged
            client part. Every attempt fails. Run it yourself: <code>npm run insider</code> and <code>node --test tests/two-parts.test.mjs</code> in{' '}
            <code>services/</code>.
          </p>
        </section>
      </div>
    </Sheet>
  )
}
