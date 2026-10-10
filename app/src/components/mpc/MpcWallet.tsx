import { useState } from 'react'
import { ServiceError } from '../../mpc/api'
import { createWallet, describePasskeyError, loginWithPasskey, pairDevice, type CreateStage, type LoginResult } from '../../mpc/flows'
import type { Kit } from '../../mpc/kit'
import { forgetPhoneWallet, loadPhoneWallet, savePhoneWallet, type PhoneWallet } from '../../mpc/store'
import { Spinner } from '../icons'
import { Onboarding } from '../Onboarding'
import { KitBackup } from './KitBackup'
import { KitPicker } from './KitPicker'
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
  passkey: 'Confirm with your passkey…',
  shares: 'Generating 3 key shares with Swissquote…',
  done: 'Done',
}

function explain(error: unknown) {
  if (error instanceof ServiceError && error.status === 0)
    return 'Swissquote is unreachable. Start the share service (in services/: npm run share).'
  return describePasskeyError(error)
}

export function MpcWallet({ onToast }: { onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<PhoneWallet | null>(loadPhoneWallet)
  const [pendingKit, setPendingKit] = useState<{ kit: Kit; title: string } | null>(null)
  const [kitSavedAt, setKitSavedAt] = useState<number | null>(() => loadKitSaved(loadPhoneWallet()?.walletId))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [pairing, setPairing] = useState<LoginResult | null>(null)
  const [pairStep, setPairStep] = useState<number | null>(null)

  function markKitSaved(walletId: string) {
    const at = Date.now()
    setKitSavedAt(at)
    try {
      localStorage.setItem(kitKey(walletId), String(at))
    } catch {
      // Only used for the "saved" hint.
    }
  }

  async function create(name: string) {
    setBusy(true)
    setError('')
    try {
      const result = await createWallet(name, (stage, step) => setProgress(stage === 'shares' && step ? `${STAGE_TEXT.shares} (${step}/4)` : STAGE_TEXT[stage]))
      setWallet(result.wallet)
      setPendingKit({ kit: result.kit, title: 'Save your recovery kit' })
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  async function login() {
    setBusy(true)
    setError('')
    setProgress('Choose your passkey…')
    try {
      const result = await loginWithPasskey()
      const local = loadPhoneWallet()
      if (local && local.walletId === result.walletId) {
        // This device already holds Share A for the wallet: just log in.
        const named = { ...local, name: local.name ?? result.name ?? undefined }
        savePhoneWallet(named)
        setWallet(named)
        setKitSavedAt(loadKitSaved(named.walletId))
        onToast(`Welcome back${result.name ? `, ${result.name.split(' ')[0]}` : ''}`)
      } else {
        // Passkey is fine, but this device has no phone share yet: pair it with the kit.
        setPairing(result)
      }
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  async function pair(login: LoginResult, kit: Kit) {
    setPairStep(0)
    setError('')
    try {
      const result = await pairDevice(login, kit, setPairStep)
      setPairing(null)
      setWallet(result.wallet)
      setPendingKit({ kit: result.kit, title: 'Save your updated recovery kit' })
    } catch (e) {
      setError(explain(e))
    } finally {
      setPairStep(null)
    }
  }

  if (wallet && pendingKit)
    return (
      <>
        <div className="welcome">
          <strong>{pendingKit.title === 'Save your recovery kit' ? 'Your wallet is ready 🎉' : 'This device is connected 🎉'}</strong>
          <span>Share A is on this device, Share B at Swissquote. One step left: save Share C.</span>
        </div>
        <KitBackup
          kit={pendingKit.kit}
          title={pendingKit.title}
          onSaved={() => {
            markKitSaved(pendingKit.kit.walletId)
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

  if (pairing)
    return (
      <section className="card">
        <div className="card-head">
          <h2>Connect this device</h2>
          <span className="pill ok">Passkey verified</span>
        </div>
        <p className="muted small">
          Welcome back{pairing.name ? `, ${pairing.name.split(' ')[0]}` : ''}. This browser does not hold your phone share yet. Load your recovery kit:
          together with your passkey, Swissquote and the kit issue a new phone share for this device. Your addresses stay the same.
        </p>
        {pairStep === null ? (
          <KitPicker submitLabel="Connect this device" onUnlocked={(kit) => pair(pairing, kit)} />
        ) : (
          <p className="loading-line">
            <Spinner /> Issuing a new phone share with Swissquote and your kit… ({pairStep}/4)
          </p>
        )}
        {error && <p className="error small">{error}</p>}
        <button className="text-btn" onClick={() => setPairing(null)}>
          Cancel
        </button>
      </section>
    )

  return (
    <>
      <Onboarding busy={busy} progress={progress} error={error} onCreate={create} onLogin={login} onRecover={() => setRecovering(true)} />
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
