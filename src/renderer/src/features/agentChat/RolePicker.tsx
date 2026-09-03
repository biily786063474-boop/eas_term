// 对话工具栏上的角色入口：一枚小 icon，点开**向上展开**一张角色卡。
//
// 卡片是**轮播**：一次只看一个角色，横向滑动切换、可拖拽、底部圆点指示、
// 回弹带轻微倾斜（用户 2026-09-03 给的规格）。
//
// ── 用户给的坑，以及为什么这里仍然用轮播 ──────────────────────────────────
// 「需要一屏同时看到多项做对比时别用」。选角色确实是对比任务 ——
// 但 9 个角色**带说明**挤进一个贴着工具栏的小浮层，结果是谁都读不清
//（2026-09-03 用户实拍的那一版就是：一堵没有样式的文字墙）。
// 轮播让每个角色拿到完整描述，圆点告诉你一共几个、现在第几个。
//
// ── 为什么没用规格里点名的 Framer Motion ──────────────────────────────────
// 弹簧 + 拖拽在这儿是 60 行的事，而 `motion` 是个上百 KB 的运行时依赖，
// 项目当前**零动画库**（图纸 15：动效只用 transition）。
// `react-icons` 更没必要 —— `ui/Icons.tsx` 里有 50+ 个图标。
// 「弹簧」在 CSS 那侧是一条带过冲的 cubic-bezier（见 `.rp-slide`）——
// 回正时冲过 0 再荡回来，倾斜跟着 transform 一起过冲，
// **「回弹带轻微倾斜」就是这么来的，不是单独做的一个动画。**
// 真要换成 framer-motion，替掉的是下面拖拽那一段 + 那条 transition，
// 调用点和其余 CSS 都不用动。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { ChevronLeftIcon, ChevronRightIcon, PlanIcon } from '../../ui/Icons'
import { DRAG_MIN, clampIndex, dragOffset, settleIndex, tiltFor } from './carousel.ts'


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

  /** 轮播里「无角色」排第一，后面才是那几个预设 —— 它是默认值，该最先看到。 */
  const cards = [{ id: '', name: '无角色', desc: '不套任何职责约定', color: '#737373' }, ...roles]
  const [idx, setIdx] = useState(0)
  /** 拖动的位移（px）。松手后回弹到 0，或者翻页。 */
  const [dx, setDx] = useState(0)
  /** 真的在拖（已过 DRAG_MIN）—— 拖动时关掉 transition，否则跟手会有延迟感 */
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  /** 按下了但还没过阈值。null = 没在按 */
  const armed = useRef(false)

  const current = roles.find((r) => r.id === roleId)

  // 打开时把轮播定位到当前角色那一张 —— 而不是从头翻
  useEffect(() => {
    if (!open) return
    const i = cards.findIndex((c) => c.id === (roleId ?? ''))
    setIdx(i < 0 ? 0 : i)
    setDx(0)
  }, [open, roleId])

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
      left: Math.max(8, Math.min(r.left - 60, window.innerWidth - 300)),
      // **向上**：底边贴住按钮顶边（这条控件行贴在输入框底部，向下会掉出可视区）
      bottom: window.innerHeight - r.top + 8
    })
  }, [open])

  /** 翻页。**到头就停住，不循环** —— 循环会让「我翻到哪了」失去边界感，
   *  而圆点指示的意义正是「一共几个、现在第几个」。 */
  const go = (d: number): void => {
    setIdx((i) => clampIndex(i + d, cards.length))
    setDx(0)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('.rolepick-card') || t.closest('.rolepick-btn')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, cards.length])

  const onPointerDown = (e: React.PointerEvent): void => {
    // 按在按钮上就完全不进拖拽 —— 那是一次点击，不是一次滑动
    if ((e.target as HTMLElement).closest('button')) return
    startX.current = e.clientX
    armed.current = true
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!armed.current) return
    const raw = e.clientX - startX.current
    if (!dragging) {
      if (Math.abs(raw) < DRAG_MIN) return
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDx(dragOffset(raw, idx, cards.length))
  }
  const onPointerUp = (): void => {
    armed.current = false
    if (!dragging) return
    setDragging(false)
    // 落到哪一张由 settleIndex 判（含方向与边界）；没到阈值它返回原位，
    // 于是 dx 归 0，CSS 那条带过冲的曲线负责「回弹 + 倾斜」
    setIdx(settleIndex(idx, dx, cards.length))
    setDx(0)
  }

  const card = cards[idx]
  const isCurrent = card.id === (roleId ?? '')
  const tilt = tiltFor(dx)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ac-bar-btn icon-only rolepick-btn${current ? ' on' : ''}`}
        aria-label={current ? `角色：${current.name}` : '角色'}
        data-tip={current ? `角色：${current.name}` : '角色 —— 给这次对话定个职责'}
        onClick={() => setOpen((v) => !v)}
      >
        <PlanIcon size={11} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="rolepick-card" style={pos} role="dialog" aria-label="选择角色">
            <div className="rp-stage">
              <button
                type="button"
                className="rp-arrow left"
                onClick={() => go(-1)}
                disabled={idx === 0}
                aria-label="上一个"
              >
                <ChevronLeftIcon size={12} />
              </button>

              {/* 裁剪窗口：卡片滑出去的部分在这儿被切掉 ——
                  没有它，卡片会滑到箭头上面去，看着像脱了轨 */}
              <div className="rp-win">
                <div
                  className={`rp-slide${dragging ? ' dragging' : ''}`}
                  style={{ transform: `translateX(${dx}px) rotate(${tilt}deg)` }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <div className="rp-name">
                    <span className="rp-dot-c" style={{ background: card.color }} />
                    <span className="rp-nm">{card.name}</span>
                    {isCurrent && <span className="rp-cur">当前</span>}
                  </div>
                  <div className="rp-desc">{card.desc}</div>
                  <button
                    type="button"
                    className="rp-use"
                    disabled={isCurrent}
                    onClick={() => {
                      setOpen(false)
                      if (!isCurrent) onPick(card.id)
                    }}
                  >
                    {isCurrent ? '正在用' : `用「${card.name}」`}
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="rp-arrow right"
                onClick={() => go(1)}
                disabled={idx === cards.length - 1}
                aria-label="下一个"
              >
                <ChevronRightIcon size={12} />
              </button>
            </div>

            {/* 底部圆点：一共几个、现在第几个。点它直接跳过去 */}
            <div className="rp-dots">
              {cards.map((c, i) => (
                <button
                  key={c.id || 'none'}
                  type="button"
                  className={`rp-dot${i === idx ? ' on' : ''}${c.id === (roleId ?? '') ? ' cur' : ''}`}
                  onClick={() => {
                    setIdx(i)
                    setDx(0)
                  }}
                  aria-label={c.name}
                  title={c.name}
                />
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
