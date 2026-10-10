import { MpcWallet } from '../components/mpc/MpcWallet'
import { SqHeader } from './SqHeader'

export function CryptoTab({ onToast }: { onToast: (message: string) => void }) {
  return (
    <>
      <SqHeader title="Crypto" demo={false} />

      <div className="sq-section-title">
        <h2>My self-custody wallet</h2>
        <span className="sq-live">
          <i /> Live on testnets
        </span>
      </div>
      <p className="sq-section-sub">One key in two parts: yours (on your devices) and Swissquote's. Swissquote cannot move these funds alone.</p>

      <div className="sq-wallet">
        <MpcWallet onToast={onToast} />
      </div>
    </>
  )
}
