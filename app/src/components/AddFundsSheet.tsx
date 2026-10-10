import { ETH_FAUCET, GASLESS, USDC_FAUCET } from '../config'
import { Bank, Drop, External } from './icons'
import { Sheet } from './Sheet'

export function AddFundsSheet({ onCopyAddress, onClose }: { onCopyAddress: () => void; onClose: () => void }) {
  const openFaucet = (url: string) => {
    onCopyAddress()
    window.open(url, '_blank', 'noreferrer')
  }

  return (
    <Sheet title="Add funds" onClose={onClose}>
      <div className="options">
        <div className="option disabled">
          <span className="option-icon">
            <Bank />
          </span>
          <div>
            <strong>
              From my Swissquote account <span className="badge mock">MOCK</span>
            </strong>
            <span>Move CHF or USDC from your trading account in one tap. Coming soon.</span>
          </div>
        </div>
        <button className="option" onClick={() => openFaucet(USDC_FAUCET)}>
          <span className="option-icon usdc">$</span>
          <div>
            <strong>Free test USDC</strong>
            <span>Circle faucet · pick “Base Sepolia”, your address is copied</span>
          </div>
          <External />
        </button>
        {!GASLESS && (
          <button className="option" onClick={() => openFaucet(ETH_FAUCET)}>
            <span className="option-icon">
              <Drop />
            </span>
            <div>
              <strong>Free test ETH for gas</strong>
              <span>Coinbase faucet · a tiny amount pays the network fees</span>
            </div>
            <External />
          </button>
        )}
      </div>
    </Sheet>
  )
}
