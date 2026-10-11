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
