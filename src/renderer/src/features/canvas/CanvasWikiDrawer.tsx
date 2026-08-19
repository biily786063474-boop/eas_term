// 画布**右侧**抽屉：个人知识库。（原来这里是「基本操作」四个画笔工具，已收成右下角的紧凑图标栏。）
// （2026-08-13 左右对调过：这个抽屉从左挪到了右，资源抽屉从右挪到了左。
//  实际定位见 canvas.css 的 `.wiki-drawer { right: 8px }` 与 `.canvas-drawer { left: 8px }`。）
//
// 放在这儿而不是单开一个页面，理由和角色分区一样：
// 知识库的使用时机是「我正在干活、想起来查一下」，那一刻人在画布上。
// 给它一个专属房间，等于让人为了用它专门跑一趟。
//
// 收件箱那行刻意不只显示数量：数字会涨但不扎人，
// 「最早一份来自 23 天前」才让人意识到只进不出。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { WikiStatus, Backlink, WikiHit, WikiCommit } from '../../../../shared/types'
import { FileTree } from '../files/FileTree'
import { FileLightbox } from './FileLightbox'
import { isImagePath, isVideoPath } from './media'
import { useOpenInCanvas, viewportCenter } from './useOpenInCanvas'
import {
  ChevronRightIcon,
  PlusIcon,
  FolderOpenIcon,
  SparkleIcon,
  TerminalIcon,
  GearIcon
} from '../../ui/Icons'
import { liveMaximizedNode } from '../../store/canvas/selectors'
import { CanvasSkillPanel } from './CanvasSkillPanel'

/** 抽屉左上角名称下拉切换的两档：知识库 / Skill。整个内容换掉，不是上下分区
 *  （抽屉只有 250px 宽，两块并存太挤——design 文档 §六 第 5 条）。 */
type DrawerMode = 'wiki' | 'skill'

/** 两个书签。**全中文**——「Skill」在一堆中文界面里是唯一的英文词，
 *  而它指的东西（可复用的做事套路）本来就有中文说法。 */
const MODES: { id: DrawerMode; label: string; tip: string }[] = [
  { id: 'wiki', label: '知识库', tip: '攒下来的资料与笔记' },
  { id: 'skill', label: '技能库', tip: '可复用的做事套路（Skill）' }
]

