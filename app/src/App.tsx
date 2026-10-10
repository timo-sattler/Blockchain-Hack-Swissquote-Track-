import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BankTab } from './sq/BankTab'
import { CryptoTab } from './sq/CryptoTab'
import { HomeTab } from './sq/HomeTab'
import { BankIcon, CryptoIcon, HomeIcon, PlanIcon, TradeIcon } from './sq/icons'
import { PlanTab } from './sq/PlanTab'
import { TradeTab } from './sq/TradeTab'
import './sq/sq.css'

// Mock-up of the Swissquote app with an extra Crypto tab that hosts the real self-custody wallet.
type Tab = 'home' | 'trade' | 'crypto' | 'bank' | 'plan'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'trade', label: 'Trade', icon: <TradeIcon /> },
  { id: 'crypto', label: 'Crypto', icon: <CryptoIcon /> },
  { id: 'bank', label: 'Bank', icon: <BankIcon /> },
  { id: 'plan', label: 'Plan', icon: <PlanIcon /> },
]

const TAB_KEY = 'sq-app:tab'

function initialTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_KEY) as Tab | null
    return saved && TABS.some((t) => t.id === saved) ? saved : 'home'
  } catch {
    return 'home'
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number>(undefined)

  useEffect(() => {
    window.scrollTo(0, 0)
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      // Remembering the tab is only a convenience.
    }
  }, [tab])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }, [])

  return (
    <div className="sq-app">
      <main className="sq-main">
        {tab === 'home' && <HomeTab onOpenCrypto={() => setTab('crypto')} />}
        {tab === 'trade' && <TradeTab />}
        {tab === 'crypto' && <CryptoTab onToast={showToast} />}
        {tab === 'bank' && <BankTab />}
        {tab === 'plan' && <PlanTab />}
        <p className="sq-footnote">Prototype for the Swissquote Wallet Challenge · not an official Swissquote app</p>
      </main>

      <nav className="sq-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? 'active' : ''}
            onClick={() => setTab(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.id === 'crypto' && <i className="sq-new-dot" aria-label="New" />}
          </button>
        ))}
      </nav>

      <div className={`toast ${toast ? 'show' : ''}`} role="status">
        {toast}
      </div>
    </div>
  )
}
