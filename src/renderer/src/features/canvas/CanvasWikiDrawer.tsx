// 画布左抽屉：个人知识库。（原来这里是「基本操作」四个画笔工具，已收成右下角的紧凑图标栏。）
//
// 放在这儿而不是单开一个页面，理由和角色分区一样：
// 知识库的使用时机是「我正在干活、想起来查一下」，那一刻人在画布上。
// 给它一个专属房间，等于让人为了用它专门跑一趟。
//
// 收件箱那行刻意不只显示数量：数字会涨但不扎人，
// 「最早一份来自 23 天前」才让人意识到只进不出。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { WikiStatus, RulesStatus, Backlink, WikiHit } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { paneForFile } from './media'
import { ChevronRightIcon, PlusIcon, FolderOpenIcon, SparkleIcon, TerminalIcon, GearIcon } from '../../ui/Icons'

export function CanvasWikiDrawer(): JSX.Element | null {
  const maximizedNode = useStore((s) => s.maximizedNode)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [st, setSt] = useState<WikiStatus | null>(null)
  const [rules, setRules] = useState<RulesStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [dropping, setDropping] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [links, setLinks] = useState<Backlink[]>([])
  const [treeKey, setTreeKey] = useState(0)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WikiHit[]>([])
  const [suggest, setSuggest] = useState('')
  const [settings, setSettings] = useState(false)
  const edgeRef = useRef<HTMLSpanElement>(null)
  const addFileNode = useStore((s) => s.addFileNode)
  const openTerminal = useStore((s) => s.openTerminal)

  const refresh = useCallback(async (): Promise<void> => {
    setSt(await window.api.wiki.status())
    setRules(await window.api.rules.status())
  }, [])
  useEffect(() => {
    void refresh()
    void window.api.wiki.suggestPath().then(setSuggest)
  }, [refresh])

  // 搜索防抖：每敲一个字就全库扫一遍没必要，200ms 足够跟手
  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    const t = window.setTimeout(() => void window.api.wiki.search(q).then(setHits), 200)
    return () => window.clearTimeout(t)
  }, [q])

  // 抽屉打开时点外面收起（延后一拍挂载，避开「开抽屉那一下」）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest?.('.wiki-drawer')) setOpen(false)
    }
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  // 打开时刷新一次：外面可能刚往收件箱丢了东西
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const onEdgeMove = (e: React.MouseEvent): void => {
    const el = edgeRef.current
    if (!el) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = Math.max(0, Math.min(1, 1 - (e.clientX - r.left) / r.width))
    el.style.transition = 'transform 0.1s ease-out, opacity 0.22s ease'
    el.style.transform = `translateX(${(9 * t).toFixed(2)}px)`
  }
  const resetEdge = (): void => {
    const el = edgeRef.current
    if (!el) return
    el.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease'
    el.style.transform = ''
  }

  /** pick=true 时弹目录选择器，否则直接用建议位置——大多数人不需要挑，给个好默认就行 */
  const setup = async (pick: boolean): Promise<void> => {
    let picked = suggest
    if (pick) {
      setBusy('选择位置…')
      picked = (await window.api.wiki.pickPath()) ?? ''
    }
    if (!picked) {
      setBusy('')
      return
    }
    setBusy('建目录…')
    const r = await window.api.wiki.init(picked)
    if (!r.ok) {
      setBusy('失败：' + (r.error ?? ''))
      return
    }
    // 建完立刻同步规则 —— 不能等用户再点一次：
    // 规则里嵌着知识库路径，先装规则后建库的话里面是空的，而且失效不报错
    await window.api.rules.sync()
    await refresh()
    setBusy('')
    setTreeKey((k) => k + 1)
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setBusy(`放入 ${paths.length} 个…`)
    const r = await window.api.wiki.addToInbox(paths)
    await refresh()
    setBusy(r.failed?.length ? `${r.done?.length ?? 0} 个已放入，${r.failed.length} 个失败` : '')
    if (!r.failed?.length) setTimeout(() => setBusy(''), 1800)
  }

  // 从访达拖文件进来。Electron 32 起 File.path 被移除，直接读是 undefined 且不报错，
  // 必须走 preload 里包的 webUtils.getPathForFile
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropping(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    void addFiles(paths)
  }

  const pickFiles = async (): Promise<void> => {
    const files = await window.api.wiki.pickFiles()
    void addFiles(files)
  }

  const selectNote = async (p: string): Promise<void> => {
    setSel(p)
    setLinks(await window.api.wiki.backlinks(p))
  }

  if (maximizedNode) return null

  // ── 还没配置：收起态引导 ──────────────────────────────────────
  if (!open) {
    return (
      <div className={`wk-edge${hover ? ' hot' : ''}`}>
        <span
          className="wk-edge-guide"
          ref={edgeRef}
          data-tip={st?.configured ? '展开知识库' : '还没建知识库，点开看看'}
          onMouseEnter={() => setHover(true)}
          onMouseMove={onEdgeMove}
          onMouseLeave={() => {
            setHover(false)
            resetEdge()
          }}
          onClick={() => {
            setHover(false)
            setOpen(true)
          }}
        >
          <span className="wk-edge-label">知识库</span>
          {!!st?.inbox && <span className="wk-edge-dot">{st.inbox}</span>}
        </span>
      </div>
    )
  }

  return (
    <aside
      className={`wiki-drawer${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!st?.exists) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="wk-head">
        <span className="wk-title">知识库</span>
        {!!st?.exists && (
          <>
            <button className="wk-icon" data-tip="在访达里打开" onClick={() => void window.api.wiki.reveal()}>
              <FolderOpenIcon size={12} />
            </button>
            <button
              className="wk-icon"
              data-tip="在知识库目录开一个终端，agent 自动带上库内约定"
              onClick={() => void openTerminal({ projectId: null, cwd: st.path ?? undefined })}
            >
              <TerminalIcon size={12} />
            </button>
            <button
              className={`wk-icon${settings ? ' on' : ''}`}
              data-tip="位置设置"
              onClick={() => setSettings((v) => !v)}
            >
              <GearIcon size={12} />
            </button>
          </>
        )}
      </div>

      {/* ── 未配置：一屏引导 ── */}
      {!st?.configured || !st.exists ? (
        <div className="wk-setup">
          <div className="wk-setup-icon">
            <SparkleIcon size={18} />
          </div>
          <b>把杂东西丢进去，AI 帮你归位</b>
          <p>
            一个放在你自己电脑上的 markdown 文件夹。你负责丢素材和提问题，
            agent 负责整理、归档、连交叉引用。
            <br />
            <span className="wk-dim">
              它不是搜索引擎，是一个会自己长大的笔记本 —— 每加一份素材、每问一个问题，
              它都比之前更厚一点。
            </span>
          </p>
          {st?.configured && !st.exists && (
            <div className="wk-warn">上次设的位置找不到了（{st.path}）—— 可能被移走或网络盘没挂上。</div>
          )}
          <button className="wk-primary" disabled={!!busy} onClick={() => void setup(false)}>
            {busy || '建在建议位置'}
          </button>
          {!!suggest && !busy && <span className="wk-dim wk-tiny wk-path">{suggest}</span>}
          <button className="wk-ghost" disabled={!!busy} onClick={() => void setup(true)}>
            选别的地方…
          </button>
          <span className="wk-dim wk-tiny">
            可以直接指向你已有的 Obsidian 库 —— 同名文件不会被覆盖。
          </span>
        </div>
      ) : (
        <>
          {settings && (
            <div className="wk-settings">
              <div className="wk-set-k">当前位置</div>
              <div className="wk-path" title={st.path ?? ''}>
                {st.path}
              </div>
              <div className="wk-set-btns">
                <button
                  onClick={async () => {
                    const p = await window.api.wiki.pickPath()
                    if (!p) return
                    // 换位置只改指向，不搬文件——搬家的决定该由用户在访达里做
                    await window.api.wiki.setPath(p)
                    await window.api.wiki.init(p)
                    await window.api.rules.sync()
                    await refresh()
                    setTreeKey((k) => k + 1)
                    setSettings(false)
                  }}
                >
                  换个位置
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    await window.api.wiki.forget()
                    await window.api.rules.sync()
                    await refresh()
                    setSettings(false)
                  }}
                >
                  解除绑定
                </button>
              </div>
              <div className="wk-dim wk-tiny">
                换位置和解绑都<b>不会动你的文件</b>，只改这个软件指向哪里。
              </div>
            </div>
          )}

          <input
            className="wk-search"
            placeholder="搜标题 / 摘要 / 正文…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
          />

          {/* ── 收件箱：给压力不只给数字 ── */}
          <button className={`wk-inbox${st.inbox ? ' has' : ''}`} onClick={() => void pickFiles()}>
            <span className="wk-inbox-k">收件箱</span>
            {st.inbox ? (
              <span className="wk-inbox-v">
                <b>{st.inbox}</b>
                {st.oldestInboxDays !== null && (
                  <em>
                    {st.oldestInboxDays === 0
                      ? '· 今天刚放的'
                      : `· 最早一份 ${st.oldestInboxDays} 天前`}
                  </em>
                )}
              </span>
            ) : (
              <span className="wk-inbox-v empty">空的 · 拖文件进来或点这里选</span>
            )}
            <PlusIcon size={12} />
          </button>

          {/* ── 规则状态：失效是静默的，必须显式说 ── */}
          {rules && (
            <div className={`wk-rules${rules.claudeWiki && !rules.stale ? ' ok' : ' todo'}`}>
              {rules.claudeWiki && !rules.stale ? (
                <span>规则已就绪 · agent 会主动来查</span>
              ) : (
                <>
                  <span>{rules.stale ? '规则里的位置过期了' : '规则未安装'} · agent 不会主动查</span>
                  <button
                    onClick={() =>
                      void window.api.rules.sync().then((r) => setRules(r.status))
                    }
                  >
                    修复
                  </button>
                </>
              )}
            </div>
          )}

          {/* 搜到东西时用结果替换文件树——同时显示两个会让人不知道该看哪 */}
          {q.trim() ? (
            <div className="wk-hits">
              {hits.length === 0 ? (
                <div className="wk-dim wk-tiny wk-pad">没找到「{q}」</div>
              ) : (
                hits.map((h) => (
                  <button
                    key={h.file}
                    className="wk-hit"
                    onClick={() => {
                      const abs = st.path + '/' + h.file
                      void selectNote(abs)
                      const frame = useStore.getState().canvas.frames.find((f) => !f.parentId)
                      if (frame) addFileNode(frame.id, paneForFile(abs), 0, 0)
                    }}
                  >
                    <b>{h.title}</b>
                    <span>{h.snippet}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {/* ── 文件树 ── */}
          <div
            className="wk-tree"
            style={q.trim() ? { display: 'none' } : undefined}
            onMouseDown={(e) => {
              const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
              const p = item?.dataset.path
              if (!p || item?.dataset.dir) return
              void selectNote(p)
            }}
            onDoubleClick={(e) => {
              // 双击笔记 → 开到画布上看（复用已有的文件节点）
              const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
              const p = item?.dataset.path
              if (!p || item?.dataset.dir) return
              const frame = useStore.getState().canvas.frames.find((f) => !f.parentId)
              if (frame) addFileNode(frame.id, paneForFile(p), 0, 0)
            }}
          >
            <FileTree key={`${st.path}-${treeKey}`} rootPath={st.path!} refreshKey={treeKey} />
          </div>

          {/* ── 反向链接：日用品，比图谱重要 ── */}
          {!!sel && (
            <div className="wk-back">
              <div className="wk-back-h">
                <ChevronRightIcon size={11} />
                反向链接 · {sel.split('/').pop()}
              </div>
              {links.length === 0 ? (
                <div className="wk-dim wk-tiny">还没有笔记引用它</div>
              ) : (
                links.slice(0, 12).map((b, i) => (
                  <div key={i} className="wk-back-row" data-tip={b.text}>
                    ← {b.file}
                  </div>
                ))
              )}
            </div>
          )}

          {!!busy && <div className="wk-busy">{busy}</div>}
        </>
      )}
    </aside>
  )
}
