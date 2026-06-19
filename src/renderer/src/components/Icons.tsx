// 极简线条图标集（Lucide 风格）：统一 1.6 描边、圆角端点、currentColor
import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

function Svg({ size = 15, children, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const TerminalIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </Svg>
)

export const CodeIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </Svg>
)

export const ImageIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-4.35-4.35a1.5 1.5 0 0 0-2.12 0L5 20" />
  </Svg>
)

export const FolderIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Svg>
)

export const FolderOpenIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  </Svg>
)

export const FileIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </Svg>
)

export const ChevronRightIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
)

export const ChevronLeftIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>
)

export const ChevronDownIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>
)

export const PlusIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
)

export const CloseIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </Svg>
)

export const RefreshIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <polyline points="21 3 21 9 15 9" />
  </Svg>
)

export const SplitHIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="4" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </Svg>
)

export const SplitVIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="4" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </Svg>
)

export const CheckIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
)

export const PlayIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <polygon points="6 3 20 12 6 21 6 3" />
  </Svg>
)

export const PencilIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Svg>
)

export const TrashIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
)

export const PaletteIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="13.5" cy="6.5" r="0.8" />
    <circle cx="17.5" cy="10.5" r="0.8" />
    <circle cx="8.5" cy="7.5" r="0.8" />
    <circle cx="6.5" cy="12.5" r="0.8" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.74 1.65-1.67 0-.43-.16-.81-.43-1.11a1.65 1.65 0 0 1 1.24-2.74H16a6 6 0 0 0 6-6c0-4.97-4.5-8.48-10-8.48Z" />
  </Svg>
)

export const CopyIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="3" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)
