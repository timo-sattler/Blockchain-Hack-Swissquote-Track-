import type { ReactNode, SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const ArrowUp = () => (
  <Icon>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
)
export const ArrowDown = () => (
  <Icon>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </Icon>
)
export const Plus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const Copy = () => (
  <Icon width="16" height="16">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Icon>
)
export const Check = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)
export const Close = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)
export const External = () => (
  <Icon width="14" height="14">
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
)
export const Shield = () => (
  <Icon>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)
export const Fingerprint = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </Icon>
)
export const Bank = () => (
  <Icon>
    <path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M12 3 3 8h18z" />
  </Icon>
)
export const Users = () => (
  <Icon>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
)
export const Drop = () => (
  <Icon>
    <path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z" />
  </Icon>
)
export const Spinner = () => (
  <svg className="spinner" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)
