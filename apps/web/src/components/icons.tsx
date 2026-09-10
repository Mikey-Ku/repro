import type { SVGProps } from 'react';

/**
 * Small inline icons. Every icon is decorative by default (aria-hidden) and
 * sized by the parent through the `size` prop. No icon font, no emoji.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  };
}

export const IconOverview = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

export const IconSessions = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconIncidents = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l9.5 16.5H2.5z" />
    <path d="M12 10v4" />
    <path d="M12 17.5h.01" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconClick = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 4l6 15 2.5-6.5L20 10z" />
  </svg>
);

export const IconInput = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M8 10v4" />
  </svg>
);

export const IconNavigate = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const IconError = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16h.01" />
  </svg>
);

export const IconConsole = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 7l5 5-5 5" />
    <path d="M12 17h7" />
  </svg>
);

export const IconNetwork = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 17l4-4 4 4 8-8" />
    <path d="M14 9h6v6" />
  </svg>
);

export const IconTag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12l-8 8-9-9V3h8z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
  </svg>
);

export const IconUser = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconJump = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5l8 7-8 7z" fill="currentColor" stroke="none" />
    <path d="M18 5v14" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v11" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12l4 4L19 7" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);
