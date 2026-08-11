import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { renderMarkdown, bindCodeCopy } from './markdown'
import { CodeIcon, FilesIcon, PencilIcon, CheckIcon } from '../../ui/Icons'
import './editor.css'

const isMarkdown = (p: string): boolean => /\.(md|markdown|mdx)$/i.test(p)

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

export function CodeView({
  filePath,
  readOnly
}: {
  filePath: string | null
  /** 只读预览：不出「编辑」按钮，从源头掐掉 editing 态（连带 ⌘S 保存也进不去）。
   *  目前只有知识库拖出来的自由节点会传 true——内容离开知识库目录，不该在画布上被顺手改掉。 */
  readOnly?: boolean
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 代码块复制按钮：用回调 ref 挂委托，不用 useEffect(…, [])。
  // 没选文件时这个组件会提前 return 一个占位符，那一帧 .code-view 没挂载，
  // 首次 effect 拿到的是 null，之后再打开文件也不会重绑（按钮点了没反应）。
  const unbindCopy = useRef<(() => void) | null>(null)
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    unbindCopy.current?.()
    // 挂在最外层而不是 .md-view 上：委托只认 .md-copy，挂高一层不会误伤，
    // 却省掉「排版视图 / 源码视图来回切时 .md-view 反复装卸」这件事。
    unbindCopy.current = node ? bindCodeCopy(node) : null
  }, [])
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [menu, setMenu] = useState<CodeMenu | null>(null)
  // Markdown 默认看排版（层级一眼可见），右下角按钮切到源码看符号
  const [text, setText] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const roRef = useRef(new Compartment())
  const md = !!filePath && isMarkdown(filePath)
  // 编辑一律在源码上进行（渲染出来的排版不是可编辑的原文）
  const rendered = md && !showSource && !editing

  // 读文件：内容进 state，两种视图共用（切换视图不重新读盘）
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setText(null)
    setStatus('加载中…')
    setShowSource(false)
    setEditing(false)
    setDirty(false)
    void (async () => {
      const result = await window.api.fs.readTextFile(filePath)
      if (cancelled) return
      if (!result.ok) return setStatus(`无法读取文件：${result.error ?? '未知错误'}`)
      if (result.binary) return setStatus('二进制文件，无法以文本预览')
      setText(result.content)
      setStatus(
        result.truncated
          ? `文件超过 2MB，仅显示开头部分（共 ${(result.size / 1024 / 1024).toFixed(1)}MB）`
          : null
      )
    })()
    return () => {
      cancelled = true
    }
  }, [filePath])

  // CodeMirror：只在源码视图下建（Markdown 渲染态不需要编辑器）
  useEffect(() => {
    if (text === null || !filePath || rendered) return
    const host = hostRef.current
    if (!host) return
    let view: EditorView | null = null
    let cancelled = false
    void (async () => {
      const fileName = filePath.split('/').pop() ?? filePath
      const langDesc = LanguageDescription.matchFilename(languages, fileName)
      const langSupport = langDesc ? await langDesc.load() : null
      if (cancelled) return
      // 只用 readOnly（不用 editable.of(false)）：内容不可改，但仍可获得焦点、
      // 选中文字、用 ⌘/Ctrl+C 复制、⌘/Ctrl+A 全选——这些都是 CodeMirror 默认键位。
      const extensions = [
        basicSetup,
        oneDark,
        glassTheme,
        roRef.current.of(EditorState.readOnly.of(!editing)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setDirty(true)
        })
      ]
      if (langSupport) extensions.push(langSupport)
      view = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent: host })
      viewRef.current = view
    })()
    return () => {
      cancelled = true
      view?.destroy()
      viewRef.current = null
    }
  }, [text, filePath, rendered])

  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({ effects: roRef.current.reconfigure(EditorState.readOnly.of(!editing)) })
    if (editing) v.focus()
  }, [editing])

  const save = useCallback(async (): Promise<void> => {
    const v = viewRef.current
    if (!v || !filePath) return
    const content = v.state.doc.toString()
    const r = await window.api.fs.writeTextFile(filePath, content)
    if (r.ok) {
      setText(content) // 同步给渲染视图，切回排版时看到的是新内容
      setDirty(false)
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(null), 1800)
    } else {
      setSaveMsg('保存失败：' + (r.error ?? '未知错误'))
    }
  }, [filePath])

  // ⌘S / Ctrl+S 保存（只在编辑态、且焦点在本预览内时接管）
  useEffect(() => {
    if (!editing) return
    const h = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (!rootRef.current?.contains(document.activeElement)) return
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', h, { capture: true })
    return () => window.removeEventListener('keydown', h, { capture: true })
  }, [editing, save])

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
    else if (text !== null) void window.api.clipboard.writeText(text)
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
      ref={attachRoot}
      className="code-view"
      onContextMenu={(e) => {
        if (!viewRef.current) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, hasSelection: !viewRef.current.state.selection.main.empty })
      }}
    >
      {status && <div className="pane-status">{status}</div>}
      {rendered ? (
        <div
          className="md-view"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text ?? '', filePath) }}
        />
      ) : (
        <div ref={hostRef} className="code-view-host" />
      )}
      {text !== null && (
        <div className="pv-actions">
          {!!saveMsg && <span className="pv-msg">{saveMsg}</span>}
          {md && !editing && (
            <button
              className="pv-btn"
              data-tip={rendered ? '看原始 Markdown 符号' : '回到排版视图'}
              onClick={() => setShowSource((v) => !v)}
            >
              {rendered ? <CodeIcon size={12} /> : <FilesIcon size={12} />}
              {rendered ? '源代码' : '排版'}
            </button>
          )}
          {editing ? (
            <>
              <button
                className={`pv-btn${dirty ? ' dirty' : ''}`}
                data-tip="保存（⌘S）"
                onClick={() => void save()}
              >
                <CheckIcon size={12} />
                保存
                {dirty && <span className="pv-dot" />}
              </button>
              <button
                className="pv-btn"
                data-tip={dirty ? '有未保存的改动，会先保存再退出' : '退出编辑'}
                onClick={() => {
                  void (async () => {
                    if (dirty) await save()
                    setEditing(false)
                  })()
                }}
              >
                完成
              </button>
            </>
          ) : (
            !readOnly && (
              <button className="pv-btn" data-tip="编辑这个文件" onClick={() => setEditing(true)}>
                <PencilIcon size={12} />
                编辑
              </button>
            )
          )}
        </div>
      )}
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
