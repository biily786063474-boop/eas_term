// 画布模式的「名词词典」悬浮气泡：可拖动的小圆钮，点击弹出小面板（承载 DictView），
// 点 × 或再次点气泡收起。改成气泡是因为它作为画布节点会崩溃、且本就是随手查的工具。

import { lazy, Suspense, useRef, useState } from 'react'
import { DictIcon, CloseIcon } from '../../ui/Icons'

const DictView = lazy(() => import('../dict/DictView').then((m) => ({ default: m.DictView })))

const POP_W = 360
const POP_H = 464
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export function CanvasDictBubble(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(() => ({ x: 24, y: Math.max(96, window.innerHeight - 104) }))
  const draggedRef = useRef(false)

  const onBubbleDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const ox = pos.x
    const oy = pos.y
    let moved = false
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (!moved && Math.hypot(dx, dy) < 4) return
      moved = true
      setPos({
        x: clamp(ox + dx, 8, window.innerWidth - 56),
        y: clamp(oy + dy, 52, window.innerHeight - 56)
      })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      draggedRef.current = moved
      if (!moved) setOpen((v) => !v) // 未拖动 → 切换开合
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 面板默认浮在气泡上方，四边钳制进视口
  const popStyle = {
    left: clamp(pos.x, 8, window.innerWidth - POP_W - 8),
    top: clamp(pos.y - POP_H - 10, 52, window.innerHeight - POP_H - 8)
  }

  return (
    <>
      <button
        className={`cdict-bubble${open ? ' on' : ''}`}
        style={{ left: pos.x, top: pos.y }}
        data-tip={open ? '收起名词词典' : '名词词典'}
        onMouseDown={onBubbleDown}
      >
        <DictIcon size={20} />
      </button>
      {open && (
        <div className="cdict-pop" style={popStyle}>
          <div className="cdict-pop-head">
            <DictIcon size={13} />
            <span>名词词典</span>
            <button className="cdict-pop-x" data-tip="收起" onClick={() => setOpen(false)}>
              <CloseIcon size={13} />
            </button>
          </div>
          <div className="cdict-pop-body">
            <Suspense fallback={<div className="pane-placeholder">加载词典…</div>}>
              <DictView />
            </Suspense>
          </div>
        </div>
      )}
    </>
  )
}
