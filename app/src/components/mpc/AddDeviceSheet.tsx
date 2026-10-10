import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { describePasskeyError, inviteDevice, walletDetails } from '../../mpc/flows'
import type { PhoneWallet } from '../../mpc/store'
import { Spinner } from '../icons'
import { Sheet } from '../Sheet'

/**
 * Face ID here, then a one-time link / QR code. The other device opens it, creates its own passkey and
 * receives an identical, encrypted copy of this device's key part. Swissquote cannot read the copy.
 */
export function AddDeviceSheet({ wallet, deviceCount, onAdded, onClose }: { wallet: PhoneWallet; deviceCount: number; onAdded: (name: string) => void; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [qr, setQr] = useState('')
  const [expires, setExpires] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    inviteDevice(wallet).then(
      async (invite) => {
        setLink(invite.link)
        setExpires(invite.expires)
        setQr(await QRCode.toDataURL(invite.link, { width: 440, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#11141a', light: '#ffffff' } }))
      },
      (e) => setError(describePasskeyError(e)),
    )
  }, [wallet])

  // Close by itself once the other device shows up at Swissquote.
  useEffect(() => {
    if (!link) return
    const timer = setInterval(async () => {
      setNow(Date.now())
      const details = await walletDetails(wallet.walletId).catch(() => null)
      if (details && details.devices.length > deviceCount) {
        clearInterval(timer)
        onAdded(details.devices[details.devices.length - 1].name)
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [link, wallet.walletId, deviceCount, onAdded])

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the link and copy it manually.')
    }
  }

  const secondsLeft = Math.max(0, Math.round((expires - now) / 1000))

  return (
    <Sheet title="Add a device" onClose={onClose}>
      {!link && !error && (
        <p className="loading-line">
          <Spinner /> Confirm with Face ID to copy your key part…
        </p>
      )}
      {link && (
        <div className="add-device">
          <p className="muted small">
            Scan this with your other device (phone or second laptop), or send yourself the link. It creates its own Face ID passkey and gets an
            identical copy of your key part, encrypted so that Swissquote cannot read it.
          </p>
          {qr && <img className="qr" src={qr} alt="QR code to add a device" />}
          <code className="request-link">{link}</code>
          <button className="secondary" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <p className="kit-note">
            Treat this link like a key: it works once, for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} more minutes. Waiting for your other
            device…
          </p>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </Sheet>
  )
}
