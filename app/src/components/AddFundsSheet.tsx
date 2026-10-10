import { BTC_FAUCET, ETH_FAUCET, USDC_FAUCET } from '../config'
import { Bank, Drop, External } from './icons'
import { Sheet } from './Sheet'

export function AddFundsSheet({ evmAddress, btcAddress, onCopy, onClose }: { evmAddress: string; btcAddress: string; onCopy: (address: string) => void; onClose: () => void }) {
  const open = (url: string, address: string) => {
    onCopy(address)
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
            <span>Move CHF or crypto from your trading account to this verified wallet. Coming soon.</span>
          </div>
        </div>
        <button className="option" onClick={() => open(USDC_FAUCET, evmAddress)}>
          <span className="option-icon usdc">$</span>
          <div>
            <strong>Free test USDC</strong>
            <span>Circle faucet · pick “Base Sepolia”, your 0x address is copied</span>
          </div>
          <External />
        </button>
        <button className="option" onClick={() => open(ETH_FAUCET, evmAddress)}>
          <span className="option-icon">
            <Drop />
          </span>
          <div>
            <strong>Free test ETH for gas</strong>
            <span>Coinbase faucet · Base Sepolia, pays the network fees</span>
          </div>
          <External />
        </button>
        <button className="option" onClick={() => open(BTC_FAUCET, btcAddress)}>
          <span className="option-icon btc">₿</span>
          <div>
            <strong>Free test Bitcoin</strong>
            <span>mempool.space testnet4 faucet · your tb1 address is copied</span>
          </div>
          <External />
        </button>
      </div>
    </Sheet>
  )
}
