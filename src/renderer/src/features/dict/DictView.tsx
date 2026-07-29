import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { DictIcon } from '../../ui/Icons'
import { DictHookBar } from './DictHookBar'
import bundle from './dictionary-bundle.json'
import './dict.css'

// 专业名词词典：词条以胶囊平铺，hover 弹浮层看 SVG 图 + 实现逻辑，
// 点击把「实现逻辑」文本插入到最近活动终端的命令行光标处（不带回车，不执行）。
// 数据是单文件内联 bundle（含 242 词条，SVG 已内联），随 Vite 打进 out/，无运行时依赖。

interface DictTerm {
  id: string
  zh: string
  en: string
  category: string
  keywords: string[]
  logic: string
  svg: string
  /** 以下只有自建词条有：第一次遇到的日期 / 在哪个项目里遇到的 */
  firstSeen?: string
  project?: string
  /** 自建词条标记。分类和内置的三类共用，所以「是不是自建」只能单独记一个标志 */
  user?: boolean
}
interface DictBundle {
  version: number
  count: number
  categories: Record<string, string>
  terms: DictTerm[]
}

const dict = bundle as unknown as DictBundle
// 只有内置三类。自建词条**也归进这三类**，不再单开一个「自建」伪分类——
// 补全后的词条和内置的是同一种东西（有中英文名、有解释、有示意图），按来源分类
// 只会让「我想找个动效相关的词」这件事被拆到两个地方去。
// 想单看自建的走下面那个 onlyUser 开关，它是个筛子而不是分类。
const CATS: Record<string, string> = dict.categories
const CAT_KEYS = Object.keys(CATS)

const POP_W = 320
const MARGIN = 10 // 浮层贴软件边缘时的内边距
const GAP = 12 // 浮层与胶囊的间距

interface HoverState {
  term: DictTerm
  anchor: DOMRect // 触发胶囊的位置，浮层据此定位
}

