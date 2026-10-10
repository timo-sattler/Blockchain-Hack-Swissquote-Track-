import type { ReactNode } from 'react'
import { ProfileIcon, SearchIcon } from './icons'

/** Top bar of every tab: optional title, a demo marker, and the round search / profile buttons. */
export function SqHeader({ title, demo = true, children }: { title?: string; demo?: boolean; children?: ReactNode }) {
  return (
    <header className="sq-header">
      <div className="sq-header-row">
        {demo ? <span className="sq-demo" title="Mock data for the prototype">Demo data</span> : <span />}
        {title && <h1 className="sq-title">{title}</h1>}
        <div className="sq-round-buttons">
          <button className="sq-round" aria-label="Search">
            <SearchIcon />
          </button>
          <button className="sq-round" aria-label="Profile">
            <ProfileIcon />
          </button>
        </div>
      </div>
      {children}
    </header>
  )
}
