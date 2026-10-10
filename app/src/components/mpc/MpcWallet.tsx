import { useEffect, useState } from 'react'
import { ServiceError } from '../../mpc/api'
import { createWallet, describePasskeyError, loginWithPasskey, parseDeviceLink, type CreateStage } from '../../mpc/flows'
import { forgetPhoneWallet, loadPhoneWallet, savePhoneWallet, type PhoneWallet } from '../../mpc/store'
import { Onboarding } from '../Onboarding'
import { JoinDevice } from './JoinDevice'
import { MpcHome } from './MpcHome'

const STAGE_TEXT: Record<CreateStage, string> = {
  passkey: 'Confirm with Face ID…',
  shares: 'Creating your key with Swissquote…',
  done: 'Done',
}

function explain(error: unknown) {
  if (error instanceof ServiceError && error.status === 0) return 'Swissquote is unreachable. Start the demo with scripts/start-demo.sh.'
  return describePasskeyError(error)
}

/**
 * The self-custody wallet: one key in two parts. This device's part (identical copies on the client's
 * other devices, each unlocked with its own Face ID) + Swissquote's part. Every payment needs both.
 */
export function MpcWallet({ onToast }: { onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<PhoneWallet | null>(loadPhoneWallet)
  const [link, setLink] = useState(() => parseDeviceLink(location.hash))
  const [fresh, setFresh] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onHash = () => setLink(parseDeviceLink(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const clearLink = () => {
    history.replaceState(null, '', location.pathname + location.search)
    setLink(null)
  }

  useEffect(() => {
    if (link && wallet?.walletId === link.walletId) {
      clearLink()
      onToast('This device already has your wallet')
    }
  }, [link, wallet, onToast])

  async function create(name: string) {
    setBusy(true)
    setError('')
    try {
      const result = await createWallet(name, (stage, step) => setProgress(stage === 'shares' && step ? `${STAGE_TEXT.shares} (${step}/4)` : STAGE_TEXT[stage]))
      setWallet(result.wallet)
      setFresh(true)
      onToast('Your wallet is ready')
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
        const named = { ...local, name: local.name ?? result.name ?? undefined }
        savePhoneWallet(named)
        setWallet(named)
        onToast(`Welcome back${result.name ? `, ${result.name.split(' ')[0]}` : ''}`)
      } else {
        setError('Your passkey is fine, but this device has no copy of your key part. On a device that has it, tap “Add a device” and open the link here.')
      }
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  if (link && wallet?.walletId !== link.walletId)
    return (
      <JoinDevice
        link={link}
        replacesWallet={!!wallet}
        onJoined={(joined) => {
          setWallet(joined)
          clearLink()
          onToast('This device is added to your wallet')
        }}
        onCancel={clearLink}
      />
    )

  if (wallet)
    return (
      <MpcHome
        wallet={wallet}
        fresh={fresh}
        onToast={onToast}
        onWalletChange={setWallet}
        onForget={() => {
          forgetPhoneWallet()
          setWallet(null)
          setFresh(false)
        }}
      />
    )

  return <Onboarding busy={busy} progress={progress} error={error} onCreate={create} onLogin={login} />
}
