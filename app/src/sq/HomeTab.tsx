import { useState } from 'react'
import { InstallHint } from '../components/InstallHint'
import { AddMoneyIcon, AssetsIcon, CashIcon, Chevron, CoinIcon, ListIcon, SwapIcon, SwissFlag, WalletIcon } from './icons'
import { CLIENT, formatChf, PERFORMANCE, PORTFOLIO, type Period } from './mockData'
import { SqHeader } from './SqHeader'

const PERIODS: Period[] = ['1W', '1M', '6M', '1Y', 'All']

export function HomeTab({ onOpenCrypto }: { onOpenCrypto: () => void }) {
  const [period, setPeriod] = useState<Period>('1W')
  const tiles = [
    { label: 'Assets', value: PORTFOLIO.tiles.assets, icon: <AssetsIcon /> },
    { label: 'Crypto', value: PORTFOLIO.tiles.crypto, icon: <CoinIcon />, onClick: onOpenCrypto },
    { label: 'Cash', value: PORTFOLIO.tiles.cash, icon: <CashIcon /> },
    { label: 'Buying power', value: PORTFOLIO.tiles.buyingPower, icon: <WalletIcon /> },
  ]

  return (
    <>
      <SqHeader />
      <InstallHint />
      <div className="sq-total">
        <span>Total value</span>
        <strong>
          {formatChf(PORTFOLIO.totalValue)} <small>CHF</small>
        </strong>
      </div>

      <section className="sq-card sq-trading">
        <p className="sq-muted-title">Trading {CLIENT.tradingAccount}</p>
        <p className="sq-big-value">
          {formatChf(PORTFOLIO.trading)} <SwissFlag size={22} />
        </p>
        <p className="sq-gain">
          +{formatChf(PORTFOLIO.dailyChange)} CHF <span>▲ {PORTFOLIO.dailyChangePct}%</span> <em>daily change</em>
        </p>
        <p className="sq-gain">
          +{formatChf(PORTFOLIO.absolutePerformance)} CHF <em>absolute performance</em>
        </p>
        <AreaChart points={PERFORMANCE[period]} />
        <div className="sq-periods" role="tablist">
          {PERIODS.map((p) => (
            <button key={p} role="tab" aria-selected={p === period} className={p === period ? 'active' : ''} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </section>

      <div className="sq-tiles">
        {tiles.map((tile) => (
          <button key={tile.label} className={`sq-tile ${tile.onClick ? 'link' : ''}`} onClick={tile.onClick}>
            <span className="sq-tile-label">
              {tile.icon} {tile.label}
              <Chevron />
            </span>
            <strong>{formatChf(tile.value)}</strong>
          </button>
        ))}
      </div>

      <div className="sq-quick">
        <button>
          <span>
            <SwapIcon />
          </span>
          Open orders
        </button>
        <button>
          <span>
            <ListIcon />
          </span>
          Transactions
        </button>
        <button>
          <span>
            <AddMoneyIcon />
          </span>
          Add money
        </button>
      </div>
    </>
  )
}

function AreaChart({ points }: { points: number[] }) {
  const width = 320
  const height = 110
  const step = width / (points.length - 1)
  const coords = points.map((p, i) => [i * step, 8 + (1 - p) * (height - 16)] as const)
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return (
    <svg className="sq-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Portfolio performance">
      <defs>
        <linearGradient id="sq-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b8def" stopOpacity="0.28" />
          <stop offset="1" stopColor="#5b8def" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="url(#sq-area)" />
      <path d={line} fill="none" stroke="#5b8def" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
