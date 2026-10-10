import { useState } from 'react'
import { MpcWallet } from '../components/mpc/MpcWallet'
import { Sheet } from '../components/Sheet'
import { loadPhoneWallet } from '../mpc/store'
import { CUSTODIED_CRYPTO, formatChf } from './mockData'
import { SqHeader } from './SqHeader'

export function CryptoTab({ onToast }: { onToast: (message: string) => void }) {
  const [moving, setMoving] = useState(false)
  const custodiedTotal = CUSTODIED_CRYPTO.reduce((sum, coin) => sum + coin.valueChf, 0)

  return (
    <>
      <SqHeader title="Crypto" demo={false} />

      <section className="sq-card sq-custody">
        <div className="sq-card-head">
          <h2>Held by Swissquote</h2>
          <span className="sq-demo">Demo data</span>
        </div>
        <p className="sq-big-value">
          {formatChf(custodiedTotal)} <small>CHF</small>
        </p>
        <ul className="sq-coins">
          {CUSTODIED_CRYPTO.map((coin) => (
            <li key={coin.symbol}>
              <span className="sq-coin" style={{ background: coin.color }}>
                {coin.symbol[0]}
              </span>
              <div>
                <strong>{coin.name}</strong>
                <span>
                  {coin.amount} {coin.symbol}
                </span>
              </div>
              <span className="sq-coin-value">{formatChf(coin.valueChf)} CHF</span>
            </li>
          ))}
        </ul>
        <button className="sq-outline" onClick={() => setMoving(true)}>
          Move to my self-custody wallet
        </button>
      </section>

      <div className="sq-section-title">
        <h2>My self-custody wallet</h2>
        <span className="sq-live">
          <i /> Live on testnets
        </span>
      </div>
      <p className="sq-section-sub">Your keys, split into three shares. Swissquote cannot move these funds.</p>

      <div className="sq-wallet">
        <MpcWallet onToast={onToast} />
      </div>

      {moving && <MoveSheet address={loadPhoneWallet()?.evmAddress ?? null} onClose={() => setMoving(false)} />}
    </>
  )
}

/** Mocked withdrawal from Swissquote custody to the client's own wallet: shows the intended flow. */
function MoveSheet({ address, onClose }: { address: string | null; onClose: () => void }) {
  return (
    <Sheet title="Move to self-custody" onClose={onClose}>
      <div className="sq-move">
        <span className="badge mock">MOCK · no funds are moved</span>
        <ol>
          <li>
            <strong>Choose asset and amount</strong>
            <span>For example 500 USDC or 0.01 BTC from your Swissquote crypto account.</span>
          </li>
          <li>
            <strong>Destination is already verified</strong>
            <span>
              {address ? (
                <>
                  Your wallet <code>{address.slice(0, 6)}…{address.slice(-4)}</code> was created in your logged-in Swissquote app, and
                  Swissquote holds one of its key shares. Its registry links the address to your client ID, so no extra ownership check is
                  needed.
                </>
              ) : (
                'Create your wallet below first. Its addresses are registered to your client ID when it is created.'
              )}
            </span>
          </li>
          <li>
            <strong>Swissquote sends it on-chain</strong>
            <span>After the usual AML checks. From then on it takes two of your three key shares to move it.</span>
          </li>
        </ol>
        <button className="primary big" onClick={onClose}>
          Got it
        </button>
      </div>
    </Sheet>
  )
}
