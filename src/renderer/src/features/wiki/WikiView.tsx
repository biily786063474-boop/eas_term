// 终端模式下的知识库面板。和终端并排 —— 一边看笔记一边让 agent 干活，
// 这是终端模式下最自然的用法（也正是 Karpathy 描述的「一侧 agent、一侧 Obsidian」，
// 只不过这里不用开两个应用）。
//
// 和画布**右侧**的知识库抽屉共用同一套 IPC，但形态不同：这里空间大，直接文件树 + 正文预览左右分。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WikiStatus, Backlink, LintFinding, WikiStats } from '../../../../shared/types'
import { WikiGraph } from './WikiGraph'
import { FileTree } from '../files/FileTree'
import { renderMarkdown, bindCodeCopy } from '../editor/markdown'
import { FolderOpenIcon } from '../../ui/Icons'
import '../editor/editor.css'
import './wiki.css'

/**
 * 剥掉 YAML front-matter，单独返回 summary / tags。
 *
 * 知识库里**每篇**笔记都有 front-matter（summary 和 tags 是硬约定），
 * 不剥的话打开笔记第一眼看到的是一堆元数据噪声。
 * 剥完把 summary 和 tags 做成顶部一行——它们本来就是这篇的「一句话是什么」，
 * 比藏在源码里有用。
 */
function splitFrontMatter(src: string): { summary: string; tags: string[]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { summary: '', tags: [], body: src }
  let summary = ''
  let tags: string[] = []
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line.trim())
    if (!kv) continue
    if (kv[1] === 'summary') summary = kv[2].trim()
    else if (kv[1] === 'tags') {
      tags = kv[2]
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
    }
  }
  return { summary, tags, body: src.slice(m[0].length) }
}

