// Line icons in the style of the Swissquote app (24×24, 1.8 stroke, currentColor).
import type { ReactNode } from "react";

const Svg = ({ children, size = 24 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const BackIcon = () => (
  <Svg size={20}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const HomeIcon = () => (
  <Svg>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5V20h12V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Svg>
);
export const SendIcon = () => (
  <Svg>
    <path d="M7 17 17 7" />
    <path d="M8.5 7H17v8.5" />
  </Svg>
);
export const ReceiveIcon = () => (
  <Svg>
    <path d="M17 7 7 17" />
    <path d="M15.5 17H7V8.5" />
  </Svg>
);
export const BankIcon = () => (
  <Svg>
    <path d="M3.5 9 12 4.5 20.5 9" />
    <path d="M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8" />
    <path d="M3.5 20h17" />
  </Svg>
);
export const ProfileIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c1.2-3.7 4.1-5.5 7.5-5.5s6.3 1.8 7.5 5.5" />
  </Svg>
);
export const ShieldIcon = () => (
  <Svg>
    <path d="M12 3.5 19 6v5.5c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);
export const AppsIcon = () => (
  <Svg>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </Svg>
);
export const ChevronIcon = () => (
  <Svg size={18}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);
export const SearchIcon = () => (
  <Svg size={22}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const LockIcon = () => (
  <Svg size={22}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
  </Svg>
);

// The round orange Swissquote mark: a bar over an arched "m", cut in the background colour.
export const MARK_PATH = "M8 9.5h16v2.4H8zM8 14.5h16v8.2h-2.9v-3.9a1.8 1.8 0 0 0-3.6 0v3.9h-3v-3.9a1.8 1.8 0 0 0-3.6 0v3.9H8z";
export const SqMark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="16" fill="#f0582f" />
    <path d={MARK_PATH} fill="#222" />
  </svg>
);
