import { formatEther, formatUnits } from 'viem'

export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`

export const formatUsdc = (value: bigint) =>
  Number(formatUnits(value, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatEth = (value: bigint) => Number(formatEther(value)).toLocaleString('en-US', { maximumFractionDigits: 5 })

export function timeAgo(timestamp: number) {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function formatDuration(seconds: number) {
  if (seconds < 120) return `${seconds} s`
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}
