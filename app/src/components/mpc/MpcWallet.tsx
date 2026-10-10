import { useState } from 'react'
import { ServiceError } from '../../mpc/api'
import { createWallet, type CreateStage } from '../../mpc/flows'
import type { Kit } from '../../mpc/kit'
import { forgetPhoneWallet, loadPhoneWallet, type PhoneWallet } from '../../mpc/store'
import { Onboarding } from '../Onboarding'
import { KitBackup } from './KitBackup'
import { MpcHome } from './MpcHome'
import { RecoverySheet } from './RecoverySheet'

const kitKey = (walletId: string) => `sq-mpc:kit-saved:${walletId}`
const loadKitSaved = (walletId?: string) => {
  try {
    return walletId ? Number(localStorage.getItem(kitKey(walletId))) || null : null
  } catch {
    return null
  }
}

const STAGE_TEXT: Record<CreateStage, string> = {
  passkey: 'Confirm with Face ID…',
  shares: 'Generating 3 key shares with Swissquote…',
  done: 'Done',
}

export function MpcWallet({ clientName, onToast }: { clientName: string; onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<PhoneWallet | null>(loadPhoneWallet)
  const [pendingKit, setPendingKit] = useState<Kit | null>(null)
  const [kitSavedAt, setKitSavedAt] = useState<number | null>(() => loadKitSaved(loadPhoneWallet()?.walletId))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)

  function markKitSaved(walletId: string) {
    const at = Date.now()
    setKitSavedAt(at)
    try {
      localStorage.setItem(kitKey(walletId), String(at))
    } catch {
      // Only used for the "saved" hint.
    }
  }

  async function create() {
    setBusy(true)
    setError('')
    try {
      const result = await createWallet((stage, step) => setProgress(stage === 'shares' && step ? `${STAGE_TEXT.shares} (${step}/4)` : STAGE_TEXT[stage]))
      setWallet(result.wallet)
      setPendingKit(result.kit)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(
        e instanceof ServiceError && e.status === 0
          ? 'Swissquote is unreachable. Start the share service (services/: npm run share).'
          : /NotAllowed|cancel/i.test(message)
            ? 'Passkey prompt was cancelled.'
            : message,
      )
    } finally {
      setBusy(false)
    }
  }

  if (wallet && pendingKit)
    return (
      <>
        <div className="welcome">
          <strong>Your wallet is ready 🎉</strong>
          <span>Share A is on this phone, Share B at Swissquote. One step left: save Share C.</span>
        </div>
        <KitBackup
          kit={pendingKit}
          title="Save your recovery kit"
          onSaved={() => {
            markKitSaved(pendingKit.walletId)
            setPendingKit(null)
            onToast('Recovery kit downloaded')
          }}
        />
      </>
    )

  if (wallet)
    return (
      <MpcHome
        wallet={wallet}
        kitSavedAt={kitSavedAt}
        onToast={onToast}
        onForget={() => {
          forgetPhoneWallet()
          setWallet(null)
          setKitSavedAt(null)
        }}
      />
    )

  return (
    <>
      <Onboarding clientName={clientName} busy={busy} progress={progress} error={error} onCreate={create} onRecover={() => setRecovering(true)} />
      {recovering && (
        <RecoverySheet
          onClose={() => setRecovering(false)}
          onRecovered={(recovered) => {
            setWallet(recovered)
            markKitSaved(recovered.walletId)
            onToast('Wallet recovered: same addresses, new phone share')
          }}
        />
      )}
    </>
  )
}
