import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { FeedItem } from './live'

/** Invites the audience to create a wallet on their own phone; their events then show up live. */
export function JoinSlide({ items }: { items: FeedItem[] }) {
  const url = window.location.origin
  const [qr, setQr] = useState('')
  const local = /localhost|127\.0\.0\.1/.test(url)

  useEffect(() => {
    QRCode.toDataURL(url, { width: 640, margin: 1, color: { dark: '#161a24', light: '#ffffff' } }).then(setQr)
  }, [url])

  const created = items.filter((i) => i.type === 'wallet_created' && i.source !== 'simulated')
  const names = created.map((i) => (i.type === 'wallet_created' && i.name ? i.name.split(' ')[0] : null)).filter(Boolean)

  return (
    <div className="join">
      <div className="join-text">
        <p className="kicker">Try it yourself</p>
        <h1>Create your own wallet, right now</h1>
        <ol>
          <li>Scan the code with your phone camera</li>
          <li>Open the Crypto tab and enter your name</li>
          <li>Confirm with Face ID or your fingerprint</li>
        </ol>
        <p className="join-count">
          <strong>{created.length}</strong> {created.length === 1 ? 'wallet' : 'wallets'} created live
          {names.length > 0 && <span> · {names.slice(-6).join(', ')}</span>}
        </p>
        {local && <p className="join-warning">Running on localhost: start the Cloudflare tunnel so phones can join.</p>}
      </div>
      <div className="join-qr">
        {qr && <img src={qr} alt={`QR code for ${url}`} />}
        <code>{url.replace(/^https?:\/\//, '')}</code>
      </div>
    </div>
  )
}
