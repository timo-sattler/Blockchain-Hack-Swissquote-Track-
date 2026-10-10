import { useCallback, useEffect, useState } from 'react'
import { pad, type Hex } from 'viem'
import { EXPLORER, RECOVERY_MODULE } from '../config'
import { formatDuration } from '../lib/format'
import { readRecovery, type RecoveryState } from '../recovery'
import { getOnChainOwners, type SmartAccount } from '../wallet'
import { Bank, Check, External, Fingerprint, Users } from './icons'
import { RecoverySetupSheet } from './RecoverySetupSheet'

type Status =
  | { kind: 'loading' }
  | { kind: 'not-deployed' }
  | { kind: 'verified' }
  | { kind: 'revoked' }
  | { kind: 'other-owners'; count: number }

const MODULE_OWNER = pad(RECOVERY_MODULE).toLowerCase()

/** Shows who can move the funds, read live from the smart account and recovery contracts. */
export function ControlCard({
  account,
  passkeyPublicKey,
  refreshKey,
  onChanged,
}: {
  account: SmartAccount
  passkeyPublicKey: Hex
  refreshKey: number
  onChanged: () => void
}) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [recovery, setRecovery] = useState<(RecoveryState & { moduleIsOwner: boolean }) | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState('')

  const loadRecovery = useCallback(async () => {
    const [state, owners] = await Promise.all([readRecovery(account.address), getOnChainOwners(account.address)])
    const loaded = { ...state, moduleIsOwner: !!owners?.some((o) => o.toLowerCase() === MODULE_OWNER) }
    setRecovery(loaded)
    return loaded
  }, [account])

  async function openSetup() {
    setSetupError('')
    try {
      // Read fresh state so the setup batch knows whether the module is already an owner.
      await loadRecovery()
      setSettingUp(true)
    } catch {
      setSetupError('Could not read the recovery contract. Check your connection and try again.')
    }
  }

  useEffect(() => {
    // Read independently: if the recovery contract is unreachable, ownership still shows.
    loadRecovery().catch(() => {})

    getOnChainOwners(account.address)
      .then((owners) => {
        if (owners === null) return setStatus({ kind: 'not-deployed' })
        const hasPasskey = owners.some((o) => o.toLowerCase() === passkeyPublicKey.toLowerCase())
        // The recovery module is an owner too, but its code can only swap passkeys, never move funds.
        const spenders = owners.filter((o) => o.toLowerCase() !== MODULE_OWNER)
        if (!hasPasskey) return setStatus({ kind: 'revoked' })
        setStatus(spenders.length === 1 ? { kind: 'verified' } : { kind: 'other-owners', count: spenders.length })
      })
      .catch(() => setStatus({ kind: 'loading' }))
  }, [account, passkeyPublicKey, refreshKey, loadRecovery])

  if (status.kind === 'revoked')
    return (
      <section className="alert danger big">
        <strong>This phone no longer controls the wallet</strong>
        <span>
          A recovery moved the wallet to a new passkey and removed this one. It cannot sign anything anymore. If you did
          not do this, contact Swissquote.
        </span>
      </section>
    )

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
            <span>
              {recovery?.enabled
                ? `Any ${recovery.threshold} of ${recovery.guardians.length} can replace a lost passkey after ${formatDuration(recovery.delay)} you can cancel`
                : '2 of 3 can replace a lost passkey, after a delay you can cancel'}
            </span>
          </div>
          {recovery?.enabled ? (
            <span className="pill ok">On</span>
          ) : (
            <button className="pill soon" onClick={openSetup}>
              Set up
            </button>
          )}
        </li>
      </ul>
      {setupError && <p className="error small">{setupError}</p>}
      <p className="fineprint left">
        {status.kind === 'verified' &&
          (recovery?.enabled
            ? 'The contract on Base Sepolia lists your passkey and the recovery module, which can only swap passkeys. '
            : 'The contract on Base Sepolia lists exactly one owner: your passkey. ')}
        {status.kind === 'other-owners' && `Heads-up: the contract lists ${status.count} keys that can spend. `}
        {status.kind === 'not-deployed' && 'Your address is reserved. The contract is created with your first transaction. '}
        <a href={`${EXPLORER}/address/${account.address}#readProxyContract`} target="_blank" rel="noreferrer">
          Check it yourself <External />
        </a>
      </p>

      {settingUp && recovery && (
        <RecoverySetupSheet
          account={account}
          moduleIsOwner={recovery.moduleIsOwner}
          onClose={() => setSettingUp(false)}
          onDone={onChanged}
        />
      )}
    </section>
  )
}
