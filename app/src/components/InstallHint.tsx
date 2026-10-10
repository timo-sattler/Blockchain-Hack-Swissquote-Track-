import { useEffect, useState } from 'react'
import { Close } from './icons'

// Chrome/Android fires this before showing its own install banner; not in TypeScript's DOM types yet.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const DISMISSED_KEY = 'sq-wallet:install-dismissed'

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Invites phone users to add the wallet to their home screen, where it runs full-screen like a native app. */
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(() => isStandalone() || wasDismissed())

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => setHidden(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (hidden || (!prompt && !isIos())) return null

  function dismiss() {
    setHidden(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Not remembered: the hint simply shows again next time.
    }
  }

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    if ((await prompt.userChoice).outcome === 'accepted') setHidden(true)
  }

  return (
    <div className="install-hint">
      <img src="/icon-192.png" alt="" width="40" height="40" />
      <div>
        <strong>Get the app</strong>
        {prompt ? (
          <span>Install the wallet on your home screen.</span>
        ) : (
          <span>
            Tap <ShareGlyph /> in Safari, then “Add to Home Screen”.
          </span>
        )}
      </div>
      {prompt && (
        <button className="chip" onClick={install}>
          Install
        </button>
      )}
      <button className="icon-btn small" onClick={dismiss} aria-label="Dismiss">
        <Close />
      </button>
    </div>
  )
}

function ShareGlyph() {
  return (
    <svg className="inline-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}
