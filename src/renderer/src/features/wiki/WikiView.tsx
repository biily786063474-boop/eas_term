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
import { useT, getLang } from '../../i18n.ts'
import type { T } from '../../../../shared/i18n/index.ts'
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

/**
 * 体检条目的界面文案。detail 由主进程生成（与 wiki_lint 共用，保持中文），
 * 这里只在英文界面下按 kind 重写显示；中文界面原样用 detail，解析不出来也原样用。
 */
function lintDetail(f: LintFinding, tr: T): string {
  if (getLang() === 'zh') return f.detail
  const d = f.detail
  switch (f.kind) {
    case 'deadlink': {
      const m = /^\[\[(.*)\]\] 指向的笔记不存在$/.exec(d) // i18n-allow: 匹配主进程中文原文
      return m ? tr('wikiUi.lint.deadlink', { link: m[1] }) : d
    }
    case 'nosummary':
      return tr('wikiUi.lint.nosummary')
    case 'notags':
      return tr('wikiUi.lint.notags')
    case 'orphan':
      return tr('wikiUi.lint.orphan')
    case 'stale': {
      const m = /^(\d+) 天没动过$/.exec(d) // i18n-allow: 匹配主进程中文原文
      return m ? tr('wikiUi.lint.stale', { days: m[1] }) : d
    }
    case 'thin': {
      const m = /^正文只有 (\d+) 字$/.exec(d) // i18n-allow: 匹配主进程中文原文
      return m ? tr('wikiUi.lint.thin', { n: m[1] }) : d
    }
    case 'noindex': {
      const m = /^(\d+) 篇没进索引：(.*?)( 等)?$/.exec(d) // i18n-allow: 匹配主进程中文原文
      if (!m) return d
      const titles = m[2].split('、').join(tr('wikiUi.lint.titleSep'))
      return tr(m[3] ? 'wikiUi.lint.noindexMore' : 'wikiUi.lint.noindex', { n: m[1], titles })
    }
    default:
      return d
  }
}

export function WikiView(): JSX.Element {
  const tr = useT()
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
        ? tr('wikiUi.note.gone', { err: r.error ?? '' })
        : tr('wikiUi.dir.gone', { path: fresh.path ?? '' })
    )
  }

  if (!st) return <div className="pane-placeholder">{tr('wikiUi.loading')}</div>
  if (!st.configured || !st.exists) {
    return (
      <div className="pane-placeholder wikiv-empty">
        <b>{tr('wikiUi.empty.title')}</b>
        <span>{tr('wikiUi.empty.hint')}</span>
      </div>
    )
  }

  return (
    <div className="wikiv">
      <div className="wikiv-side">
        <div className="wikiv-side-h">
          <span>{tr('wikiUi.side.notes', { n: st.notes })}</span>
          {!!st.inbox && <em>{tr('wikiUi.side.inbox', { n: st.inbox })}</em>}
          <span className="pane-spacer" />
          <button data-tip={tr('wikiUi.side.reveal')} onClick={() => void window.api.wiki.reveal()}>
            <FolderOpenIcon size={12} />
          </button>
        </div>
        <div className="wikiv-tabs">
          <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>
            {tr('wikiUi.tab.files')}
          </button>
          <button
            className={view === 'graph' ? 'on' : ''}
            onClick={() => setView('graph')}
            data-tip={tr('wikiUi.tab.graphTip')}
          >
            {tr('wikiUi.tab.graph')}
          </button>
          <button
            className={view === 'lint' ? 'on' : ''}
            onClick={() => {
              setView('lint')
              void window.api.wiki.lint().then(setLint)
            }}
            data-tip={tr('wikiUi.tab.lintTip')}
          >
            {tr('wikiUi.tab.lint')}
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
              <div className="pane-placeholder">{tr('wikiUi.lint.running')}</div>
            ) : lint.length === 0 ? (
              <div className="wikiv-lint-ok">{tr('wikiUi.lint.ok')}</div>
            ) : (
              <>
                <div className="wikiv-lint-h">{tr('wikiUi.lint.head', { n: lint.length })}</div>
                {lint.slice(0, 200).map((f, i) => (
                  <button
                    key={i}
                    className={`wikiv-lint-row k-${f.kind}`}
                    onClick={() => void openNote(st.path + '/' + f.file)}
                  >
                    <b>{f.file.split('/').pop()}</b>
                    <span>{lintDetail(f, tr)}</span>
                  </button>
                ))}
                <div className="wikiv-lint-foot">
                  {tr('wikiUi.lint.footBefore')}
                  <code>wiki_lint</code>
                  {tr('wikiUi.lint.footAfter')}
                </div>
              </>
            )}
          </div>
        )}
        {!!stats && (
          <div className={`wikiv-stats${stats.added > 20 && stats.query * 5 < stats.added ? ' warn' : ''}`}>
            {tr('wikiUi.stats.line', { added: stats.added, query: stats.query })}
            {stats.added > 20 && stats.query * 5 < stats.added && (
              <em>{tr('wikiUi.stats.warn')}</em>
            )}
          </div>
        )}
      </div>

      <div className="wikiv-main" ref={mainRef}>
        {view === 'graph' ? (
          <WikiGraph onOpen={(rel) => { setView('tree'); void openNote(st.path + '/' + rel) }} />
        ) : !sel ? (
          <div className="pane-placeholder">{tr('wikiUi.main.pick')}</div>
        ) : (
          <>
            <div className="wikiv-bar">
              <span className="wikiv-name">{sel.split('/').pop()}</span>
              <span className="pane-spacer" />
              <button onClick={() => setRaw((v) => !v)}>{raw ? tr('wikiUi.main.rendered') : tr('wikiUi.main.source')}</button>
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
                <b>{tr('wikiUi.main.backlinks', { n: links.length })}</b>
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
