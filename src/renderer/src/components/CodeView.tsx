import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

// 覆盖 oneDark 的不透明背景，让玻璃层透出来
const glassTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.03)' }
  },
  { dark: true }
)

interface CodeMenu {
  x: number
  y: number
  hasSelection: boolean
}

export function CodeView({ filePath }: { filePath: string | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [menu, setMenu] = useState<CodeMenu | null>(null)

  useEffect(() => {
    if (!filePath) return
    const host = hostRef.current!
    let view: EditorView | null = null
    let cancelled = false
    setStatus('加载中…')

    const load = async (): Promise<void> => {
      const result = await window.api.fs.readTextFile(filePath)
      if (cancelled) return
      if (!result.ok) {
        setStatus(`无法读取文件：${result.error ?? '未知错误'}`)
        return
      }
      if (result.binary) {
        setStatus('二进制文件，无法以文本预览')
        return
      }
      const fileName = filePath.split('/').pop() ?? filePath
      const langDesc = LanguageDescription.matchFilename(languages, fileName)
      const langSupport = langDesc ? await langDesc.load() : null
      if (cancelled) return

      // 只用 readOnly（不用 editable.of(false)）：内容不可改，但仍可获得焦点、
      // 选中文字、用 ⌘/Ctrl+C 复制、⌘/Ctrl+A 全选——这些都是 CodeMirror 默认键位。
      const extensions = [basicSetup, oneDark, glassTheme, EditorState.readOnly.of(true)]
      if (langSupport) extensions.push(langSupport)

      view = new EditorView({
        state: EditorState.create({ doc: result.content, extensions }),
        parent: host
      })
      viewRef.current = view
      setStatus(
        result.truncated
          ? `文件超过 2MB，仅显示开头部分（共 ${(result.size / 1024 / 1024).toFixed(1)}MB）`
          : null
      )
    }
    void load()

    return () => {
      cancelled = true
      view?.destroy()
      viewRef.current = null
    }
  }, [filePath])

  // 右键菜单关闭：点击别处 / Esc
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onEsc, { capture: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onEsc, { capture: true })
    }
  }, [menu])

  const copySelection = (): void => {
    const v = viewRef.current
    if (!v) return
    const { from, to } = v.state.selection.main
    if (from === to) return
    void window.api.clipboard.writeText(v.state.sliceDoc(from, to))
  }
  const copyAll = (): void => {
    const v = viewRef.current
    if (v) void window.api.clipboard.writeText(v.state.doc.toString())
  }
  const selectAll = (): void => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } })
    v.focus()
  }

  const run = (fn: () => void) => (): void => {
    fn()
    setMenu(null)
  }

  if (!filePath) {
    return (
      <div className="pane-placeholder">
        <div>代码预览</div>
        <div className="pane-placeholder-hint">在左侧文件树中点击一个文件</div>
      </div>
    )
  }

  return (
    <div
      className="code-view"
      onContextMenu={(e) => {
        if (!viewRef.current) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, hasSelection: !viewRef.current.state.selection.main.empty })
      }}
    >
      {status && <div className="pane-status">{status}</div>}
      <div ref={hostRef} className="code-view-host" />
      {menu &&
        createPortal(
          <div
            className="context-menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button disabled={!menu.hasSelection} onClick={run(copySelection)}>
              复制
            </button>
            <button onClick={run(copyAll)}>复制全部</button>
            <button onClick={run(selectAll)}>全选</button>
          </div>,
          document.body
        )}
    </div>
  )
}
