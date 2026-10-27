interface IconProps {
  className?: string
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 5.5h6l2 2.5h11v10.5h-19z" />
    </svg>
  )
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  )
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 22 20.5H2z" />
      <path d="M12 10v4.5M12 17.4v.2" />
    </svg>
  )
}

export function DatabaseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V9h-5.5" />
    </svg>
  )
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5 7.5 20h9l1-13.5M10.5 10v6.5M13.5 10v6.5" />
    </svg>
  )
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13.5 4.5H20v6.5" />
      <path d="M20 4.5 11 13.5" />
      <path d="M18 14v5.5H4.5V6H10" />
    </svg>
  )
}

export function ScanIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 12h10" />
    </svg>
  )
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function BrandMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" fill="currentColor" />
      <path
        d="M5.5 7.5h13M5.5 12h9M5.5 16.5h11"
        stroke="#F5F3EE"
        strokeWidth="2.25"
        strokeLinecap="square"
      />
    </svg>
  )
}
