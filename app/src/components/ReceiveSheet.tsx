import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Copy } from './icons'
import { Sheet } from './Sheet'

export type ReceiveOption = { label: string; network: string; address: string }
export type OtherNetwork = { name: string; detail: string; address: string }

export function ReceiveSheet({
  options,
  others = [],
  onCopy,
  onClose,
}: {
  options: ReceiveOption[]
  others?: OtherNetwork[]
  onCopy: (address: string) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState(0)
  const [qr, setQr] = useState('')
  const option = options[selected]

  useEffect(() => {
    QRCode.toDataURL(option.address, { width: 440, margin: 1, color: { dark: '#11141a', light: '#ffffff' } }).then(setQr)
  }, [option.address])

  return (
    <Sheet title="Receive" onClose={onClose}>
      <div className="receive">
        {options.length > 1 && (
          <div className="segmented" role="tablist">
            {options.map((o, i) => (
              <button key={o.label} role="tab" aria-selected={i === selected} className={i === selected ? 'active' : ''} onClick={() => setSelected(i)}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="qr">{qr && <img src={qr} alt={`QR code of your ${option.label} address`} />}</div>
        <code className="address-block">{option.address}</code>
        <button className="primary big with-icon" onClick={() => onCopy(option.address)}>
          <Copy /> Copy address
        </button>
        <p className="fineprint">This demo shows {option.network} only. Send test assets on that network.</p>
        {others.length > 0 && (
          <div className="other-networks">
            <h3>The same key on other networks</h3>
            <ul>
              {others.map((n) => (
                <li key={n.name}>
                  <div>
                    <strong>{n.name}</strong>
                    <span>{n.detail}</span>
                    <code>{n.address}</code>
                  </div>
                  <button className="icon-btn" onClick={() => onCopy(n.address)} aria-label={`Copy ${n.name} address`}>
                    <Copy />
                  </button>
                </li>
              ))}
            </ul>
            <p className="fineprint">
              All derived from your one public key, so your two parts control them. No contract has to be deployed on any network. This demo
              sends on Base Sepolia and Bitcoin testnet4; turning on another network only needs Swissquote's policy to allow it.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
