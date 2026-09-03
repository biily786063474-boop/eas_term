// 对话工具栏上的角色入口：一枚小 icon，点开**向上展开**一张角色卡。
//
// 用户 2026-09-02：「角色入口变成一个小 icon，放到和新对话、压缩同级，
// 点开后向上展开角色卡。」
//
// **向上展开是硬要求**：这条控件行贴在输入框底部，向下展开会掉出可视区 ——
// 画布节点尤其明显，节点下边缘紧挨着画布背景。
//
// ── 为什么角色要在这儿，而不在终端那条控制条上 ──────────────────────────
// 这 8 个角色（工匠 / 验官 / 画师…）原来只对终端里 ▶ 启动的 agent 生效，
// 入口挂在 `CanvasAgentBar` 上。那条控制条要下线（终端退回纯终端），
// 角色于是要么跟着消失，要么搬到这儿并**真的注入会话**。
// 用户 2026-09-02 选了后者：「转移到 AI 对话中的合适位置进行角色的注入这个 session」。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { PlanIcon } from '../../ui/Icons'

export function RolePicker({
  roleId,
  onPick
}: {
  roleId?: string
  onPick: (roleId: string) => void
}): JSX.Element {
  const roles = useStore((s) => s.roles)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<React.CSSProperties | null>(null)

  const current = roles.find((r) => r.id === roleId)

  // 摆位置：**贴着按钮往上**。用 layout effect 在绘制前定好，
  // 否则会看到它先在 (0,0) 闪一下（同 SlashPicker 的做法）。
  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      position: 'fixed',
      // 贴按钮左边，但不许溢出屏幕
      left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
      // **向上**：底边贴住按钮顶边
      bottom: window.innerHeight - r.top + 6,
      maxHeight: Math.max(120, r.top - 16)
    })
  }, [open])

  // 点别处收起。捕获阶段监听：卡片渲染在 body 上（portal），
  // 冒泡阶段会被中间那些 stopPropagation 的容器截掉。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('.rolepick-card') || t.closest('.rolepick-btn')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (id: string): void => {
    setOpen(false)
    if (id === (roleId ?? '')) return // 选的就是当前这个：什么都不做，别白问一次确认
    onPick(id)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ac-bar-btn icon-only rolepick-btn${current ? ' on' : ''}`}
        aria-label={current ? `角色：${current.name}` : '角色'}
        // 名字进 tip，和旁边「新对话」「压缩」一致
        data-tip={current ? `角色：${current.name} —— ${current.desc}` : '角色 —— 给这次对话定个职责'}
        onClick={() => setOpen((v) => !v)}
      >
        <PlanIcon size={11} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="rolepick-card" style={pos} role="listbox" aria-label="选择角色">
            <button
              type="button"
              className={`rolepick-row${!roleId ? ' on' : ''}`}
              onClick={() => pick('')}
            >
              <span className="rolepick-name">无角色</span>
              <span className="rolepick-desc">不套任何职责约定</span>
            </button>
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`rolepick-row${r.id === roleId ? ' on' : ''}`}
                onClick={() => pick(r.id)}
              >
                <span className="rolepick-dot" style={{ background: r.color }} />
                <span className="rolepick-name">{r.name}</span>
                <span className="rolepick-desc">{r.desc}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
