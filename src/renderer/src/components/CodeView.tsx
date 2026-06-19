import { useEffect, useRef, useState } from 'react'
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

export function CodeView({ filePath }: { filePath: string | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<string | null>(null)

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

      const extensions = [
        basicSetup,
        oneDark,
        glassTheme,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true)
      ]
      if (langSupport) extensions.push(langSupport)

      view = new EditorView({
        state: EditorState.create({ doc: result.content, extensions }),
        parent: host
      })
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
    }
  }, [filePath])

  if (!filePath) {
    return (
      <div className="pane-placeholder">
        <div>代码预览</div>
        <div className="pane-placeholder-hint">在左侧文件树中点击一个文件</div>
      </div>
    )
  }

  return (
    <div className="code-view">
      {status && <div className="pane-status">{status}</div>}
      <div ref={hostRef} className="code-view-host" />
    </div>
  )
}
