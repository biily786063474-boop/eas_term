// 终端底部的文字输入框。
//
// 存在的理由是三件在 xterm 里很别扭的事：
//   1. 中文输入法的候选框在 xterm 里会错位（xterm 自己管光标，IME 定位不到）
//   2. 长提示词写到一半想改前面，终端里只能一路退格
//   3. 粘贴多行文本会被逐行当成命令执行——写给 agent 的多段话尤其容易踩
//
// 它不替代终端输入，只是"先写好再发"的暂存区。写完的内容原样写进 pty，
// 和你在终端里手打没有区别。
import { useRef, useState } from 'react'

/** 输入框最多长到几行，超过就内部滚动。再高会把终端可视区挤没 */
const MAX_ROWS = 4
const LINE_H = 19

export function TerminalInput({
  ptyId,
  onFocusTerm
}: {
  ptyId: string
  /** 把键盘焦点还给终端（Esc 时用） */
  onFocusTerm: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [flash, setFlash] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  /** 上一条发出去的内容，空输入时按 ↑ 取回 */
  const lastRef = useRef('')

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, LINE_H * MAX_ROWS) + 'px'
  }

  /** 送进 pty。withReturn=false 时只填不发，光标停在那儿等你自己按回车 */
  const send = (withReturn: boolean): void => {
    const text = value.trim()
    if (!text) return
    lastRef.current = text
    window.api.pty.write(ptyId, withReturn ? text + '\r' : text)
    setValue('')
    const el = taRef.current
    if (el) {
      el.style.height = 'auto'
      // 发完把焦点留在输入框：连着写第二条是常态，每次都要重新点一下很烦
      el.focus()
    }
    setFlash(true)
    window.setTimeout(() => setFlash(false), 340)
  }

  return (
    <div className={`term-input${flash ? ' flash' : ''}`}>
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        placeholder="写点什么…（⌘↵ 发送）"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          autoGrow(e.target)
        }}
        onKeyDown={(e) => {
          // ⌘↵ / Ctrl↵ 发送；⇧⌘↵ 只填不发（想先检查一遍再自己回车）
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            send(!e.shiftKey)
            return
          }
          // 空输入时按 ↑ 取回上一条——发错了想改，不用重打
          if (e.key === 'ArrowUp' && !value) {
            e.preventDefault()
            setValue(lastRef.current)
            requestAnimationFrame(() => {
              const el = taRef.current
              if (el) {
                autoGrow(el)
                el.setSelectionRange(el.value.length, el.value.length)
              }
            })
            return
          }
          // Esc：清空并把焦点还给终端。误点进来时一键退出
          if (e.key === 'Escape') {
            e.preventDefault()
            setValue('')
            if (taRef.current) taRef.current.style.height = 'auto'
            onFocusTerm()
          }
        }}
      />
      <button
        className="term-input-send"
        // 用 mousedown + preventDefault：click 会先让 textarea 失焦，
        // 焦点一走 :focus-within 的高亮就掉了，按钮看着像"点了个已经变灰的东西"
        onMouseDown={(e) => {
          e.preventDefault()
          send(true)
        }}
      >
        ⌘↵
      </button>
    </div>
  )
}
