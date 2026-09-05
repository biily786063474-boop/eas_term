// 对话工具栏上的角色入口：一枚小 icon，点开**向上展开**一张角色卡。
//
// 卡片是**轨道式轮播**：所有卡片并排成一条横轨，一次只露出一张（`.rp-win` 裁剪）。
// 点箭头 / 点圆点 / 拖拽——**三条路都是平移整条轨道**，走同一条带过冲的曲线，
// 所以「点击切换」和「手动拖拽」的动感完全一致（用户 2026-09-05：点击切换也要
// 完整的拖拽动画）。上一版点箭头是 setIdx 直接换内容、卡片瞬间跳，没有滑动过程。
//
// ── 卡片上的三件事（用户 2026-09-05 加的）────────────────────────────────
//   · **hover 才展开职能简述**：正面只留名字，鼠标停上去简述滑出（`.rp-desc` max-height 过渡）
//   · **右上角编辑钮**：打开 `CanvasRoleEditor`（现成的详细设定弹窗，复用不新建）
//   · **末尾一张「＋新建」卡**：打开同一个编辑器、roleId 传空串 = 新建自定义角色
//
// ── 为什么没用 Framer Motion ──────────────────────────────────────────────
// 平移 + 拖拽在这儿是几十行的事，而 `motion` 是上百 KB 的运行时依赖，
// 项目当前零动画库（图纸 15：动效只用 transition）。「弹簧」在 CSS 那侧是
// 一条第二控制点 y>1 的 cubic-bezier（见 `.rp-track`），回正时冲过头再荡回来。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlanIcon,
  PlusIcon
} from '../../ui/Icons'
import { DRAG_MIN, clampIndex, dragOffset, settleIndex } from './carousel.ts'
import { CanvasRoleEditor } from '../canvas/CanvasRoleEditor'

