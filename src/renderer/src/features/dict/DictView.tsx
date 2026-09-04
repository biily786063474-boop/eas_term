import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { DICT_BLOCKS } from '../../../../shared/dictBlocks'
import { searchTerms } from './search.ts'
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
  /** 动效词条独有：演示短片文件名（走 dict-clip:// 协议读，见 main/dictClips.ts）。
   *  有它就播短片，没有才回退到 svg 示意图。 */
  clip?: string
  /** 点击后挂成 chip、发送时展开的完整提示词。**381 条全都有**（2026-08-31 补齐）。
   *  注意有两套格式并存：新写的 242 条是【要达到的效果】…【依赖】六段式，
   *  原有的 139 条是【外观】【动感】【触发】【实现】那套（为动效组件库写的）。 */
  prompt?: string
  /** 二级分类（2026-08-31）。一级 = 你想干什么，二级 = 具体手法。
   *  **老的 category 同时保留**，自建词条和已装的 skill 都还认它。
   *  自建词条没有这两个字段 —— 界面把它们归到「未分类」，不能让它们消失。 */
  cat1?: string
  cat2?: string
  /** 区块标签（2026-09-04）：这条手法适合用在页面的哪一块。
   *  **和 cat1/cat2 正交** —— 一条可以属于 0~3 个区块，也可以一个都不属于
   *  （缓动曲线、噪点这类通用手法就该是空的，不是漏标）。 */
  blocks?: string[]
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
  /** 一级 → 二级清单。**顺序有意义**，界面照这个顺序渲染导航 */
  taxonomy?: Record<string, { name: string; desc?: string }[]>
  terms: DictTerm[]
}

const dict = bundle as unknown as DictBundle
// 只有内置三类。自建词条**也归进这三类**，不再单开一个「自建」伪分类——
// 补全后的词条和内置的是同一种东西（有中英文名、有解释、有示意图），按来源分类
// 只会让「我想找个动效相关的词」这件事被拆到两个地方去。
// 想单看自建的走下面那个 onlyUser 开关，它是个筛子而不是分类。
const CATS: Record<string, string> = dict.categories
const TAX = dict.taxonomy ?? {}
const CAT1_KEYS = Object.keys(TAX)
/** 自建词条没有 cat1，落到这里。**不是一个真分类**，只是不让它们从界面上消失 */
const UNSORTED = '未分类'
/** 分类表里有、但一条词条都还没有的一级 —— **是故意留的空货架，不是 bug**。
 *  给它一句自己的空态，否则用户点进去看到「没有匹配的词条」会以为功能坏了。 */
const EMPTY_SHELF: Record<string, string> = {
  '后端 · 服务': '这一格还是空的 —— 词库目前全是前端的手法。要往里加，用 dict_add 或让 AI 直接写。'
}

const POP_W = 320
const MARGIN = 10 // 浮层贴软件边缘时的内边距
const GAP = 12 // 浮层与胶囊的间距

interface HoverState {
  term: DictTerm
  anchor: DOMRect // 触发胶囊的位置，浮层据此定位
  /** 这条是因为正文（解释或提示词）里的哪一段被搜出来的。
   *  只有正文命中时才有 —— 名字命中不需要解释「为什么是它」 */
  excerpt?: string
}

/** 动效词条的演示短片。
 *
 *  **不能只靠 `autoPlay`。** 用户实测「有时候 hover 能看到动画，有时候就没了」——
 *  在词条之间快速划过时，上一个 <video> 还没 play() 完就被卸载，
 *  Promise 以 AbortError 拒绝；新建的那个 autoPlay 也可能因为媒体还没就绪而错过时机，
 *  结果停在第一帧不动。表现就是「时灵时不灵」，而且看着像短片本身是静止的。
 *
 *  所以显式补三处：数据到位时播、被暂停了就接着播、真播不了才算了。 */
function ClipVideo({ src }: { src: string }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const kick = useCallback(() => {
    const v = ref.current
    // play() 返回的 Promise 在元素被卸载时会 reject，吞掉即可 —— 那不是错误
    if (v && v.paused) void v.play().catch(() => {})
  }, [])
  useEffect(() => {
    kick()
    // 有些情况下 loadeddata 早于 effect，补一次延迟重试兜底
    const t = setTimeout(kick, 120)
    return () => clearTimeout(t)
  }, [kick, src])
  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      onLoadedData={kick}
      onCanPlay={kick}
      onPause={kick}
    />
  )
}

