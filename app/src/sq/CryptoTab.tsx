import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { Onboarding } from '../components/Onboarding'
import { RecoverFlow } from '../components/RecoverFlow'
import { Sheet } from '../components/Sheet'
import { Spinner } from '../components/icons'
import { WalletHome } from '../components/WalletHome'
import { explainError, forgetPasskey, getAccount, loadPasskey, savePasskey, type SmartAccount, type StoredPasskey } from '../wallet'
import { CLIENT, CUSTODIED_CRYPTO, formatChf } from './mockData'
import { SqHeader } from './SqHeader'

export function CryptoTab({ onToast }: { onToast: (message: string) => void }) {
  const [passkey, setPasskey] = useState<StoredPasskey | null>(loadPasskey)
  const [account, setAccount] = useState<SmartAccount | null>(null)
  const [justCreated, setJustCreated] = useState(false)
  const [moving, setMoving] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    setLoadError('')
    if (!passkey) return setAccount(null)
    getAccount(passkey).then(setAccount, (e) => setLoadError(explainError(e)))
  }, [passkey])

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
          <i /> Live on Base Sepolia
        </span>
      </div>
      <p className="sq-section-sub">Your keys, on your phone. Swissquote cannot move these funds.</p>

      <div className="sq-wallet">
        {!passkey && !recovering && (
          <Onboarding
            clientName={CLIENT.name}
            onCreated={(created) => {
              savePasskey(created)
              setJustCreated(true)
              setPasskey(created)
            }}
            onRecover={() => setRecovering(true)}
          />
        )}
        {!passkey && recovering && (
          <RecoverFlow
            onRecovered={(recovered) => {
              setRecovering(false)
              setJustCreated(false)
              setPasskey(recovered)
              onToast('Wallet recovered to this phone')
            }}
            onCancel={() => setRecovering(false)}
          />
        )}
        {passkey && loadError && <p className="error center">{loadError}</p>}
        {passkey && !account && !loadError && (
          <div className="loading">
            <Spinner /> Loading your wallet…
          </div>
        )}
        {passkey && account && (
          <WalletHome
            account={account}
            passkey={passkey}
            justCreated={justCreated}
            onToast={onToast}
            onForget={() => {
              forgetPasskey()
              setJustCreated(false)
              setPasskey(null)
            }}
          />
        )}
      </div>

      {moving && <MoveSheet address={account?.address ?? null} onClose={() => setMoving(false)} />}
    </>
  )
}

/** Mocked withdrawal from Swissquote custody to the client's own wallet: shows the intended flow. */
function MoveSheet({ address, onClose }: { address: Address | null; onClose: () => void }) {
  return (
    <Sheet title="Move to self-custody" onClose={onClose}>
      <div className="sq-move">
        <span className="badge mock">MOCK · no funds are moved</span>
        <ol>
          <li>
            <strong>Choose asset and amount</strong>
            <span>For example 500 USDC from your Swissquote crypto account.</span>
          </li>
          <li>
            <strong>Destination is already verified</strong>
            <span>
              {address ? (
                <>
                  Your wallet <code>{address.slice(0, 6)}…{address.slice(-4)}</code> was linked to your client profile
                  with a passkey signature, so no extra ownership check is needed.
                </>
              ) : (
                'Create your wallet below first. Its address is linked to your profile with a passkey signature.'
              )}
            </span>
          </li>
          <li>
            <strong>Swissquote sends it on-chain</strong>
            <span>After the usual AML checks. From then on only your passkey can move it.</span>
          </li>
        </ol>
        <button className="primary big" onClick={onClose}>
          Got it
        </button>
      </div>
    </Sheet>
  )
}
