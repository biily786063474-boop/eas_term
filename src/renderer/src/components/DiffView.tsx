import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'

// 覆盖 oneDark 的不透明背景，让玻璃层透出来（与 CodeView 一致）
const glassTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' }
  },
  { dark: true }
)

interface Props {
  cwd: string
  relPath: string
  /** worktree：暂存区↔工作区；staged：HEAD↔暂存区 */
  mode?: 'worktree' | 'staged'
  /** 若提供，展示该提交内该文件的 diff（父版本↔本提交），忽略 mode */
  commit?: string
}

// 用 @codemirror/merge 的 unifiedMergeView：以「修改后」为正文，行内标出新增（绿）/删除（红）。
// diff 由前端根据 original/modified 两段文本计算，主进程不解析 unified diff。
export function DiffView({ cwd, relPath, mode, commit }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<string | null>('加载中…')

  useEffect(() => {
    const host = hostRef.current!
    let view: EditorView | null = null
    let cancelled = false
    setStatus('加载中…')

    const load = async (): Promise<void> => {
      const res = commit
        ? await window.api.git.commitDiff(cwd, commit, relPath)
        : await window.api.git.diff(cwd, relPath, mode ?? 'worktree')
      if (cancelled) return
      if (!res.ok) {
        setStatus(`无法生成 diff：${res.error ?? '未知错误'}`)
        return
      }
      if (res.binary) {
        setStatus('二进制文件，无法显示 diff')
        return
      }
      const fileName = relPath.split('/').pop() ?? relPath
      const langDesc = LanguageDescription.matchFilename(languages, fileName)
      const langSupport = langDesc ? await langDesc.load() : null
      if (cancelled) return

      const extensions = [
        basicSetup,
        oneDark,
        glassTheme,
        EditorState.readOnly.of(true),
        unifiedMergeView({ original: res.original, mergeControls: false, gutter: true })
      ]
      if (langSupport) extensions.push(langSupport)

      view = new EditorView({
        state: EditorState.create({ doc: res.modified, extensions }),
        parent: host
      })
      setStatus(res.truncated ? '内容较大，diff 已截断显示' : null)
    }
    void load()

    return () => {
      cancelled = true
      view?.destroy()
    }
  }, [cwd, relPath, mode, commit])

  return (
    <div className="diff-view">
      {status && <div className="pane-status">{status}</div>}
      <div ref={hostRef} className="diff-view-host" />
    </div>
  )
}
