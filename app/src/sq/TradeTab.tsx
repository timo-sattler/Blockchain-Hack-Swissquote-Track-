import { useState } from 'react'
import { Chevron, ChevronDown, SortIcon, SwissFlag } from './icons'
import { formatChf, MARKETS } from './mockData'
import { SqHeader } from './SqHeader'

const SECTIONS = ['Watchlists', 'Inspiration', 'Markets', 'News', 'Alerts'] as const
const FILTERS = ['Shares', 'Crypto', 'Indices', 'Components'] as const
type Filter = (typeof FILTERS)[number]

const TITLES: Record<Filter, string> = {
  Shares: 'Most traded shares',
  Crypto: 'Crypto prices',
  Indices: 'Major indices',
  Components: 'Components of indices',
}

export function TradeTab() {
  const [filter, setFilter] = useState<Filter>('Components')
  const [updated] = useState(() => new Date().toLocaleTimeString('de-CH'))

  return (
    <>
      <SqHeader>
        <nav className="sq-sections">
          {SECTIONS.map((section) => (
            <button key={section} className={section === 'Markets' ? 'active' : ''}>
              {section}
            </button>
          ))}
        </nav>
        <div className="sq-filters">
          {FILTERS.map((f) => (
            <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </SqHeader>
      <p className="sq-updated">Updated: {updated}</p>

      <section className="sq-card">
        <div className="sq-card-head">
          <h2>{TITLES[filter]}</h2>
          <button className="sq-link-btn">
            <SortIcon /> Sort
          </button>
        </div>
        {filter === 'Components' && (
          <button className="sq-index-picker">
            <SwissFlag /> SMI <ChevronDown />
          </button>
        )}
        <ul className="sq-quotes">
          {MARKETS[filter].map((q) => (
            <li key={q.symbol}>
              {q.flag ? <span className="sq-quote-spacer" /> : <span className="sq-badge-t">T</span>}
              <div className="sq-quote-name">
                <strong>{q.symbol}</strong>
                <span>{q.name}</span>
              </div>
              <span className="sq-quote-price">
                {formatChf(q.price)} <small>{q.currency}</small>
              </span>
              <span className={`sq-change ${q.changePct >= 0 ? 'up' : 'down'}`}>{q.changePct.toFixed(2)} %</span>
              <Chevron />
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