export function CanvasWikiDrawer(): JSX.Element | null {
  const maximizedNode = useStore(liveMaximizedNode)
  const [open, setOpen] = useState(false)
  const setWikiDrawerOpen = useStore((s) => s.setWikiDrawerOpen)
  const [hover, setHover] = useState(false)
  const [mode, setMode] = useState<DrawerMode>('wiki')

  const [st, setSt] = useState<WikiStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [dropping, setDropping] = useState(false)
  // 点开一篇笔记先进灯箱看（看完即走）。**灯箱里可以改** —— fsGuard 认知识库根，
  // 而且人就在原地看这个文件。拖到画布上那份仍是只读（内容离开知识库目录后
  // 不该被顺手改掉，既有决定不变），两件事别混。
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  // 知识库文件 → 画布：自由 + **只读**节点。这条路的实现在 useOpenInCanvas 里，
  // 和 skill 面板共用一份（两边只差「落地的节点可不可写」这一个参数）。
  // 只读这条不能动：内容离开知识库目录后不该在画布上被顺手改掉。
  const { openInCanvas, startFileDrag, htmlChoice } = useOpenInCanvas({ readOnly: true })
  const [links, setLinks] = useState<Backlink[]>([])
  const [treeKey, setTreeKey] = useState(0)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WikiHit[]>([])
  const [suggest, setSuggest] = useState('')
  const [settings, setSettings] = useState(false)
  const [history, setHistory] = useState<WikiCommit[] | null>(null)
  const ttQueue = useStore((s) => s.ttQueue)
  const enqueueTranscribe = useStore((s) => s.enqueueTranscribe)
  const edgeRef = useRef<HTMLSpanElement>(null)
  const openTerminal = useStore((s) => s.openTerminal)

  const refresh = useCallback(async (): Promise<void> => {
    setSt(await window.api.wiki.status())
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
      const t = e.target as HTMLElement
      // 右键菜单/确认弹窗 portal 到 body，DOM 上不在抽屉里但逻辑上属于它。
      // 不放过的话：右键笔记点「重命名」，抽屉当场收起，输入框跟着滑出屏幕
      if (t.closest?.('.canvas-ctxmenu') || t.closest?.('.context-menu') || t.closest?.('.confirm-overlay')) return
      // 判的是**外壳**不是抽屉本体：模式胶囊挂在抽屉左侧、DOM 上是它的兄弟，
      // 但逻辑上就是抽屉的一部分。把边界画在 .wk-shell 上，胶囊自然在里面 ——
      // 比给它单开一条豁免干净（那种名单迟早会漏下一个新控件）。
      if (!t.closest?.('.wk-shell')) setOpen(false)
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

  // 开合状态同步给全局：左下角缩略图要跟着让位
  useEffect(() => {
    setWikiDrawerOpen(open)
    return () => setWikiDrawerOpen(false) // 切走视图时别把 class 留在身上
  }, [open, setWikiDrawerOpen])

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
    await refresh()
    setBusy('')
    setTreeKey((k) => k + 1)
  }

  /** 视频/音频进收件箱后自动排队转录：本机跑、不花 token、不碰 wiki 正文。
   *  等用户想整理的时候，最耗时的那一步已经做完了。
   *  收件箱目录名由主进程给（inboxDir）——这里曾经写死成老库的中文名「00-收件箱」，
   *  于是新库（00-inbox）上放进去的音视频路径全是错的，转录静默不发生。 */
  const queueMedia = async (names: string[], root: string, inboxDir: string): Promise<void> => {
    const media = names
      .filter((n) => isVideoPath(n) || /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i.test(n))
      .map((n) => ({ name: n, path: `${root}/${inboxDir}/${n}` }))
    if (media.length) enqueueTranscribe(media)
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setBusy(`放入 ${paths.length} 个…`)
    const r = await window.api.wiki.addToInbox(paths)
    // 整个调用被拒绝（没设置知识库位置、或分类配置读不出来）时 done/failed 都是 undefined，
    // 不判 r.ok 的话下面会静默清空 busy 提示，看起来像"点了但什么都没发生"——
    // 之前只有"没设置位置"一种会走到这里，这次分类配置读不出来也会走同一条路。
    if (!r.ok) {
      setBusy('失败：' + (r.error ?? ''))
      return
    }
    if (r.status?.path && r.inboxDir) void queueMedia(r.done ?? [], r.status.path, r.inboxDir)
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

  // 抽屉本体**始终挂载**，收起时靠 transform 移出画面——和左侧资源抽屉同一套做法。
  // 以前是 `if (!open) return <边缘触发器>`，整个组件不渲染，所以展开是「啪」地出现，
  // 没有任何过渡可言。要动画就必须有个能从 A 补间到 B 的元素在那儿。
  return (
    <>
      {!open && (
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
      )}
      <div className={`wk-shell${open ? ' open' : ''}`}>
        {/* 模式切换：竖排胶囊，挂在抽屉左侧。
            经过记在这儿免得再绕：
              一版 标题上的下拉 —— 切换是这里最高频的动作，藏在下拉里每次要两步。
              二版 左侧外挂的书签 —— 被抽屉自己的 overflow:hidden 整个裁掉；而且即使
                   显示出来，点它会命中「点击外部 → 收起抽屉」，表现成"点了不切换"。
              三版 外面套一层 .wk-shell，胶囊和抽屉都住在里面 —— 于是它**真的是抽屉的
                   一部分**：开合跟着壳一起动（不用两套 transform）、outside-click 判壳
                   就自然包含它（不用豁免名单）、overflow:hidden 留在抽屉本体上只裁自己的
                   内容，裁不到壳里的胶囊。位置问题和点击问题一次解决。 */}
        <div className="wk-seg">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`wk-seg-btn${mode === m.id ? ' on' : ''}`}
              onClick={() => setMode(m.id)}
              data-tip={m.tip}
            >
              {m.label}
            </button>
          ))}
        </div>
    <aside
      className={`wiki-drawer${open ? ' open' : ' closed'}${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!st?.exists) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="wk-head">
        <span className="wk-title">知识资产</span>
        {mode === 'wiki' && !!st?.exists && (
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

      {mode === 'skill' ? (
        <CanvasSkillPanel />
      ) : (
        <>
          {/* ── 未配置：一屏引导 ── */}
          {/* looksEmpty 也走引导页：那种状态下用户需要的是「重新指向 / 换个位置」这两个按钮，
              而不是一棵空树。显示空树等于让他自己去猜文件哪儿去了。 */}
          {!st?.configured || !st.exists || st.looksEmpty ? (
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
              {/* 目录在、但骨架一个都读不到。这种情况以前会显示成一个正常的空知识库，
                  人会以为文件被删了 —— 必须把「可能是指错了 / 读不出来」摆到台面上。 */}
              {st?.configured && st.exists && st.looksEmpty && (
                <div className="wk-warn">
                  这个目录里看不到知识库该有的东西（{st.path}）。
                  <br />
                  可能是指错了位置，也可能是这个目录读不出来 —— 放在网络盘或外置盘上时，
                  系统可能没给本应用读取权限（系统设置 → 隐私与安全性 → 文件与文件夹）。
                  <br />
                  <b>先去访达里确认那个目录下有没有文件，再决定重新指向还是修权限。</b>
                </div>
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
              {/* 分类配置(.eas-wiki.json)在，但读不出来/不是合法 JSON/校验不过——这种情况下
                  main/wiki/schema.ts 的 initWiki 不会往库里建目录、改说明书（回落成内置分类
                  会把这个自定义库真的改写成内置形状，不可逆），只能停在原地等用户把文件改好。
                  这条提示就是把这件事讲清楚，免得用户以为软件卡住了或者数据丢了。 */}
              {st.taxonomyState === 'broken' && (
                <div className="wk-warn wk-taxo-warn">
                  这个库的分类配置读不出来（.eas-wiki.json 格式有问题）。
                  <br />
                  已经暂停按它建目录、改说明书 —— 回落成内置分类会把你自己定的分类覆盖掉，
                  而且改不回来，所以宁可先停在这儿，不碰你现在的库。
                  <br />
                  <b>把这个文件改好，这条提示就会消失；如果这个库的骨架还没建起来过，
                  改完后在下面「位置设置」里把这个位置重新点一遍即可补上。</b>
                  {!!st.taxonomyError && (
                    <>
                      <br />
                      <span className="wk-dim wk-tiny">具体原因：{st.taxonomyError}</span>
                    </>
                  )}
                </div>
              )}

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
                  <div className="wk-set-k" style={{ marginTop: 4 }}>
                    版本管理{st.hasGit ? '' : '（未开启）'}
                  </div>
                  {st.hasGit ? (
                    <>
                      <button
                        className="wk-ghost"
                        onClick={() => void window.api.wiki.history(20).then(setHistory)}
                      >
                        看历史 / 回滚
                      </button>
                      {history && (
                        <div className="wk-hist">
                          {history.length === 0 && <div className="wk-dim wk-tiny">还没有提交</div>}
                          {history.map((c) => (
                            <button
                              key={c.sha}
                              className="wk-hist-row"
                              onClick={() =>
                                void (async () => {
                                  // 回滚前先把现状另存一个提交——「回滚」本身也该是可撤销的
                                  const r = await window.api.wiki.rollback(c.sha)
                                  if (r.ok) {
                                    await refresh()
                                    setTreeKey((k) => k + 1)
                                    setHistory(await window.api.wiki.history(20))
                                  }
                                })()
                              }
                              data-tip={`退回到这里（当前状态会先另存一份，可再退回来）`}
                            >
                              <span>{c.subject.replace(/^\[eas\]\s*/, '')}</span>
                              <em>{new Date(c.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        className="wk-ghost"
                        onClick={() =>
                          void window.api.wiki.gitInit().then(async () => {
                            await refresh()
                          })
                        }
                      >
                        用 git 管起来（推荐）
                      </button>
                      <div className="wk-dim wk-tiny">
                        <b>没有 git 就没有「一键撤销」</b>。AI 归档一次会移动原件、
                        新建笔记、改十几篇老笔记的双链，靠人工还原是不可能的。
                      </div>
                    </>
                  )}
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

              {!!st.inbox && (
                <button
                  className="wk-tidy"
                  onClick={() => {
                    // 不代跑：在知识库目录开个终端把指令填进去，回车由用户按。
                    // agent 会走 wiki_inbox → wiki_archive_plan（弹审批面板）→ wiki_archive_exec
                    void openTerminal({ projectId: null, cwd: st.path ?? undefined })
                    setTimeout(() => {
                      const t = useStore.getState().lastActiveTerminal
                      if (t) window.api.pty.write(t.ptyId, '整理一下收件箱')
                    }, 900)
                  }}
                >
                  让 agent 整理这 {st.inbox} 个
                </button>
              )}

              {/* 转录进度：半小时的视频要跑几分钟，不给进度就像卡住了 */}
              {ttQueue.some((x) => x.state === 'run' || x.state === 'wait') && (
                <div className="wk-tt">
                  {ttQueue
                    .filter((x) => x.state === 'run' || x.state === 'wait')
                    .slice(0, 3)
                    .map((x) => (
                      <div key={x.path} className="wk-tt-row">
                        <span className="wk-tt-name">{x.name}</span>
                        <em>
                          {x.state === 'wait'
                            ? '排队中'
                            : x.total
                              ? `转录 ${x.done}/${x.total}`
                              : '解码中'}
                        </em>
                      </div>
                    ))}
                  <div className="wk-dim wk-tiny">本机离线转录，不花 token</div>
                </div>
              )}
              {ttQueue.some((x) => x.state === 'fail') && (
                <div className="wk-tt fail">
                  {ttQueue
                    .filter((x) => x.state === 'fail')
                    .slice(0, 2)
                    .map((x) => (
                      <div key={x.path} className="wk-tt-row">
                        <span className="wk-tt-name">{x.name}</span>
                        <em>{x.error?.slice(0, 40)}</em>
                      </div>
                    ))}
                </div>
              )}

              {/* 知识库通过 MCP 工具 wiki_query 生效，没有「装/过期」这回事——
                  每次调用都当场读盘。这行只是把「专属」这个边界说清楚，不是状态指示灯。 */}
              <div className="wk-rules ok">
                <span>只在 Eas-Term 的终端里生效 · 换个终端不会读到</span>
              </div>

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
                          setLightbox(abs)
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
                  // 内联输入框（重命名）上的 mousedown 让给它自己：不跳过的话这里会把它
                  // 当成「拖笔记去画布」的起手，输入框里划选文字会变成拖拽手势
                  if ((e.target as HTMLElement).closest('input')) return
                  const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                  const p = item?.dataset.path
                  if (!p || item?.dataset.dir) return
                  startFileDrag(p, e, () => void selectNote(p)) // 没挪动 = 普通点击，选中看反链
                }}
                onDoubleClick={(e) => {
                  // 双击笔记 → 灯箱。落画布是拖拽和灯箱里那个按钮的事，见 FileLightbox 文件头。
                  const item = (e.target as HTMLElement).closest('.tree-item') as HTMLElement | null
                  const p = item?.dataset.path
                  if (!p || item?.dataset.dir) return
                  setLightbox(p)
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
        </>
      )}
    </aside>
      </div>
    {htmlChoice}
    {!!lightbox && (
      <FileLightbox
        filePath={lightbox}
        onClose={() => setLightbox(null)}
        onSendToCanvas={(fp) => {
          const { wx, wy } = viewportCenter()
          openInCanvas(fp, wx - 90, wy - 15)
        }}
      />
    )}
    </>
  )
}
