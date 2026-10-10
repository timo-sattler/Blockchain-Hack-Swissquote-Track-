import QRCode from 'qrcode'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Feed } from './Feed'
import { useLiveData } from './live'
import { NetworkGraph } from './NetworkGraph'
import './present.css'

/** One live page that shows everything: wallets, who holds which key share, payments, and the services' health. */
function Dashboard() {
  const { items, status, shareOnline, members, treasury, reset } = useLiveData()
  const appUrl = `${window.location.origin}/`

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="dash-brand">
          <img src="/favicon.svg" alt="" width="44" height="44" />
          <div>
            <h1>Swissquote Self-Custody Wallet · Live</h1>
            <p>2-of-3 MPC · one key for Bitcoin testnet4 and Base Sepolia · any two of phone, Swissquote and recovery kit sign</p>
          </div>
        </div>
        <div className="dash-pills">
          <span className={`live-pill ${status}`}>
            <i /> {status === 'connected' ? 'Event hub live' : 'Event hub offline'}
          </span>
          <span className={`live-pill ${shareOnline ? 'connected' : 'offline'}`}>
            <i /> {shareOnline ? 'Swissquote share service online' : 'Swissquote share service offline'}
          </span>
          <button
            className="reset-btn"
            onClick={() => {
              if (confirm('Reset the live view? Activity and payment arrows are cleared for everyone. Wallets stay.')) reset()
            }}
          >
            ↺ Reset
          </button>
          {treasury && (
            <span className="live-pill neutral">
              <i /> Treasury {Number(treasury.usdc).toFixed(0)} USDC · {Number(treasury.eth).toFixed(4)} ETH
            </span>
          )}
        </div>
      </header>

      <main className="dash-grid">
        <section className="panel panel-network">
          <h2>Wallets, key shares and payments</h2>
          <NetworkGraph items={items} members={members} treasury={treasury} />
        </section>
        <section className="panel panel-feed">
          <h2>Activity</h2>
          <Feed items={items} />
        </section>
      </main>

      <footer className="dash-foot">
        <JoinLink url={appUrl} />
        <p>Testnets only · Swissquote backend, KYC and sanctions list are mocks · Prototype for the Swissquote Wallet Challenge, not an official Swissquote app</p>
      </footer>
    </div>
  )
}

function JoinLink({ url }: { url: string }) {
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#161a24', light: '#ffffff' } }).then(setQr)
  }, [url])
  return (
    <a className="join-link" href={url} target="_blank" rel="noreferrer">
      {qr && <img src={qr} alt={`QR code for ${url}`} />}
      <span>
        <strong>Create your wallet</strong>
        <code>{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</code>
      </span>
    </a>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
