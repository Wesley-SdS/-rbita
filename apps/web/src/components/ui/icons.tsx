/**
 * Ícones em SVG (traço, 24x24, herdam `currentColor`). Substituem os emojis da
 * UI: emoji renderiza com a fonte do sistema, o que deixa a interface com cara
 * datada e inconsistente entre plataformas.
 */
type P = { size?: number; className?: string };
const base = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export const IconVolume = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const IconVolumeOff = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </svg>
);

export const IconMic = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v4" />
  </svg>
);

export const IconStop = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChat = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" />
  </svg>
);

export const IconMenu = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconSend = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const IconSun = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className} aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
