import { useMemo, useState } from 'react'
import { short } from '../lib/format'
import { contactGuardian, encodeApproval, parseRequestLink, recoveryTypedData } from '../recovery'
import { Check, Copy, Users } from './icons'

/**
 * What the trusted contact sees on their own phone. Their guardian key lives only in this browser.
 * Requests arrive as a link and approvals leave as a code, over any messenger: no server involved.
 */
export function GuardianApp({ hash }: { hash: string }) {
  const guardian = useMemo(contactGuardian, [])
  const request = parseRequestLink(hash)
  const [code, setCode] = useState('')
  const [declined, setDeclined] = useState(false)
  const [copied, setCopied] = useState('')

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      window.prompt('Copy this', text)
    }
  }

  async function approve() {
    const signature = await guardian.signTypedData(recoveryTypedData(request!))
    setCode(encodeApproval({ signer: guardian.address, signature }))
  }

  const expired = request && request.deadline < Date.now() / 1000

  return (
    <div className="shell guardian-app">
      <header className="guardian-head">
        <span className="control-icon">
          <Users />
        </span>
        <div>
          <strong>Swissquote Wallet · Guardian</strong>
          <span>You help a friend recover their wallet. You can never move their funds.</span>
        </div>
      </header>

      {!request && (
        <section className="card">
          <h2>Your guardian address</h2>
          <p className="muted">
            Send this to anyone who asks you to be their guardian. The same address works for as many friends as you
            like: each request they send names the wallet, and you approve each one separately.
          </p>
          <p className="code-box">{guardian.address}</p>
          <button className="primary big with-icon" onClick={() => copy(guardian.address, 'address')}>
            {copied === 'address' ? <Check /> : <Copy />} {copied === 'address' ? 'Copied' : 'Copy address'}
          </button>
          <p className="fineprint left">
            The key behind this address is stored only in this browser. Keep using the same phone and browser.
          </p>
        </section>
      )}

      {request && !code && !declined && (
        <section className="card">
          <h2>{request.name} asks for your help</h2>
          <p className="muted">
            They want to move wallet <span className="mono">{short(request.account)}</span> to a new phone.
          </p>
          <div className="alert warn">
            <strong>Call {request.name} first</strong>
            <span>
              Use a phone number you already know, not one from this message. Approve only if you are sure it is them.
              Attackers often pretend to be a friend in trouble.
            </span>
          </div>
          {expired ? (
            <p className="error">This request has expired. Ask them to send a new one.</p>
          ) : (
            <>
              <button className="primary big" onClick={approve}>
                I called them · Approve
              </button>
              <button className="text-btn danger" onClick={() => setDeclined(true)}>
                Decline
              </button>
            </>
          )}
        </section>
      )}

      {code && (
        <section className="card">
          <h2>Send this code back</h2>
          <p className="muted">Send it to {request!.name} over the same chat. It only works for this request.</p>
          <p className="code-box">{code}</p>
          <button className="primary big with-icon" onClick={() => copy(code, 'code')}>
            {copied === 'code' ? <Check /> : <Copy />} {copied === 'code' ? 'Copied' : 'Copy approval code'}
          </button>
        </section>
      )}

      {declined && (
        <section className="card">
          <h2>Declined</h2>
          <p className="muted">Nothing was signed. If you think someone is impersonating your friend, tell them.</p>
        </section>
      )}
    </div>
  )
}
