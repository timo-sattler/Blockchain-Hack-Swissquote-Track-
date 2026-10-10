import type { CSSProperties } from 'react'

const COLORS = ['#e30613', '#ffb020', '#2fbf71', '#3b82f6', '#a855f7', '#ffffff']

/** CSS-only confetti burst. Positions are derived from the index so renders stay stable. */
export function Confetti({ pieces = 48 }: { pieces?: number }) {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: pieces }, (_, i) => {
        const angle = (i * 137.5) % 360
        const distance = 90 + ((i * 53) % 140)
        const style = {
          '--x': `${Math.cos((angle * Math.PI) / 180) * distance}px`,
          '--y': `${Math.sin((angle * Math.PI) / 180) * distance - 60}px`,
          '--r': `${(i * 97) % 720}deg`,
          '--d': `${(i % 7) * 40}ms`,
          background: COLORS[i % COLORS.length],
        } as CSSProperties
        return <i key={i} style={style} />
      })}
    </div>
  )
}
