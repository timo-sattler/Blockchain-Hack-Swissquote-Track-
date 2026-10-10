import { useEffect, useState } from 'react'
import { ServiceError } from '../../mpc/api'
import { completePairing, createWallet, describePasskeyError, loginWithPasskey, requestPairing, type CreateStage, type LoginResult } from '../../mpc/flows'
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
  const [pairReadyAt, setPairReadyAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!pairReadyAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [pairReadyAt])

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
    setError('')
    try {
      // Safety delay first: the other devices are alerted and the request can be noticed.
      const readyAt = await requestPairing(login, kit)
      setPairReadyAt(readyAt)
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, readyAt - Date.now()) + 300))
      setPairReadyAt(null)
      setPairStep(0)
      const result = await completePairing(login, kit, setPairStep)
      setPairing(null)
      setWallet(result.wallet)
      setPendingKit({ kit: result.kit, title: 'Save your updated recovery kit' })
    } catch (e) {
      setError(explain(e))
    } finally {
      setPairStep(null)
      setPairReadyAt(null)
    }
  }

  if (wallet && pendingKit)
    return (
      <>
        <div className="welcome">
          <strong>{pendingKit.title === 'Save your recovery kit' ? 'Your wallet is ready 🎉' : 'This device is connected 🎉'}</strong>
          <span>Share A is on this device, Share B at Swissquote. One step left: save Share C.</span>
          {pendingKit.title === 'Save your recovery kit' && <span>🎁 Swissquote is sending you a welcome bonus of test USDC + ETH for gas (demo).</span>}
        </div>
        <KitBackup
          kit={pendingKit.kit}
          title={pendingKit.title}
          replacesOldKit={pendingKit.title !== 'Save your recovery kit'}
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
        {pairReadyAt ? (
          <div className="review center">
            <p className="muted small">Safety delay: your other devices have been alerted and can still stop this.</p>
            <p className="countdown">{Math.max(0, Math.ceil((pairReadyAt - now) / 1000))}s</p>
            <p className="muted small">Demo delay. In production: 24 hours.</p>
          </div>
        ) : pairStep === null ? (
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
