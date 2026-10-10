import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { Copy } from './icons'
import { Sheet } from './Sheet'

export function ReceiveSheet({ address, onCopy, onClose }: { address: Address; onCopy: () => void; onClose: () => void }) {
  const [qr, setQr] = useState('')

  useEffect(() => {
    QRCode.toDataURL(address, { width: 440, margin: 1, color: { dark: '#11141a', light: '#ffffff' } }).then(setQr)
  }, [address])

  return (
    <Sheet title="Receive" onClose={onClose}>
      <div className="receive">
        <div className="qr">{qr && <img src={qr} alt="QR code of your wallet address" />}</div>
        <p className="muted center small">Scan to send USDC or ETH on Base Sepolia to this wallet.</p>
        <code className="address-block">{address}</code>
        <button className="primary big with-icon" onClick={onCopy}>
          <Copy /> Copy address
        </button>
        <p className="fineprint">Only send assets on the Base Sepolia network. Other networks will not arrive.</p>
      </div>
    </Sheet>
  )
}
