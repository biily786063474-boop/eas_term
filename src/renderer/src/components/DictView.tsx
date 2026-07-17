import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { collectLeaves } from '../layout'
import { DictIcon } from './Icons'
import bundle from '../dictionary-bundle.json'

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
}
interface DictBundle {
  version: number
  count: number
  categories: Record<string, string>
  terms: DictTerm[]
}

const dict = bundle as unknown as DictBundle
const CATS = dict.categories // { interaction: '交互行为', motion: '动效', visual: 'UI视觉' }
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dict.terms.filter((t) => {
      if (cat !== 'all' && t.category !== cat) return false
      if (!q) return true
      if (t.zh.toLowerCase().includes(q)) return true
      if (t.en.toLowerCase().includes(q)) return true
      return t.keywords.some((k) => k.toLowerCase().includes(q))
    })
  }, [query, cat])

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
    // 不带 \n = 插入到光标，不执行（logic 均为单行文本，已确认无换行）
    window.api.pty.write(t.ptyId, term.logic)
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
          {filtered.length} / {dict.count}
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
            onClick={() => insert(term)}
            title="点击把实现逻辑插入到活动终端光标处"
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
              <span className="dict-en">{hover.term.en}</span>
              <span className={`dict-tag cat-${hover.term.category}`}>
                {CATS[hover.term.category] ?? hover.term.category}
              </span>
            </div>
            {/* 内联 SVG 走 dangerouslySetInnerHTML，不受 CSP img-src 限制 */}
            <div className="dict-pop-svg" dangerouslySetInnerHTML={{ __html: hover.term.svg }} />
            <div className="dict-pop-logic">{hover.term.logic}</div>
          </div>,
          document.body
        )}
    </div>
  )
}
