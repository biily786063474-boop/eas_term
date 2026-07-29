import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { DictIcon } from '../../ui/Icons'
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
}
interface DictBundle {
  version: number
  count: number
  categories: Record<string, string>
  terms: DictTerm[]
}

const dict = bundle as unknown as DictBundle
// 内置三类 + 「自建」：后者是「提交即复盘」hook 沉淀进 ~/.eas/dict-user.json 的词，
// 单列一类是为了能一键筛掉——启发式抓来的词有噪声，混在内置词里会稀释词典的可信度
const CATS: Record<string, string> = { ...dict.categories, user: '自建' }
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
  const [hover, setHover] = useState<HoverState | null>(null)
  const [popPos, setPopPos] = useState({ left: 0, top: 0, ready: false })
  const [flashId, setFlashId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const popRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 用户自建词条：运行时从 ~/.eas/dict-user.json 读，和编译进包的 242 条合并。
  // 词典 bundle 是 Vite 静态 import（编译期定死），不做这一步的话 hook 沉淀多少词都看不见。
  const [userTerms, setUserTerms] = useState<DictTerm[]>([])
  useEffect(() => {
    let alive = true
    void window.api.fs.userTerms().then((list) => {
      if (!alive) return
      setUserTerms(
        list.map((u) => ({
          id: 'user:' + u.id, // 加前缀，避免和内置词条 id 撞车
          zh: u.zh || u.en, // 脚本不生成中文名，空就用英文顶上
          en: u.en,
          category: 'user',
          keywords: u.keywords,
          logic: u.logic,
          svg: '',
          firstSeen: u.firstSeen,
          project: u.project
        }))
      )
    })
    return () => {
      alive = false
    }
  }, [])

  const allTerms = useMemo(() => [...dict.terms, ...userTerms], [userTerms])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTerms.filter((t) => {
      if (cat !== 'all' && t.category !== cat) return false
      if (!q) return true
      if (t.zh.toLowerCase().includes(q)) return true
      if (t.en.toLowerCase().includes(q)) return true
      return t.keywords.some((k) => k.toLowerCase().includes(q))
    })
  }, [query, cat, allTerms])

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
      </div>

      <div className="dict-list" onMouseLeave={() => setHover(null)}>
        {filtered.length === 0 && <div className="git-empty">没有匹配的词条</div>}
        {filtered.map((term) => (
          <button
            key={term.id}
            className={`dict-pill cat-${term.category}${flashId === term.id ? ' flash' : ''}`}
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
              {/* 自建词条没有中文名时 zh 回落成了 en，别把同一个词并排印两遍 */}
              {hover.term.zh !== hover.term.en && <span className="dict-en">{hover.term.en}</span>}
              <span className={`dict-tag cat-${hover.term.category}`}>
                {CATS[hover.term.category] ?? hover.term.category}
              </span>
            </div>
            {/* 内联 SVG 走 dangerouslySetInnerHTML，不受 CSP img-src 限制。
                自建词条没有配图，别渲染一个空盒子撑出留白 */}
            {!!hover.term.svg && (
              <div className="dict-pop-svg" dangerouslySetInnerHTML={{ __html: hover.term.svg }} />
            )}
            {hover.term.logic ? (
              <div className="dict-pop-logic">{hover.term.logic}</div>
            ) : (
              <div className="dict-pop-logic dim">
                还没写解释。这是提交时自动沉淀的术语
                {hover.term.project ? `（${hover.term.project}` : ''}
                {hover.term.firstSeen ? ` · ${hover.term.firstSeen}）` : hover.term.project ? '）' : ''}
                ，想补的话改 <code>~/.eas/dict-user.json</code>。
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
