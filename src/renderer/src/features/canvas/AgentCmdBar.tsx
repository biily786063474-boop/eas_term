// Agent 命令条：一排把斜杠命令一键送进终端的按钮。
//
// 画布（挂在 Agent 控制台下面）和分屏（挂在面板头下面）共用这一个组件 ——
// 两处各写一遍的话，「哪些命令、哪些要确认、什么时候禁用」这三件事迟早只在一处是对的。
//
// **显示与否由它自己决定**：读 ptyAgent[ptyId]（主进程按 controlling terminal 上的
// 进程名探出来的），认不出就返回 null。调用方不用判断，也就不会两处判得不一样。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import {
  CompressIcon,
  GridIcon,
  PlanIcon,
  GaugeIcon,
  MoreIcon,
  CopyIcon,
  PlusIcon,
  ChipIcon,
  FileIcon
} from '../../ui/Icons'
import { useMenuAnchor } from './CanvasContextMenu'
import { PRIMARY_CMDS, SECONDARY_CMDS, sendSlash, type AgentCmd } from './agentCommands'

/** 命令 id → 图标。放模块级：每次渲染重建这张表没有意义 */
const CMD_ICON: Record<string, (p: { size?: number }) => JSX.Element> = {
  compact: CompressIcon,
  context: GridIcon,
  plan: PlanIcon,
  model: ChipIcon,
  new: PlusIcon,
  copy: CopyIcon,
  usage: GaugeIcon,
  init: FileIcon
}

export function AgentCmdBar({ ptyId }: { ptyId: string }): JSX.Element | null {
  // 这个终端里真的跑着哪个 CLI。null = 纯 shell 或别的东西 → 整条不出现。
  // 不用 NodeAgent.kind：那个是「下次启动要起哪个」，不是「现在跑着哪个」，
  // 而且分屏根本没有那个字段。
  const kind = useStore((s) => s.ptyAgent[ptyId])
  // agent 正在干活时禁用 —— 那会儿往 TUI 里插一条斜杠命令，轻则被它当成粘贴吃掉、
  // 重则和正在渲染的内容打架。runningPtys 由终端标题的盲文 spinner 驱动。
  const busy = useStore((s) => s.runningPtys.includes(ptyId))
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popPos = useMenuAnchor(rect?.left ?? 0, (rect?.bottom ?? 0) + 6, popRef, [rect])

  // 浮层外部点击关闭（照 CanvasAgentBar：target 不在锚点/浮层内才关）
  useEffect(() => {
    if (!rect) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return
      setRect(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [rect])

  if (!kind) return null
  /** 当前 agent 下真正可用的（cmd 为 null = 这个 agent 没有对应命令，直接不出现） */
  const usable = (list: AgentCmd[]): AgentCmd[] => list.filter((c) => !!c.cmd[kind])
  const primary = usable(PRIMARY_CMDS)
  const secondary = usable(SECONDARY_CMDS)
  if (!primary.length) return null

  const run = (c: AgentCmd): void => {
    const text = c.cmd[kind]
    if (!text) return
    const go = (): void => sendSlash(ptyId, text)
    // 不可逆 / 花钱的先弹确认；文案在 agentCommands.ts 里，说清「会失去什么」
    if (c.confirm)
      requestConfirm({ message: c.confirm.message, confirmLabel: c.confirm.confirmLabel, onConfirm: go })
    else go()
  }

  return (
    <div className="ab-cmds" onMouseDown={(e) => e.stopPropagation()}>
      {primary.map((c) => {
        const Icon = CMD_ICON[c.id] ?? MoreIcon
        return (
          <button
            key={c.id}
            className="ab-cmd"
            disabled={busy}
            data-tip={busy ? `${c.label} · agent 正在跑，等它停下来` : `${c.label} · ${c.tip}`}
            onClick={() => run(c)}
          >
            <Icon size={13} />
          </button>
        )
      })}
      {secondary.length > 0 && (
        <button
          className="ab-cmd ab-cmd-more"
          disabled={busy}
          data-tip="更多命令"
          onClick={(e) => {
            anchorRef.current = e.currentTarget
            const r = e.currentTarget.getBoundingClientRect()
            setRect((cur) => (cur ? null : r))
          }}
        >
          <MoreIcon size={13} />
        </button>
      )}
      {rect &&
        createPortal(
          <div
            ref={popRef}
            className="ab-pop"
            // 夹回可视区：面板贴着窗口右边时菜单会整个越出去看不见（同 CanvasAgentBar）。
            // 先隐藏再定位，不让人看见「先飞出去再跳回来」那一帧。
            style={{
              left: popPos?.x ?? rect.left,
              top: popPos?.y ?? rect.bottom + 6,
              visibility: popPos ? 'visible' : 'hidden'
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ab-menu ab-cmd-menu">
              {secondary.map((c) => (
                <button
                  key={c.id}
                  className="ab-menu-item ab-cmd-item"
                  data-tip={c.tip}
                  onClick={() => {
                    setRect(null)
                    run(c)
                  }}
                >
                  <span>{c.label}</span>
                  {/* 会弹确认的标一下，让人点之前就知道这条不是「顺手一点」 */}
                  {c.confirm && <span className="ab-cmd-warn">需确认</span>}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
