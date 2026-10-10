import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Copy } from './icons'
import { Sheet } from './Sheet'

export type ReceiveOption = { label: string; network: string; address: string }

export function ReceiveSheet({ options, onCopy, onClose }: { options: ReceiveOption[]; onCopy: (address: string) => void; onClose: () => void }) {
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
        <p className="fineprint">Only send on {option.network}. Assets sent on other networks will not arrive.</p>
      </div>
    </Sheet>
  )
}
