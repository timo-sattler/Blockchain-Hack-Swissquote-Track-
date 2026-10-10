import { useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import { EXPLORER } from '../config'
import { getOnChainOwners } from '../wallet'
import { Bank, Check, External, Fingerprint, Users } from './icons'

type Status = { kind: 'loading' } | { kind: 'not-deployed' } | { kind: 'verified' } | { kind: 'other-owners'; count: number }

/** Shows who can move the funds, read live from the smart account contract. */
export function ControlCard({ address, passkeyPublicKey, refreshKey }: { address: Address; passkeyPublicKey: Hex; refreshKey: number }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    getOnChainOwners(address)
      .then((owners) => {
        if (owners === null) return setStatus({ kind: 'not-deployed' })
        const onlyPasskey = owners.length === 1 && owners[0].toLowerCase() === passkeyPublicKey.toLowerCase()
        setStatus(onlyPasskey ? { kind: 'verified' } : { kind: 'other-owners', count: owners.length })
      })
      .catch(() => setStatus({ kind: 'loading' }))
  }, [address, passkeyPublicKey, refreshKey])

  return (
    <section className="card control">
      <div className="card-head">
        <h2>Who controls this wallet</h2>
        {status.kind === 'verified' && (
          <span className="badge ok">
            <Check width="12" height="12" strokeWidth="3" /> Verified on-chain
          </span>
        )}
        {status.kind === 'not-deployed' && <span className="badge">Activates with 1st transfer</span>}
      </div>
      <ul className="control-list">
        <li>
          <span className="control-icon you">
            <Fingerprint />
          </span>
          <div>
            <strong>You · passkey on this device</strong>
            <span>Can send funds</span>
          </div>
          <span className="pill ok">Owner</span>
        </li>
        <li>
          <span className="control-icon">
            <Bank />
          </span>
          <div>
            <strong>Swissquote</strong>
            <span>Holds no key. Cannot move or freeze funds</span>
          </div>
          <span className="pill">No access</span>
        </li>
        <li>
          <span className="control-icon">
            <Users />
          </span>
          <div>
            <strong>Recovery guardians</strong>
            <span>2 of 3 plus a 48 h delay you can cancel</span>
          </div>
          <span className="pill soon">Next</span>
        </li>
      </ul>
      <p className="fineprint left">
        {status.kind === 'verified' && 'The contract on Base Sepolia lists exactly one owner: your passkey. '}
        {status.kind === 'other-owners' && `Heads-up: the contract lists ${status.count} owners. `}
        {status.kind === 'not-deployed' && 'Your address is reserved. The contract is created with your first transfer. '}
        <a href={`${EXPLORER}/address/${address}#readProxyContract`} target="_blank" rel="noreferrer">
          Check it yourself <External />
        </a>
      </p>
    </section>
  )
}