export function DictView({ embedded }: { embedded?: boolean } = {}): JSX.Element {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string>('all')
  /** 选中的二级。**跟着一级走** —— 换一级时必须清掉，否则会筛出空列表
   *  （二级名不跨一级重复，但「材质›玻璃与模糊」在「运动规律」下一条都没有） */
  const [cat2, setCat2] = useState<string | null>(null)
  /** 选中的区块（多选）。**空 = 不筛**，不是「筛出没有区块的」 */
  const [blocks, setBlocks] = useState<string[]>([])
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
          // 归了类的自建词条要能跟内置的一起被二级导航筛到；没归类的落「未分类」
          cat1: u.cat1,
          cat2: u.cat2,
          blocks: u.blocks,
          keywords: u.keywords,
          logic: u.logic,
          // 有提示词才能挂成 chip（没有的话 insert 会退回插解释并明说）
          prompt: u.prompt,
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
  /** 有没有还没归类的词条 —— 没有就不摆那个筛子出来 */
  const hasUnsorted = useMemo(() => allTerms.some((t) => !t.cat1), [allTerms])
  /** 当前一级下的二级清单。「全部」和「未分类」没有二级 */
  const subCats = cat === 'all' || cat === UNSORTED ? [] : (TAX[cat] ?? [])

  // 选中的那个 chip 滚进视野。
  //
  // 分类行是横着滚的（九个一级在 320px 里放不下），点了右边那几个之后
  // **自己选的那一类反而看不见了** —— 用户只能看到一排没高亮的按钮，
  // 分不清现在筛的是什么。
  //
  // **手动算 scrollLeft，不用 scrollIntoView**：那个会把能滚的祖先一起滚，
  // 面板是浮在画布上的，一路滚上去会把画布也带偏。
  const catsRef = useRef<HTMLDivElement>(null)
  const subsRef = useRef<HTMLDivElement>(null)
  const center = (box: HTMLDivElement | null): void => {
    const el = box?.querySelector<HTMLElement>('.dict-chip.active')
    if (!el || !box) return
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  }
  useEffect(() => center(catsRef.current), [cat])
  useEffect(() => center(subsRef.current), [cat2, cat])

  // 分类/自建这两个筛子先过一遍（它们是「只看这一堆」，不参与打分），
  // 剩下的交给 searchTerms 按字段加权排序：名字 > 英文 > 关键词 > 分类 > 提示词 > 解释。
  // 搜索范围从「zh/en/keywords 子串」扩到了正文 —— 打「闭包」能找到防抖，
  // 打「交互行为」能找到那一整类（见 search.ts）
  const filtered = useMemo(() => {
    const base = allTerms.filter((t) => {
      if (onlyUser && !t.user) return false
      if (cat !== 'all' && (t.cat1 ?? UNSORTED) !== cat) return false
      if (cat2 && t.cat2 !== cat2) return false
      // **多选是「或」不是「与」。** 选了卡片＋弹层，要的是「这两块能用上的手法」
      // 的并集；取交集的话结果几乎总是空的（同时属于两个区块的本来就少）。
      if (blocks.length && !blocks.some((b) => t.blocks?.includes(b))) return false
      return true
    })
    // 分类名也参与搜索：打「玻璃」既能命中词条名，也能把整个「玻璃与模糊」捞出来
    return searchTerms(base, query, (t) =>
      [t.cat1, t.cat2].filter(Boolean).join(' ') || CATS[t.category]
    )
  }, [query, cat, cat2, blocks, onlyUser, allTerms])

  // 浮层出现后测量真实尺寸，把它 clamp 进视口——超出软件边缘就贴边向内移，绝不截断。
  //
  // **只在 hover 变化时测一次是不够的。** 动效词条的短片是 <video>，元数据异步到达，
  // 到了之后 height:auto 会把浮层撑高一截；那时候位置还是按「视频没加载」的旧高度算的，
  // 于是浮层下缘探出软件边缘。所以要盯着尺寸变化随时重贴，窗口缩放同理。
  useLayoutEffect(() => {
    if (!hover) {
      setPopPos((p) => (p.ready ? { ...p, ready: false } : p))
      return
    }
    const pop = popRef.current
    if (!pop) return
    const place = (): void => {
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
      setPopPos((p) =>
        p.ready && p.left === x && p.top === y ? p : { left: x, top: y, ready: true }
      )
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(pop)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [hover])

  const flash = (id: string): void => {
    setFlashId(id)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 1100)
  }
  const say = (msg: string): void => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 2600)
  }

  const insert = (term: DictTerm): void => {
    const s = useStore.getState()

    // ── 有提示词、又有对话输入框 → 挂成 chip ────────────────────────────
    // 提示词有 200-350 字，直接倒进输入框会把用户自己打的那句话淹掉，也撤不回来。
    // chip 只显示名字，**发送那一刻才展开成全文**（见 chips.ts）。
    if (term.prompt && s.composerAddChip) {
      s.composerAddChip({ id: term.id, label: term.zh, text: term.prompt })
      flash(term.id)
      return
    }

    // ── 其余情况：插纯文本 ────────────────────────────────────────────
    // 终端走这条（字节流没有 DOM，挂不了能点掉的块，全文反而是对的）；
    // 还没写提示词的词条也走这条，但要**说清楚插进去的不是提示词** ——
    // 「点出来是解释」正是这次要修的毛病，不能悄悄退化回去还装作成功。
    const text = term.prompt || term.logic || term.en
    if (!term.prompt && s.composerAddChip) {
      s.composerAppend?.(text)
      flash(term.id)
      say(`「${term.zh}」还没有提示词，插入的是它的解释`)
      return
    }

    // **AI 对话的输入框优先**（2026-08-26 用户要求：不止终端）。
    // composerAppend 由两个对话输入框在 onFocus 时登记，聚焦终端时被 TerminalView
    // 置 null —— 所以「它非空」正好等于「最后碰的是对话框」。
    // 这里不做存活校验：回调直接指向那个组件的 setText，组件没了回调也就不再被登记；
    // 而终端那边必须校验，因为 ptyId 死后 write 是**静默 no-op**，会假装成功。
    const append = s.composerAppend
    if (append) {
      append(text)
      flash(term.id)
      return
    }

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
      say('没有可插入的地方——先点一下某个终端或 AI 对话的输入框')
      return
    }
    // 不带 \n = 插入到光标，不执行（logic 均为单行文本，已确认无换行）
    window.api.pty.write(t.ptyId, text)
    flash(term.id)
  }

  return (
    <div className="dict-view">
      <div className="dict-head">
        {/* 浮动面板自己的头上已经写着「辞典」了，这里再来一遍是两行一样的字 */}
        {!embedded && (
          <>
            <DictIcon size={13} />
            <span className="dict-title">辞典</span>
          </>
        )}
        <span className="dict-count">
          {filtered.length} / {allTerms.length}
          {/* 嵌入时标题被收掉了，光一串数字没有着落，补个单位它才是句话 */}
          {embedded ? ' 条' : ''}
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

      {/* 一级：九个场景。**横着滚不换行** —— 面板只有 320px 宽，九个 chip 铺开要三行，
          再加二级就把词条挤没了。滚动条藏起来，两边用渐隐告诉你还有 */}
      <div className="dict-cats" ref={catsRef}>
        <button
          className={`dict-chip${cat === 'all' ? ' active' : ''}`}
          onClick={() => {
            setCat('all')
            setCat2(null)
          }}
        >
          全部
        </button>
        {CAT1_KEYS.map((k) => (
          <button
            key={k}
            className={`dict-chip${cat === k ? ' active' : ''}`}
            onClick={() => {
              // 再点一次已选中的 → 退回全部。没有这条的话选错了得先找到「全部」
              setCat(cat === k ? 'all' : k)
              setCat2(null)
            }}
          >
            {k}
          </button>
        ))}
        {hasUnsorted && (
          <button
            className={`dict-chip${cat === UNSORTED ? ' active' : ''}`}
            data-tip="还没归类的词条（自建的都在这儿）"
            onClick={() => {
              setCat(cat === UNSORTED ? 'all' : UNSORTED)
              setCat2(null)
            }}
          >
            {UNSORTED}
          </button>
        )}
        {/* 一条自建词条都没有时不显示这个筛子——空筛子只会让人点一下发现什么都没有 */}
        {userTerms.length > 0 && (
          <button
            className={`dict-chip cat-user${onlyUser ? ' active' : ''}`}
            onClick={() => setOnlyUser((v) => !v)}
            data-tip="只看自己加进来的词条"
          >
            自建 {userTerms.length}
          </button>
        )}
      </div>

      {/* 区块：**横切在分类之上的一维筛子**，跟选没选一级无关。
          放在二级上面是因为它常用 —— 「我在做弹层」比「我在找某个具体手法」先发生。
          每个 chip 后面带条数：0 条的格子（表格 / 页脚）如实显示 0 而不是藏起来，
          藏起来的话用户不知道那是「没有」还是「不支持」。 */}
      <div className="dict-cats dict-cats-blk">
        {DICT_BLOCKS.map((b) => {
          const n = allTerms.filter((t) => t.blocks?.includes(b)).length
          const on = blocks.includes(b)
          return (
            <button
              key={b}
              className={`dict-chip blk${on ? ' active' : ''}${n === 0 ? ' empty' : ''}`}
              data-tip={n === 0 ? `还没有归到「${b}」的词条` : `${n} 条能用在${b}`}
              onClick={() => setBlocks((v) => (on ? v.filter((x) => x !== b) : [...v, b]))}
            >
              {b} <span className="dict-chip-n">{n}</span>
            </button>
          )
        })}
        {blocks.length > 0 && (
          <button className="dict-chip clear" onClick={() => setBlocks([])}>
            清除
          </button>
        )}
      </div>

      {/* 二级：只在选了一级之后出现。没选一级时摆 48 个二级出来等于没分类 */}
      {subCats.length > 0 && (
        <div className="dict-cats dict-cats-2" ref={subsRef}>
          {subCats.map((sc) => (
            <button
              key={sc.name}
              className={`dict-chip sub${cat2 === sc.name ? ' active' : ''}`}
              data-tip={sc.desc || undefined}
              onClick={() => setCat2(cat2 === sc.name ? null : sc.name)}
            >
              {sc.name}
            </button>
          ))}
        </div>
      )}

      <DictHookBar />

      <div className="dict-list" onMouseLeave={() => setHover(null)}>
        {filtered.length === 0 && (
          <div className="git-empty">
            {/* 空货架只在「没搜、没筛二级、就是点了这个一级」时才算空货架；
                搜了半天没结果时还说「这格是空的」会答非所问 */}
            {!query && !cat2 && EMPTY_SHELF[cat] ? EMPTY_SHELF[cat] : '没有匹配的词条'}
          </div>
        )}
        {filtered.map(({ item: term, hit, excerpt }) => (
          <button
            key={term.id}
            className={`dict-pill cat-${term.category}${term.user ? ' own' : ''}${flashId === term.id ? ' flash' : ''}${hit === 'logic' || hit === 'prompt' ? ' via-text' : ''}`}
            onMouseEnter={(e) =>
              setHover({ term, anchor: e.currentTarget.getBoundingClientRect(), excerpt })
            }
            // 移开该胶囊就收起预览（不等移出整个列表——停在空白处不该残留浮层）
            onMouseLeave={() => setHover(null)}
            onClick={() => insert(term)}
            // 两条路的说法不一样，别用一句含糊的话盖过去：
            // 有提示词 + 对话框 → 挂成 chip；终端 / 没提示词 → 插纯文本
            data-tip={
              term.prompt
                ? '点一下挂到 AI 对话输入框上；聚焦终端时直接插入提示词全文'
                : '点击插入到最后聚焦的终端或 AI 对话输入框'
            }
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
            {/* 正文命中时先说清「你搜的词在这儿」—— 不然用户看着一个名字对不上的
                词条，只会觉得搜索乱匹配 */}
            {hover.excerpt && <div className="dict-pop-why">{hover.excerpt}</div>}
            <div className="dict-pop-head">
              <span className="dict-zh">{hover.term.zh}</span>
              {/* 极少数情况下 zh 缺失会回落成 en，别把同一个词并排印两遍 */}
              {hover.term.zh !== hover.term.en && <span className="dict-en">{hover.term.en}</span>}
              {/* 归到哪儿。有二级就显示两级，没有（自建词条）才回退到老的三类标签 */}
              <span className={`dict-tag cat-${hover.term.category}`}>
                {hover.term.cat1
                  ? `${hover.term.cat1} › ${hover.term.cat2}`
                  : (CATS[hover.term.category] ?? hover.term.category)}
              </span>
              {hover.term.user && <span className="dict-tag cat-user">自建</span>}
            </div>
            {/* 内联 SVG 走 dangerouslySetInnerHTML，不受 CSP img-src 限制。
                自建词条的 SVG 是模型写的，写盘前已在主进程清洗过（见 main/dict.ts）。
                真没有图的老条目别渲染一个空盒子撑出留白。
                **判据要连 clip 一起判** —— 动效词条只有短片、没有 svg，
                只判 svg 的话它们永远不显示。 */}
            {(!!hover.term.clip || !!hover.term.svg) &&
              (hover.term.clip ? (
                // **短片优先。** 动效词条要回答「它长什么样、怎么动」，手绘 SVG 只能示意；
                // 这些是真组件跑出来的实录，还带模拟指针按触发方式分节演一遍。
                // key 挂 id：换词条时强制换掉 video 元素，否则 React 复用同一个节点、
                // src 变了却还在放上一条的画面。
                <div className="dict-pop-svg">
                  <ClipVideo key={hover.term.id} src={`dict-clip://c/${hover.term.clip}`} />
                </div>
              ) : (
                <div className="dict-pop-svg" dangerouslySetInnerHTML={{ __html: hover.term.svg }} />
              ))}
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