/** 末尾那张「＋新建」卡的哨兵 id —— 真实角色 id 不会是这个 */
const NEW_CARD = '__new__'

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
  /** null = 编辑器没开；'' = 新建；其余 = 编辑那个角色。独立于轮播开关。 */
  const [editId, setEditId] = useState<string | null>(null)

  /** 轨道里的卡：无角色排头（它是默认值，最先看到），末尾一张「＋新建」。 */
  const cards = [
    { id: '', name: '无角色', desc: '不套任何职责约定', color: '#737373' },
    ...roles,
    { id: NEW_CARD, name: '新建角色', desc: '', color: '#525252' }
  ]
  const [idx, setIdx] = useState(0)
  /** 拖动的位移（px）。松手后归 0（回弹）或翻页。 */
  const [dx, setDx] = useState(0)
  /** 真的在拖（已过 DRAG_MIN）—— 拖动时关掉轨道 transition，否则跟手有延迟感 */
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const armed = useRef(false)

  const current = roles.find((r) => r.id === roleId)

  // 打开时把轨道定位到当前角色那一张 —— 而不是从头翻
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
    // **方向按空间定，不写死。** 这个入口在空态的上下文条（面板中段），
    // 上方空间够就向上开、不够就向下开。卡片高度 hover 时会长高，留足余量。
    const NEED = 220
    const up = r.top > NEED
    setPos({
      position: 'fixed',
      left: Math.max(8, Math.min(r.left - 60, window.innerWidth - 300)),
      ...(up ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 })
    })
  }, [open])

  /** 翻页。到头就停，不循环 —— 圆点指示的意义正是「一共几个、现在第几个」。 */
  const go = (d: number): void => {
    setIdx((i) => clampIndex(i + d, cards.length))
    setDx(0)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      // 编辑器开着时它是更高层的 portal，点它不该关轮播（其实这时轮播已经关了，双保险）
      if (t.closest('.rolepick-card') || t.closest('.rolepick-btn') || t.closest('.cset-overlay')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (editId !== null) return // 编辑器开着时方向键归它
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
  }, [open, cards.length, editId])

  const onPointerDown = (e: React.PointerEvent): void => {
    // 按在按钮上（用/编辑/新建卡）就不进拖拽 —— 那是一次点击
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
    setIdx(settleIndex(idx, dx, cards.length))
    setDx(0)
  }

  /** 打开详细设定弹窗；顺手收起轮播（编辑器是全屏弹窗，轮播留着没意义）。 */
  const edit = (id: string): void => {
    setOpen(false)
    setEditId(id)
  }

  return (
    <>
      {/* 长得和旁边的「选一个 CLI」一样——同一类东西：都是这次对话**开起来之前**
          要定的，都在 spawn 那一刻生效。所以显示名字而不只有图标。 */}
      <button
        ref={btnRef}
        type="button"
        className={`ac-ctxbar-item as-btn rolepick-btn${current ? ' on' : ''}`}
        aria-label={current ? `角色：${current.name}` : '角色'}
        data-tip={
          current
            ? `角色：${current.name} —— ${current.desc}`
            : '角色 —— 给这次对话定个职责（会话开起来之后改不了）'
        }
        onClick={() => setOpen((v) => !v)}
      >
        <PlanIcon size={12} />
        <span className="ac-ctxbar-name">{current?.name ?? '无角色'}</span>
        <ChevronDownIcon size={10} />
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

              {/* 裁剪窗口：只露出当前一张，轨道滑动时旁边的卡在这儿被切掉 */}
              <div className="rp-win">
                <div
                  className={`rp-track${dragging ? ' dragging' : ''}`}
                  style={{
                    // **一条轨道平移**：-idx 张的宽度（用 %，不依赖测量）＋ 跟手的 dx
                    transform: `translateX(calc(${-idx * 100}% + ${dx}px))`
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {cards.map((c) => {
                    const isNew = c.id === NEW_CARD
                    const isCurrent = !isNew && c.id === (roleId ?? '')
                    const canEdit = !isNew && c.id !== '' // 无角色不可编辑；新建卡本身是入口
                    return (
                      <div key={c.id || 'none'} className={`rp-card${isNew ? ' rp-card-new' : ''}`}>
                        {isNew ? (
                          <button type="button" className="rp-new-btn" onClick={() => edit('')}>
                            <PlusIcon size={18} />
                            <span>新建自定义角色</span>
                          </button>
                        ) : (
                          <>
                            <div className="rp-name">
                              <span className="rp-dot-c" style={{ background: c.color }} />
                              <span className="rp-nm">{c.name}</span>
                              {isCurrent && <span className="rp-cur">当前</span>}
                              {canEdit && (
                                <button
                                  type="button"
                                  className="rp-edit"
                                  aria-label={`编辑「${c.name}」`}
                                  title="详细设定"
                                  onClick={() => edit(c.id)}
                                >
                                  <PencilIcon size={11} />
                                </button>
                              )}
                            </div>
                            {/* 职能简述：正面收起，hover 展开（max-height 过渡） */}
                            <div className="rp-desc">{c.desc}</div>
                            <button
                              type="button"
                              className="rp-use"
                              disabled={isCurrent}
                              onClick={() => {
                                setOpen(false)
                                if (!isCurrent) onPick(c.id)
                              }}
                            >
                              {isCurrent ? '正在用' : `用「${c.name}」`}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
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

            {/* 底部圆点：一共几个、现在第几个。点它直接跳过去（也走轨道平移） */}
            <div className="rp-dots">
              {cards.map((c, i) => (
                <button
                  key={c.id || 'none'}
                  type="button"
                  className={`rp-dot${i === idx ? ' on' : ''}${!('id' in c && c.id === NEW_CARD) && c.id === (roleId ?? '') ? ' cur' : ''}${c.id === NEW_CARD ? ' add' : ''}`}
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

      {/* 详细设定弹窗：复用画布那侧的编辑器。roleId='' = 新建。 */}
      {editId !== null && <CanvasRoleEditor roleId={editId} onClose={() => setEditId(null)} />}
    </>
  )
}
