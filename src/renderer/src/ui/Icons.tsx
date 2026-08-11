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

export const CanvasIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
)

export const GlobeIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
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

export const GitBranchIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Svg>
)

export const MinusIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
)

export const UndoIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </Svg>
)

export const SparkleIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
  </Svg>
)

/* 两个 CLI 的品牌标识。**是按各自视觉特征手绘的几何近似，不是官方商标文件** ——
   官方 SVG 有商标约束，而这里只需要「一眼分得出是哪个」。
   两个都用 fill 而不是 stroke：这个尺寸（13px）下描边图形会糊成一团。 */

/** Claude：Anthropic 那个放射星芒。12 条辐条，长短交替 */
export const ClaudeIcon = ({ size = 15, ...rest }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6
      // 长短交替：全等长会变成一个圆盘，认不出是星芒
      const r = i % 2 ? 6.4 : 9.2
      const w = i % 2 ? 1.15 : 1.4
      const [cx, cy] = [12 + Math.cos(a) * r * 0.55, 12 + Math.sin(a) * r * 0.55]
      return (
        <rect
          key={i}
          x={cx - w / 2}
          y={cy - r / 2}
          width={w}
          height={r}
          rx={w / 2}
          transform={`rotate(${(i * 30 + 90) % 360} ${cx} ${cy})`}
        />
      )
    })}
  </svg>
)

/** Codex：OpenAI 那个六重对称的花结。三个椭圆各转 60°，只描边 */
export const CodexIcon = ({ size = 15, ...rest }: IconProps): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    {...rest}
  >
    {[0, 60, 120].map((d) => (
      <ellipse key={d} cx="12" cy="12" rx="4" ry="9.2" transform={`rotate(${d} 12 12)`} />
    ))}
  </svg>
)

export const BoardIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="9.5" y="4" width="5" height="10" rx="1.5" />
    <rect x="16" y="4" width="5" height="13" rx="1.5" />
  </Svg>
)

export const GanttIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="5" width="10" height="3" rx="1.5" />
    <rect x="7" y="10.5" width="12" height="3" rx="1.5" />
    <rect x="5" y="16" width="8" height="3" rx="1.5" />
  </Svg>
)

export const ClockIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </Svg>
)

export const FilesIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </Svg>
)

export const MessageIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
  </Svg>
)

export const DictIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 6.5A2.5 2.5 0 0 0 9.5 4H3v14h6a2 2 0 0 1 2 2M12 6.5A2.5 2.5 0 0 1 14.5 4H21v14h-6a2 2 0 0 0-2 2M12 6.5V21" />
  </Svg>
)

export const MicIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </Svg>
)

export const BellIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Svg>
)

export const TidyIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="8" height="6" rx="1.5" />
    <rect x="13" y="3" width="8" height="6" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="5" rx="1.5" />
  </Svg>
)

export const MaximizeIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />
  </Svg>
)

export const RestoreIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" />
  </Svg>
)

export const DesignIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="9" height="9" rx="2" />
    <circle cx="16.5" cy="16.5" r="4.5" />
  </Svg>
)

/** MCP 接入指示：插头 —— 表示「外部 AI 接进来了」 */
export const GearIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
)

export const PlugIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 3v5" />
    <path d="M15 3v5" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 17v4" />
  </Svg>
)

/** 钥匙：密钥柜 */
export const KeyIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 20 3" />
    <path d="M17 6l3 3" />
  </Svg>
)

/** 挂锁（锁着）：密钥柜锁定态 */
export const LockIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
)

// ── Agent 命令条用的几个（沿用上面的 Svg 基座：24 viewBox / 1.6 描边 / round 端点）──

/** 压缩上下文：上下两条边界向中间收 */
export const CompressIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="9 6 12 9 15 6" />
    <polyline points="9 18 12 15 15 18" />
  </Svg>
)

/** 上下文占用：方格 —— Claude 的 /context 画出来就是一张彩色方格图 */
export const GridIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Svg>
)

/** 计划模式：清单 + 勾 */
export const PlanIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <line x1="10" y1="6" x2="20" y2="6" />
    <line x1="10" y1="12" x2="20" y2="12" />
    <line x1="10" y1="18" x2="20" y2="18" />
    <polyline points="3 6 4.5 7.5 7 5" />
    <polyline points="3 12 4.5 13.5 7 11" />
  </Svg>
)

/** 用量：仪表盘指针 */
export const GaugeIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <line x1="12" y1="18" x2="16" y2="11" />
  </Svg>
)

/** 更多（二级命令菜单入口） */
export const MoreIcon = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Svg>
)