export function WikiView(): JSX.Element {
  const [st, setSt] = useState<WikiStatus | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [links, setLinks] = useState<Backlink[]>([])
  const [raw, setRaw] = useState(false)
  const [view, setView] = useState<'tree' | 'graph' | 'lint'>('tree')
  const [lint, setLint] = useState<LintFinding[] | null>(null)
  const [stats, setStats] = useState<WikiStats | null>(null)
  // 代码块复制按钮的委托挂点。两个决定都有原因：
  //  · 挂 .wikiv-main 而不是里面那个 .md-view —— 后者在「渲染/源码」切换时是条件渲染，
  //    节点整个消失，绑在它上面的监听跟着丢。
  //  · 用**回调 ref** 而不是 useRef + useEffect(…, []) —— 知识库状态没读回来之前，
  //    这个组件会提前 return 一个「读取知识库…」占位符，那一帧 .wikiv-main 压根没挂载，
  //    首次 effect 只能拿到 null，于是绑定永远不会发生（症状很隐蔽：按钮画得出来，点了没反应）。
  const unbindCopy = useRef<(() => void) | null>(null)
  const mainRef = useCallback((node: HTMLDivElement | null) => {
    unbindCopy.current?.()
    unbindCopy.current = node ? bindCodeCopy(node) : null
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setSt(await window.api.wiki.status())
  }, [])
  useEffect(() => {
    void refresh()
    void window.api.wiki.stats().then(setStats)
  }, [refresh])

  const openNote = async (p: string): Promise<void> => {
    setSel(p)
    const r = await window.api.fs.readTextFile(p)
    if (r.ok) {
      setBody(r.content)
      setLinks(await window.api.wiki.backlinks(p))
      return
    }
    // 读不到通常不是这一篇的问题，是整个知识库目录被移走/删了/网络盘没挂上。
    // 甩一句 ENOENT 加一长串路径给用户看没有任何用，直接说人话并刷新状态，
    // 让上面的「还没有知识库」空态接管
    setLinks([])
    const fresh = await window.api.wiki.status()
    setSt(fresh)
    setBody(
      fresh.exists
        ? `这篇打不开了 —— 可能刚被改名或删掉。\n\n${r.error ?? ''}`
        : `知识库目录不在了：${fresh.path}\n\n可能被移走、删掉，或者它在一块没挂上的网络盘上。\n切到画布模式，在左边的知识库里重新指一个位置。`
    )
  }

  if (!st) return <div className="pane-placeholder">读取知识库…</div>
  if (!st.configured || !st.exists) {
    return (
      <div className="pane-placeholder wikiv-empty">
        <b>还没有知识库</b>
        <span>切到画布模式，在左边把它建起来 —— 位置由你选，就是一个普通的 markdown 文件夹。</span>
      </div>
    )
  }

  return (
    <div className="wikiv">
      <div className="wikiv-side">
        <div className="wikiv-side-h">
          <span>{st.notes} 篇</span>
          {!!st.inbox && <em>收件箱 {st.inbox}</em>}
          <span className="pane-spacer" />
          <button data-tip="在访达里打开" onClick={() => void window.api.wiki.reveal()}>
            <FolderOpenIcon size={12} />
          </button>
        </div>
        <div className="wikiv-tabs">
          <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>
            文件
          </button>
          <button
            className={view === 'graph' ? 'on' : ''}
            onClick={() => setView('graph')}
            data-tip="看清知识库的形状：谁是枢纽、谁是孤儿"
          >
            图谱
          </button>
          <button
            className={view === 'lint' ? 'on' : ''}
            onClick={() => {
              setView('lint')
              void window.api.wiki.lint().then(setLint)
            }}
            data-tip="结构体检：死链、孤儿页、缺字段、索引漏收"
          >
            体检
          </button>
        </div>
        <div
          className="wikiv-tree"
          style={view === 'tree' ? undefined : { display: 'none' }}
          onMouseDown={(e) => {
            // 内联输入框（重命名）上不要顺手把笔记打开
            if ((e.target as HTMLElement).closest('input')) return
            const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
            const p = item?.dataset.path
            if (p && !item?.dataset.dir) void openNote(p)
          }}
        >
          <FileTree rootPath={st.path!} refreshKey={0} />
        </div>
        {view === 'lint' && (
          <div className="wikiv-lint">
            {!lint ? (
              <div className="pane-placeholder">体检中…</div>
            ) : lint.length === 0 ? (
              <div className="wikiv-lint-ok">结构上没发现问题</div>
            ) : (
              <>
                <div className="wikiv-lint-h">{lint.length} 条 · 只是结构问题</div>
                {lint.slice(0, 200).map((f, i) => (
                  <button
                    key={i}
                    className={`wikiv-lint-row k-${f.kind}`}
                    onClick={() => void openNote(st.path + '/' + f.file)}
                  >
                    <b>{f.file.split('/').pop()}</b>
                    <span>{f.detail}</span>
                  </button>
                ))}
                <div className="wikiv-lint-foot">
                  矛盾、被新素材推翻的旧结论这些要读懂内容才能发现，
                  在终端里让 agent 跑一次 <code>wiki_lint</code> 再做那半边。
                </div>
              </>
            )}
          </div>
        )}
        {!!stats && (
          <div className={`wikiv-stats${stats.added > 20 && stats.query * 5 < stats.added ? ' warn' : ''}`}>
            放入 {stats.added} · 查询 {stats.query}
            {stats.added > 20 && stats.query * 5 < stats.added && (
              <em>只进不出，它正在变成仓库而不是工具</em>
            )}
          </div>
        )}
      </div>

      <div className="wikiv-main" ref={mainRef}>
        {view === 'graph' ? (
          <WikiGraph onOpen={(rel) => { setView('tree'); void openNote(st.path + '/' + rel) }} />
        ) : !sel ? (
          <div className="pane-placeholder">左边选一篇笔记</div>
        ) : (
          <>
            <div className="wikiv-bar">
              <span className="wikiv-name">{sel.split('/').pop()}</span>
              <span className="pane-spacer" />
              <button onClick={() => setRaw((v) => !v)}>{raw ? '渲染' : '源码'}</button>
            </div>
            {raw ? (
              // 源码视图给完整原文，front-matter 也在——要改字段的时候得看得见
              <pre className="wikiv-raw">{body}</pre>
            ) : (
              <div className="wikiv-md md-view">
                {(() => {
                  const { summary, tags, body: md } = splitFrontMatter(body)
                  return (
                    <>
                      {(!!summary || !!tags.length) && (
                        <div className="wikiv-meta">
                          {!!summary && <span className="wikiv-sum">{summary}</span>}
                          {tags.map((t) => (
                            <span key={t} className="wikiv-tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(md, sel) }} />
                    </>
                  )
                })()}
              </div>
            )}
            {!!links.length && (
              <div className="wikiv-back">
                <b>反向链接 {links.length}</b>
                {links.slice(0, 20).map((b, i) => (
                  <div key={i} className="wikiv-back-row" onClick={() => void openNote(st.path + '/' + b.file)}>
                    ← {b.file}
                    <em>{b.text}</em>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
