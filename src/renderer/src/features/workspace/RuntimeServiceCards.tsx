// 托管服务：项目卡片 + 芯片；点芯片弹出小面板（状态、时长、归属、定位 / 关闭）。
// 视觉稿 docs/prototype/2026-09-14-runtime-center.html 提案 02。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RuntimeObservedService } from '../../../../shared/runtimeResources'
import { KIND_LABEL, fmtDuration, groupServices, serviceLeafRef } from './runtimeView'

const ICON: Record<RuntimeObservedService['kind'], string> = {
  terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5',
  agent: 'M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z M5 18l.8 2 .8-2 2-.8-2-.8-.8-2-.8 2-2 .8z',
  plugin: 'M4 6h16v12H4z M4 10h16 M9 10v8',
  'language-server': 'M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3',
  voice: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z M6 11a6 6 0 0012 0 M12 17v4',
  cli: 'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10'
}
const Icon = ({ kind }: { kind: RuntimeObservedService['kind'] }): JSX.Element => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[kind]} /></svg>
)

interface Props {
  services: readonly RuntimeObservedService[]
  mode: 'project' | 'kind'
  labelOf: (projectId: string) => string
  onStop: (service: RuntimeObservedService) => void
  /** 不传 = 不显示「定位」 */
  onLocate?: (service: RuntimeObservedService) => void
  canLocate?: (service: RuntimeObservedService) => boolean
}

export function RuntimeServiceCards({ services, mode, labelOf, onStop, onLocate, canLocate }: Props): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const open = services.find((s) => s.id === openId) ?? null

  // 面板贴着芯片下方；放不下就翻到上方。滚动 / 点空白 / Esc 关掉。
  useEffect(() => {
    if (!open) { setPos(null); return }
    const a = anchor.current
    if (!a) return
    const r = a.getBoundingClientRect()
    const w = 250
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8)
    let top = r.bottom + 6
    const raf = requestAnimationFrame(() => {
      const h = pop.current?.getBoundingClientRect().height ?? 0
      if (top + h > innerHeight - 8) top = r.top - h - 6
      setPos({ left, top })
    })
    const close = (): void => setOpenId(null)
    const down = (e: MouseEvent): void => { if (!pop.current?.contains(e.target as Node) && !a.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', close, true)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); document.removeEventListener('scroll', close, true) }
  }, [open])

  const groups = groupServices(services, mode, labelOf)
  return (
    <>
      <div className="rs-cards">
        {groups.map((g) => (
          <div className="rs-card" key={g.key}>
            <div className="rs-card-hd"><span>{g.title}</span><span className="rs-n">{g.items.length}</span></div>
            <div className="rs-chips">
              {g.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="rs-chip"
                  aria-haspopup="dialog"
                  aria-expanded={openId === s.id}
                  onClick={(e) => { anchor.current = e.currentTarget; setOpenId(openId === s.id ? null : s.id) }}
                >
                  <Icon kind={s.kind} />
                  <em>{mode === 'project' ? s.name : (s.projectIds.length ? s.projectIds.map(labelOf).join('、') : '未关联')}</em>
                  <span className={`rs-st ${s.state === 'stopping' ? 'warn pulse' : 'ok'}`} title={s.state === 'stopping' ? '停止中' : '运行中'} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {open && createPortal(
        <div ref={pop} className="rs-pop" role="dialog" aria-label={open.name} style={pos ?? { left: -9999, top: -9999 }}>
          <div className="rs-pop-t"><Icon kind={open.kind} />{open.name}</div>
          <div className="rs-pop-m">
            <span className={`rs-st ${open.state === 'stopping' ? 'warn pulse' : 'ok'}`}>{open.state === 'stopping' ? '停止中' : '运行中'}</span>
            <span>{fmtDuration(open.uptimeMs)}</span>
            <span className="rs-pill">{KIND_LABEL[open.kind]}</span>
            {(open.projectIds.length ? open.projectIds.map(labelOf) : ['未关联']).map((p) => <span className="rs-pill" key={p}>{p}</span>)}
            {!open.canStop && open.state === 'running' && <span className="rs-pill">跨窗口共享</span>}
            {open.unknownRefs > 0 && <span className="rs-pill">{open.unknownRefs} 个引用归属待识别</span>}
          </div>
          <div className="rs-pop-a">
            {onLocate && serviceLeafRef(open.id) && (
              <button type="button" className="cset-btn" disabled={canLocate ? !canLocate(open) : false} title={canLocate && !canLocate(open) ? '这个服务不在画布的模块里' : '把画布视口挪到这个模块'} onClick={() => { setOpenId(null); onLocate(open) }}>定位</button>
            )}
            <button type="button" className="cset-btn" disabled={!open.canStop} title={!open.canStop ? (open.state === 'stopping' ? '正在停止' : '跨窗口共享，不能从本窗口关闭') : undefined} onClick={() => { setOpenId(null); onStop(open) }}>关闭</button>
          </div>
          {!open.canStop && open.state === 'running' && <div className="rs-pop-hint">跨窗口共享，不能从本窗口关闭</div>}
        </div>,
        document.body
      )}
    </>
  )
}
