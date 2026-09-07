import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const states = [
  { id: 'danger-full-access', label: '完全放开', detail: '可访问和修改工作区外的文件。' },
  { id: 'workspace-write', label: '可改工作区', detail: '允许修改当前工作区内的文件。' },
  { id: 'read-only', label: '只读', detail: '可读取文件，不可修改。' }
] as const

export function StartupSandboxButton({ value, disabled, readOnlyRole, onChange }: {
  value: string
  disabled: boolean
  readOnlyRole: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const current = states.find(s => s.id === value) ?? states[1]
  const [bubble, setBubble] = useState<{ kind: 'hint' | 'changed'; value: string } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const visible = bubble?.value === value && !disabled

  useEffect(() => { setBubble(null) }, [disabled, readOnlyRole])
  useEffect(() => {
    if (!bubble) return
    const dismiss = (): void => setBubble(null)
    const outside = (e: PointerEvent): void => {
      if (!buttonRef.current?.contains(e.target as Node)) dismiss()
    }
    const timer = bubble.kind === 'changed' ? window.setTimeout(dismiss, 3200) : undefined
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [bubble])
  useLayoutEffect(() => {
    if (!visible || !buttonRef.current || !bubbleRef.current) return
    const update = (): void => {
      if (!buttonRef.current || !bubbleRef.current) return
      const anchor = buttonRef.current.getBoundingClientRect()
      const box = bubbleRef.current.getBoundingClientRect()
      const above = anchor.top > box.height + 16
      const x = Math.max(8 + box.width / 2, Math.min(window.innerWidth - 8 - box.width / 2, anchor.left + anchor.width / 2))
      const y = above ? anchor.top - 8 : anchor.bottom + 8
      bubbleRef.current.style.left = `${x}px`
      bubbleRef.current.style.top = `${y}px`
      bubbleRef.current.classList.toggle('above', above)
    }
    update()
    const observer = new ResizeObserver(update)
    if (buttonRef.current.parentElement) observer.observe(buttonRef.current.parentElement)
    return () => observer.disconnect()
  }) // 模型名称、说明行及容器尺寸变化均可能移动按钮，绘制前重新锚定。


  const hint = (): void => setBubble(b => b?.kind === 'changed' ? b : { kind: 'hint', value })
  const hideHint = (): void => setBubble(b => b?.kind === 'hint' ? null : b)
  return <>
    <button ref={buttonRef} type="button" className="ac-icon-button ac-sandbox-button"
      aria-label={`调整沙箱状态，当前${current.label}${readOnlyRole ? '，角色限制' : ''}`}
      aria-describedby={visible ? id : undefined} aria-disabled={readOnlyRole || undefined}
      data-sandbox={current.id} disabled={disabled}
      onPointerEnter={hint} onPointerLeave={hideHint} onFocus={hint} onBlur={hideHint}
      onKeyDown={e => { if (e.key === 'Escape') setBubble(null) }}
      onClick={() => {
        if (readOnlyRole) { setBubble({ kind: 'hint', value }); return }
        const next = states[(states.indexOf(current) + 1) % states.length]
        onChange(next.id)
        setBubble({ kind: 'changed', value: next.id })
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {current.id === 'danger-full-access' ? <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M9 10V6a4 4 0 0 1 7.8-1.2M12 14v3" /></>
          : current.id === 'workspace-write' ? <><path d="m12 3 8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="m8 12 3 3 5-6" /></>
            : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
    {visible && createPortal(<div ref={bubbleRef} id={id}
      className="app-tooltip ac-sandbox-bubble" role={bubble?.kind === 'changed' ? 'status' : 'tooltip'}>
      <strong>{bubble?.kind === 'changed' ? `已切换：${current.label}` : '调整沙箱状态'}</strong>
      <span>{readOnlyRole ? '当前角色限制为只读，不能调整。' : bubble?.kind === 'changed' ? current.detail : `当前：${current.label} · 点击切换`}</span>
    </div>, document.body)}
  </>
}
