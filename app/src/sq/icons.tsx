import type { ReactNode } from 'react'

function Line({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const HomeIcon = () => (
  <Line size={26}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Line>
)
export const TradeIcon = () => (
  <Line size={26}>
    <path d="M5 20V12h3.5v8M10.25 20V5h3.5v15M15.5 20V9H19v11M3.5 20h17" />
  </Line>
)
export const CryptoIcon = () => (
  <Line size={26}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 8v8M10 8h3a2 2 0 0 1 0 4h-3h3.5a2 2 0 0 1 0 4H10M11 6.5V8M13 6.5V8M11 16v1.5M13 16v1.5" />
  </Line>
)
export const BankIcon = () => (
  <Line size={26}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
  </Line>
)
export const PlanIcon = () => (
  <Line size={26}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </Line>
)
export const SearchIcon = () => (
  <Line size={22}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Line>
)
export const ProfileIcon = () => (
  <Line size={22}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 18.2c1.3-1.9 3.2-2.9 5.5-2.9s4.2 1 5.5 2.9" />
  </Line>
)
export const Chevron = () => (
  <Line size={16}>
    <path d="m9 6 6 6-6 6" />
  </Line>
)
export const ChevronDown = () => (
  <Line size={16}>
    <path d="m6 9 6 6 6-6" />
  </Line>
)
export const SortIcon = () => (
  <Line size={18}>
    <path d="M12 4v16M6 14l6 6 6-6" />
  </Line>
)
export const EyeIcon = () => (
  <Line>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Line>
)
export const LockIcon = () => (
  <Line>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
  </Line>
)
export const GearIcon = () => (
  <Line>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Line>
)
export const SwapIcon = () => (
  <Line size={20}>
    <path d="M7 4 3.5 7.5 7 11M3.5 7.5H16M17 13l3.5 3.5L17 20M20.5 16.5H8" />
  </Line>
)
export const ListIcon = () => (
  <Line size={20}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Line>
)
export const AddMoneyIcon = () => (
  <Line size={20}>
    <ellipse cx="10" cy="6.5" rx="6" ry="2.5" />
    <path d="M4 6.5v5c0 1.4 2.7 2.5 6 2.5M4 11.5v5c0 1.4 2.7 2.5 6 2.5M16 6.5V10M18 14v6M15 17h6" />
  </Line>
)
export const TrainIcon = () => (
  <Line size={20}>
    <rect x="5" y="3" width="14" height="14" rx="3" />
    <path d="M5 10h14M8.5 14h.01M15.5 14h.01M8 21l1.5-4M16 21l-1.5-4" />
  </Line>
)
export const BasketIcon = () => (
  <Line size={20}>
    <path d="M3 10h18l-2 9H5zM8 10l4-6 4 6M9 14v2M15 14v2" />
  </Line>
)
export const HotelIcon = () => (
  <Line size={20}>
    <path d="M3 21V9l9-6 9 6v12M9 21v-5h6v5" />
  </Line>
)
export const InfoIcon = () => (
  <Line size={14}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Line>
)
export const AssetsIcon = () => (
  <Line size={16}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 15 3-3 3 2 4-5" />
  </Line>
)
export const CoinIcon = () => (
  <Line size={16}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 8.5v7M10 8.5h2.8a1.8 1.8 0 0 1 0 3.5H10h3.2a1.8 1.8 0 0 1 0 3.5H10" />
  </Line>
)
export const CashIcon = () => (
  <Line size={16}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </Line>
)
export const WalletIcon = () => (
  <Line size={16}>
    <path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z" />
    <path d="M4 7l11-3v3M16 13.5h.01" />
  </Line>
)
export const SwissFlag = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Switzerland">
    <circle cx="12" cy="12" r="12" fill="#e30613" />
    <path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#fff" />
  </svg>
)
