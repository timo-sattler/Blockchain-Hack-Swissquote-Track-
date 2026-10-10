import { useState } from 'react'
import { BasketIcon, Chevron, EyeIcon, GearIcon, HotelIcon, InfoIcon, LockIcon, TrainIcon } from './icons'
import { CARD, CARD_TRANSACTIONS, formatChf } from './mockData'
import { SqHeader } from './SqHeader'

const ICONS = { train: <TrainIcon />, basket: <BasketIcon />, hotel: <HotelIcon /> }

export function BankTab() {
  const [view, setView] = useState<'Cards' | 'Payments'>('Cards')

  return (
    <>
      <SqHeader title="Everyday banking" />
      <div className="sq-toggle">
        {(['Cards', 'Payments'] as const).map((v) => (
          <button key={v} className={v === view ? 'active' : ''} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>

      {view === 'Cards' ? (
        <>
          <div className="sq-debit">
            <div className="sq-debit-top">
              <span>Debit</span>
              <strong>Swissquote</strong>
            </div>
            <div className="sq-debit-bottom">
              <span>•••• {CARD.last4}</span>
              <span className="sq-debit-chip" />
            </div>
          </div>
          <div className="sq-available">
            <strong>{formatChf(CARD.available)} CHF</strong>
            <span>
              Available amount to spend <InfoIcon />
            </span>
          </div>
          <div className="sq-card-actions">
            <button>
              <EyeIcon />
              Cards details
            </button>
            <button>
              <LockIcon />
              Lock card
            </button>
            <button>
              <GearIcon />
              Settings
            </button>
          </div>
          <div className="sq-list-head">
            <h2>Cards transactions</h2>
            <button className="sq-link-btn">View all</button>
          </div>
          <ul className="sq-card sq-transactions">
            {CARD_TRANSACTIONS.map((t) => (
              <li key={t.merchant}>
                <span className="sq-tx-icon">{ICONS[t.icon]}</span>
                <span className="sq-tx-name">{t.merchant}</span>
                <span className="sq-tx-amount">
                  {formatChf(t.amount)} CHF
                  <small className={t.status === 'Executed' ? 'done' : ''}>{t.status}</small>
                </span>
                <Chevron />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <section className="sq-card sq-empty">
          <h2>Payments</h2>
          <p>Pay bills, scan QR-bills and set up standing orders. Not part of this prototype.</p>
        </section>
      )}
    </>
  )
}