export function DictView(): JSX.Element {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string>('all')
  // 「只看自建」：和分类正交的一个筛子，不是第四个分类
  const [onlyUser, setOnlyUser] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [popPos, setPopPos] = useState({ left: 0, top: 0, ready: false })
  const [flashId, setFlashId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const popRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 用户自建词条：运行时从 ~/.eas/dict-user.json 读，和编译进包的 242 条合并。
  // 词典 bundle 是 Vite 静态 import（编译期定死），不做这一步的话补全多少词都看不见。
  const [userTerms, setUserTerms] = useState<DictTerm[]>([])
  const reloadUser = useCallback(() => {
    void window.api.fs.userTerms().then((list) => {
      setUserTerms(
        list.map((u) => ({
          id: 'user:' + u.id, // 加前缀，避免和内置词条 id 撞车
          zh: u.zh || u.en,
          en: u.en,
          category: u.category,
          keywords: u.keywords,
          logic: u.logic,
          svg: u.svg,
          firstSeen: u.firstSeen,
          project: u.project,
          user: true
        }))
      )
    })
  }, [])
  useEffect(reloadUser, [reloadUser])

  // agent 通过 dict_add 写完词条后，词典得当场多出来——不然要关掉再打开才看得见，
  // 用户根本不会知道刚才那一下成功了。MCP 流水里出现 dict_add 就重读一次，
  // 比定时轮询精确，也不用另开一条 IPC 通知。
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.mcpLog === prev.mcpLog) return
        if (s.mcpLog[0]?.tool === 'dict_add' && s.mcpLog[0].ok) reloadUser()
      }),
    [reloadUser]
  )

  const allTerms = useMemo(() => [...dict.terms, ...userTerms], [userTerms])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTerms.filter((t) => {
      if (onlyUser && !t.user) return false
      if (cat !== 'all' && t.category !== cat) return false
      if (!q) return true
      if (t.zh.toLowerCase().includes(q)) return true
      if (t.en.toLowerCase().includes(q)) return true
      return t.keywords.some((k) => k.toLowerCase().includes(q))
    })
  }, [query, cat, onlyUser, allTerms])

  // 浮层出现后测量真实尺寸，把它 clamp 进视口——超出软件边缘就贴边向内移，绝不截断。
  useLayoutEffect(() => {
    if (!hover) {
      setPopPos((p) => (p.ready ? { ...p, ready: false } : p))
      return
    }
    const pop = popRef.current
    if (!pop) return
    const { width: pw, height: ph } = pop.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const a = hover.anchor
    // 水平：优先放右侧；右侧放不下翻到左侧；最后 clamp 保证整体在视口内
    let x = a.right + GAP
    if (x + pw > vw - MARGIN) x = a.left - GAP - pw
    x = Math.max(MARGIN, Math.min(x, vw - pw - MARGIN))
    // 垂直：顶部对齐胶囊，再 clamp（底部超出则整体上移贴下边缘）
    let y = a.top
    y = Math.max(MARGIN, Math.min(y, vh - ph - MARGIN))
    setPopPos({ left: x, top: y, ready: true })
  }, [hover])

  const insert = (term: DictTerm): void => {
    const s = useStore.getState()
    const t = s.lastActiveTerminal
    // 记录的终端可能已被关闭（pty 死后 write 是静默 no-op，会假成功）：
    // 校验该 ptyId 仍存在于某个面板里，不在则提示而不是闪"已插入"
    const alive =
      !!t &&
      s.tabs.some((tab) =>
        collectLeaves(tab.root).some(
          (l) => l.pane.kind === 'terminal' && l.pane.ptyId === t.ptyId
        )
      )
    if (!t || !alive) {
      setNotice('没有可插入的终端——先点一下某个终端面板')
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      noticeTimer.current = setTimeout(() => setNotice(''), 2600)
      return
    }
    // 自建词条的 logic 是空的（脚本不花 token 生成解释）→ 退回插入英文名，
    // 至少能拿去问 agent；插一个空字符串会闪「已插入」但什么也没发生
    const text = term.logic || term.en
    // 不带 \n = 插入到光标，不执行（logic 均为单行文本，已确认无换行）
    window.api.pty.write(t.ptyId, text)
    setFlashId(term.id)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 1100)
  }

  return (
    <div className="dict-view">
      <div className="dict-head">
        <DictIcon size={13} />
        <span className="dict-title">名词词典</span>
        <span className="dict-count">
          {filtered.length} / {allTerms.length}
        </span>
        <span className="pane-spacer" />
        <input
          className="dict-search"
          placeholder="搜索关键词 / 中英文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="dict-cats">
        <button
          className={`dict-chip${cat === 'all' ? ' active' : ''}`}
          onClick={() => setCat('all')}
        >
          全部
        </button>
        {CAT_KEYS.map((k) => (
          <button
            key={k}
            className={`dict-chip cat-${k}${cat === k ? ' active' : ''}`}
            onClick={() => setCat(k)}
          >
            {CATS[k]}
          </button>
        ))}
        {/* 一条自建词条都没有时不显示这个筛子——空筛子只会让人点一下发现什么都没有 */}
        {userTerms.length > 0 && (
          <button
            className={`dict-chip cat-user${onlyUser ? ' active' : ''}`}
            onClick={() => setOnlyUser((v) => !v)}
            data-tip="只看自动补全进来的词条"
          >
            自建 {userTerms.length}
          </button>
        )}
      </div>

      <DictHookBar />

      <div className="dict-list" onMouseLeave={() => setHover(null)}>
        {filtered.length === 0 && <div className="git-empty">没有匹配的词条</div>}
        {filtered.map((term) => (
          <button
            key={term.id}
            className={`dict-pill cat-${term.category}${term.user ? ' own' : ''}${flashId === term.id ? ' flash' : ''}`}
            onMouseEnter={(e) =>
              setHover({ term, anchor: e.currentTarget.getBoundingClientRect() })
            }
            // 移开该胶囊就收起预览（不等移出整个列表——停在空白处不该残留浮层）
            onMouseLeave={() => setHover(null)}
            onClick={() => insert(term)}
            data-tip="点击把实现逻辑插入到活动终端光标处"
          >
            <span className={`dict-dot cat-${term.category}`} />
            <span className="dict-pill-zh">{term.zh}</span>
          </button>
        ))}
      </div>

      {notice && <div className="dict-notice">{notice}</div>}

      {hover &&
        // Portal 到 body：玻璃面板 backdrop-filter + overflow:hidden 会裁切 fixed 后代，必须逃逸
        createPortal(
          <div
            ref={popRef}
            className="dict-pop"
            style={{
              left: popPos.left,
              top: popPos.top,
              width: POP_W,
              // 未定位完成前先隐藏，避免出现在旧坐标闪一下
              visibility: popPos.ready ? 'visible' : 'hidden'
            }}
          >
            <div className="dict-pop-head">
              <span className="dict-zh">{hover.term.zh}</span>
              {/* 极少数情况下 zh 缺失会回落成 en，别把同一个词并排印两遍 */}
              {hover.term.zh !== hover.term.en && <span className="dict-en">{hover.term.en}</span>}
              <span className={`dict-tag cat-${hover.term.category}`}>
                {CATS[hover.term.category] ?? hover.term.category}
              </span>
              {hover.term.user && <span className="dict-tag cat-user">自建</span>}
            </div>
            {/* 内联 SVG 走 dangerouslySetInnerHTML，不受 CSP img-src 限制。
                自建词条的 SVG 是模型写的，写盘前已在主进程清洗过（见 main/dict.ts）。
                真没有图的老条目别渲染一个空盒子撑出留白 */}
            {!!hover.term.svg && (
              <div className="dict-pop-svg" dangerouslySetInnerHTML={{ __html: hover.term.svg }} />
            )}
            {hover.term.logic ? (
              <div className="dict-pop-logic">{hover.term.logic}</div>
            ) : (
              <div className="dict-pop-logic dim">
                这条是旧版自动沉淀留下的空壳
                {hover.term.project ? `（${hover.term.project}` : ''}
                {hover.term.firstSeen ? ` · ${hover.term.firstSeen}）` : hover.term.project ? '）' : ''}
                。让 agent 补一次就有解释和示意图了。
              </div>
            )}
            {hover.term.user && !!hover.term.logic && !!hover.term.firstSeen && (
              <div className="dict-pop-meta">
                自动补全 · {hover.term.firstSeen}
                {hover.term.project ? ` · ${hover.term.project}` : ''}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
