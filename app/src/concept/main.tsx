import { StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './concept.css'

// Design concept only: Apple-inspired look for the wallet, with example data. Not wired to the MPC wallet.

const Icon = ({ d, size = 22, stroke = 2 }: { d: string; size?: number; stroke?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const I = {
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 18l-6-6 6-6',
  faceid: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.2 4.4 1.2 6 0',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16.5 13.5h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  bank: 'M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M12 3 3 8h18z',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  check: 'M20 6 9 17l-5-5',
  del: 'M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM12 9l6 6M18 9l-6 6',
}

function Phone({ caption, children, tab }: { caption: string; children: ReactNode; tab?: 'wallet' | 'activity' | 'security' }) {
  return (
    <figure className="device">
      <div className="phone">
        <div className="island" />
        <div className="statusbar">
          <span>9:41</span>
          <span className="status-icons">
            <i className="bars" />
            <i className="battery" />
          </span>
        </div>
        <div className="screen">{children}</div>
        {tab && (
          <nav className="tabbar">
            {(
              [
                ['wallet', 'Wallet', I.wallet],
                ['activity', 'Activity', I.clock],
                ['security', 'Security', I.shield],
              ] as const
            ).map(([id, label, d]) => (
              <span key={id} className={id === tab ? 'on' : ''}>
                <Icon d={d} size={24} />
                {label}
              </span>
            ))}
          </nav>
        )}
        <div className="home-indicator" />
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function Onboarding() {
  return (
    <Phone caption="1 · Create with Face ID">
      <div className="onb">
        <div className="onb-glyph">
          <Icon d={I.faceid} size={64} stroke={1.6} />
        </div>
        <h1>
          Your keys.
          <br />
          Your wallet.
        </h1>
        <p>Bitcoin and Ethereum in one place. No seed phrase: Face ID and a recovery kit you keep.</p>
        <ul className="onb-points">
          <li>
            <span className="tint-blue">
              <Icon d={I.phone} size={20} />
            </span>
            <div>
              <b>Your phone holds a key share</b>
              <span>The full key never exists anywhere.</span>
            </div>
          </li>
          <li>
            <span className="tint-orange">
              <Icon d={I.bank} size={20} />
            </span>
            <div>
              <b>Swissquote can never act alone</b>
              <span>It checks and co-signs, nothing more.</span>
            </div>
          </li>
          <li>
            <span className="tint-purple">
              <Icon d={I.doc} size={20} />
            </span>
            <div>
              <b>Lose your phone, not your money</b>
              <span>Recover with your kit and an ID check.</span>
            </div>
          </li>
        </ul>
        <button className="btn-filled">Continue</button>
        <button className="btn-plain">I already have a wallet</button>
      </div>
    </Phone>
  )
}

const ASSETS = [
  { name: 'Bitcoin', sym: 'BTC', amount: '0.0120', chf: '826.07', color: '#F7931A', glyph: '₿' },
  { name: 'Ethereum', sym: 'ETH', amount: '0.2500', chf: '520.57', color: '#627EEA', glyph: 'Ξ' },
  { name: 'USD Coin', sym: 'USDC', amount: '120.00', chf: '99.53', color: '#2775CA', glyph: '$' },
]

const ACTIVITY = [
  { who: 'Grace', what: 'Received', amount: '+20.00 USDC', when: 'Today, 14:46', in: true },
  { who: 'Timo', what: 'Sent', amount: '−5.00 USDC', when: 'Today, 12:10', in: false },
  { who: 'Swissquote', what: 'Welcome bonus', amount: '+20.00 USDC', when: 'Yesterday', in: true },
]

function Home() {
  return (
    <Phone caption="2 · Wallet" tab="wallet">
      <div className="nav-large">
        <span className="nav-small-row">
          <span className="avatar">AM</span>
        </span>
        <h1>Wallet</h1>
      </div>
      <div className="pass">
        <div className="pass-top">
          <span>Self-Custody</span>
          <span className="pass-chip">2 of 3</span>
        </div>
        <div className="pass-balance">
          <small>Total balance</small>
          <strong>
            CHF 1’446<span>.17</span>
          </strong>
        </div>
        <div className="pass-bottom">
          <span>Bitcoin · Ethereum · USDC</span>
          <span>Swissquote</span>
        </div>
      </div>
      <div className="quick">
        {(
          [
            ['Send', I.up],
            ['Receive', I.down],
            ['Add', I.plus],
          ] as const
        ).map(([label, d]) => (
          <button key={label}>
            <span>
              <Icon d={d} />
            </span>
            {label}
          </button>
        ))}
      </div>
      <h2 className="section">Assets</h2>
      <ul className="group">
        {ASSETS.map((a) => (
          <li key={a.sym}>
            <span className="coin" style={{ background: a.color }}>
              {a.glyph}
            </span>
            <div className="cell-main">
              <b>{a.name}</b>
              <span>
                {a.amount} {a.sym}
              </span>
            </div>
            <div className="cell-value">CHF {a.chf}</div>
            <span className="chev">
              <Icon d={I.chevron} size={16} />
            </span>
          </li>
        ))}
      </ul>
      <h2 className="section">
        Latest Activity <a>See All</a>
      </h2>
      <ul className="group">
        {ACTIVITY.slice(0, 2).map((t) => (
          <li key={t.when}>
            <span className={`round ${t.in ? 'in' : 'out'}`}>
              <Icon d={t.in ? I.down : I.up} size={18} />
            </span>
            <div className="cell-main">
              <b>{t.who}</b>
              <span>
                {t.what} · {t.when}
              </span>
            </div>
            <div className={`cell-value ${t.in ? 'pos' : ''}`}>{t.amount}</div>
          </li>
        ))}
      </ul>
    </Phone>
  )
}

function Send() {
  const [amount, setAmount] = useState('25')
  const [asset, setAsset] = useState('USDC')
  const press = (k: string) =>
    setAmount((a) => (k === 'del' ? a.slice(0, -1) || '0' : k === '.' && a.includes('.') ? a : a === '0' && k !== '.' ? k : (a + k).slice(0, 9)))
  return (
    <Phone caption="3 · Send with Face ID">
      <div className="sheet-modal">
        <div className="grabber" />
        <div className="sheet-nav">
          <a>Cancel</a>
          <b>Send</b>
          <span />
        </div>
        <div className="segmented-ios">
          {['BTC', 'ETH', 'USDC'].map((s) => (
            <button key={s} className={s === asset ? 'on' : ''} onClick={() => setAsset(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="to-row">
          <span className="avatar small">GR</span>
          <div>
            <b>Grace</b>
            <span>0x5f69…1D1a · Base</span>
          </div>
        </div>
        <div className="amount-big">
          <span>{amount}</span>
          <small>{asset}</small>
        </div>
        <p className="amount-sub">≈ CHF {(Number(amount || 0) * (asset === 'USDC' ? 0.83 : asset === 'ETH' ? 2082 : 68839)).toFixed(2)} · Network fee: free</p>
        <div className="checks">
          <span>
            <Icon d={I.check} size={14} stroke={3} /> Not on any sanctions list
          </span>
          <span>
            <Icon d={I.check} size={14} stroke={3} /> Swissquote co-signs
          </span>
        </div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
            <button key={k} onClick={() => press(k)}>
              {k === 'del' ? <Icon d={I.del} size={22} stroke={1.8} /> : k}
            </button>
          ))}
        </div>
        <button className="btn-filled pay">
          <Icon d={I.faceid} size={22} /> Pay with Face ID
        </button>
      </div>
    </Phone>
  )
}

function Security() {
  const [alerts, setAlerts] = useState(true)
  return (
    <Phone caption="4 · Security & recovery" tab="security">
      <div className="nav-large">
        <span className="nav-small-row" />
        <h1>Security</h1>
      </div>
      <div className="shares-hero">
        <div className="share-dots">
          <span className="dot a">A</span>
          <span className="dot b">B</span>
          <span className="dot c">C</span>
        </div>
        <b>Any 2 of 3 key shares sign</b>
        <span>No one, not even Swissquote, holds your whole key.</span>
      </div>
      <h2 className="section">Key Shares</h2>
      <ul className="group">
        {(
          [
            ['A', 'This iPhone', 'Unlocked with Face ID', 'Active', 'a'],
            ['B', 'Swissquote', 'Checks and co-signs', 'Online', 'b'],
            ['C', 'Recovery Kit', 'Saved 2 days ago', 'Yours', 'c'],
          ] as const
        ).map(([letter, title, sub, status, cls]) => (
          <li key={letter}>
            <span className={`dot ${cls} small`}>{letter}</span>
            <div className="cell-main">
              <b>{title}</b>
              <span>{sub}</span>
            </div>
            <div className="cell-value muted">{status}</div>
            <span className="chev">
              <Icon d={I.chevron} size={16} />
            </span>
          </li>
        ))}
      </ul>
      <h2 className="section">Recovery</h2>
      <ul className="group">
        <li>
          <div className="cell-main">
            <b>Recovery delay</b>
          </div>
          <div className="cell-value muted">48 hours</div>
          <span className="chev">
            <Icon d={I.chevron} size={16} />
          </span>
        </li>
        <li>
          <div className="cell-main">
            <b>Alert all my devices</b>
          </div>
          <button className={`switch ${alerts ? 'on' : ''}`} onClick={() => setAlerts(!alerts)} aria-label="Alerts">
            <i />
          </button>
        </li>
        <li>
          <div className="cell-main">
            <b className="tint-text">Lost your iPhone?</b>
          </div>
          <span className="chev">
            <Icon d={I.chevron} size={16} />
          </span>
        </li>
      </ul>
      <p className="footnote">Swissquote can never move or freeze your funds. With your kit you can sign even if Swissquote is offline.</p>
    </Phone>
  )
}

function Concept() {
  return (
    <main className="concept">
      <header>
        <p className="eyebrow">Design proposal</p>
        <h1>An Apple-inspired wallet</h1>
        <p>
          System font, large titles, inset grouped lists, translucent bars and Apple's system colors, with Swissquote orange as the only
          accent. The balance sits on a Wallet-style pass, sending feels like Apple Cash, and security is a settings screen everyone
          already knows how to read.
        </p>
      </header>
      <div className="devices">
        <Onboarding />
        <Home />
        <Send />
        <Security />
      </div>
      <footer>Concept with example data · try the keypad, the asset switch and the toggle · the live wallet stays at /</footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Concept />
  </StrictMode>,
)
