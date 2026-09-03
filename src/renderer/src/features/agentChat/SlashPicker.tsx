// 斜杠命令候选：**两个输入框共用**（空态那个在 AgentChatView，对话态那个在 ChatToolbar）。
//
// 抽出来的理由很实在：两处各写一遍的话，「哪些命令能用」这件事就有了两个说法，
// 而它是靠实测维护的（见 shared/slashCommands.ts 与 .plans/slash-probe/findings.md）。

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import {
  BUILTIN_SLASH,
  matchSlash,
  skillsToCmds,
  slashQuery,
  atQuery,
  applyAtPick,
  filesToCmds,
  chipsToCmds,
  type SlashCmd
} from '../../../../shared/slashCommands'
import type { DictChip } from './chips.ts'

/** 已装 skill 的候选。**整个应用只扫一次**：两个输入框、每个 agent 节点都要用，
 *  各扫各的等于开一堆重复 IPC。第一次调用时发起，之后共享同一个 promise。 */
let skillCache: Promise<SlashCmd[]> | null = null
function loadSkillCmds(): Promise<SlashCmd[]> {
  if (!skillCache) {
    skillCache = (async () => {
      const dirs = await window.api.skillLibrary.listDirs().catch(() => [])
      const acc: SlashCmd[] = []
      for (const d of dirs) {
        const r = await window.api.skillLibrary.list(d.path).catch(() => null)
        if (!r?.ok) continue
        acc.push(...skillsToCmds(r.skills, r.disabled))
      }
      return acc
    })().catch(() => [])
  }
  return skillCache
}

export interface SlashPickerState {
  open: boolean
  hits: SlashCmd[]
  idx: number
  /** 在 textarea 的 onKeyDown 里最先调它；返回 true 表示这一下已经被候选消费掉了 */
  handleKey: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
  setIdx: (i: number) => void
  pick: (i: number) => void
  /** 候选浮层贴着谁定位。**必须给** —— 浮层渲染在 body 上（见 SlashList），
   *  没有锚点就不知道该出现在哪个输入框旁边。 */
  anchorRef?: RefObject<HTMLElement | null>
}

/** 候选的全部状态与键盘逻辑。UI 用 <SlashList>，两者配套但分开 ——
 *  空态和对话态的输入框长得不一样，共用状态、各自摆位置。 */
export function useSlashPicker(
  text: string,
  setText: (v: string) => void,
  onPicked?: () => void,
  /** 项目根路径。给了才有 `@` 文件引用 —— 没有它不知道去哪找文件。 */
  cwd?: string,
  /** 浮层贴着哪个元素弹（一般就是那个 textarea） */
  anchorRef?: RefObject<HTMLElement | null>,
  /** 输入框上方预加载着的 chip。**给了才能用 `@` 引用它们。**
   *
   *  2026-09-02 补：`expandChips` 早就认得 `@词条名`，但 `@` 这个键
   *  一直被「引用文件」独占 —— 用户打 `@` 弹出的是文件名，
   *  预加载的 chip 一个都看不见，只能手敲那个 200 字提示词的中文标题。
   *  功能其实在，缺的是入口。 */
  chips?: readonly DictChip[]
): SlashPickerState {
  const [skills, setSkills] = useState<SlashCmd[]>([])
  const [idx, setIdx] = useState(0)
  const [off, setOff] = useState(false)

  useEffect(() => {
    let alive = true
    void loadSkillCmds().then((list) => {
      if (alive) setSkills(list)
    })
    return () => {
      alive = false
    }
  }, [])

  // `@` 文件引用：数据源是**最近改过的文件**，不是全量索引 ——
  // 想引用的多半就是刚动过的那几个，全量索引在大仓库上既慢又会把它们淹掉。
  const [files, setFiles] = useState<SlashCmd[]>([])
  const aq = atQuery(text)
  useEffect(() => {
    // 只在真的打了 `@` 之后才去读盘，别在每个节点挂载时都扫一遍
    if (aq === null || files.length) return
    let alive = true
    void window.api.fs
      .recentFiles(cwd ?? '', 60, false)
      .then((list) => {
        if (alive) setFiles(filesToCmds(list))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [aq, cwd, files.length])

  const q = slashQuery(text)
  // 两者不会同时命中：slash 只认开头且不含空格，@ 只认末尾那一段
  // `@` 的候选 = 预加载的 chip + 最近文件。**chip 排前面**（`FROM_ORDER`）——
  // 那是用户为这条消息专门挂的，排在几十个文件后面等于没有。
  const atPool = useMemo(
    () => [...chipsToCmds(chips ?? []), ...files],
    [chips, files]
  )
  const hits =
    q !== null
      ? matchSlash(q, [...BUILTIN_SLASH, ...skills])
      : aq !== null
        ? matchSlash(aq, atPool)
        : []
  const open = !off && (q !== null || aq !== null) && hits.length > 0

  // 换了 query 就回到第一条 —— 停在上一次的下标上，看起来像随机选中
  useEffect(() => {
    setIdx(0)
  }, [q, aq])
  // 打字就取消「按过 Esc」，否则关掉一次之后这个节点里再也弹不出来
  useEffect(() => {
    setOff(false)
  }, [text])

  const pick = (i: number): void => {
    const c = hits[i]
    if (!c) return
    if (c.from === 'file' || c.from === 'chip') {
      // 只替换末尾那段 `@xxx`，前面写的字一个不动。
      // **chip 插的是 label** —— `expandChips` 正是按它匹配的（契约有测试钉着）。
      setText(applyAtPick(text, c.name))
      onPicked?.()
      return
    }
    // 补到输入框而**不直接发送**：有的命令要带参数（/model opus），
    // 而且直接发出去意味着一次误选就消耗一轮对话。
    // 末尾留空格 → slashQuery 随即返回 null → 候选自然收起。
    setText(`/${c.name} `)
    onPicked?.()
  }

  const handleKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    // **isComposing 要一并判**：中文输入法选词时按上下键是在翻候选词，
    // 抢过来会把人正在选的字弄乱。
    if (!open || e.nativeEvent.isComposing) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((idx + 1) % hits.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((idx - 1 + hits.length) % hits.length)
      return true
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      pick(idx)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOff(true)
      return true
    }
    return false
  }

  return { open, hits, idx, handleKey, setIdx, pick, anchorRef }
}

/** 候选列表本体。最多显示 8 条，多的让人接着打字缩小范围。
 *
 *  **渲染到 body 上、fixed 定位**：原本是 absolute 在输入框容器里，
 *  超出 pane 就被裁掉 —— 画布上节点不高时，列表顶部会被节点头部切掉一半
 *  （用户 2026-08-20 截图：「@和/的窗口应该在 top bar 上面」）。
 *  浮到 body 之后它盖得住节点头部、工具条和画布上的一切。 */
export function SlashList({ hits, idx, setIdx, pick, anchorRef }: SlashPickerState): JSX.Element | null {
  const [pos, setPos] = useState<React.CSSProperties | null>(null)

  // 用 layout effect：要在浏览器绘制之前把位置定好，否则会看到它先在 (0,0) 闪一下
  useLayoutEffect(() => {
    const el = anchorRef?.current
    if (!el) {
      setPos(null)
      return
    }
    const r = el.getBoundingClientRect()
    // **锚点不可见就不要弹。**
    //
    // 浮层渲染在 body 上（portal），已经不受输入框那个容器的 display:none 约束了 ——
    // 画布模式下所有 tab 的所有 leaf 都挂载着、只是隐藏（PaneLayer 的设计），
    // 不判这一下的话，隐藏节点里那个还留着 `@` 的输入框会把自己的候选浮到屏幕上，
    // 用户看到的是一个不知道从哪冒出来、点了也没用的列表（2026-08-20 验证时
    // 一次看到两个列表叠着，就是这么来的）。
    //
    // 两条都要判：尺寸为 0 = 容器被隐藏；完全在视口外 = 那个节点被滚走了。
    const hidden = r.width < 10 || r.height < 5
    const offscreen = r.bottom < 0 || r.top > window.innerHeight
    if (hidden || offscreen) {
      setPos(null)
      return
    }
    const rows = Math.min(hits.length, 8)
    // 一行约 30px，加上「还有 N 个」那行和内边距
    const wanted = rows * 30 + (hits.length > 8 ? 24 : 0) + 10
    const above = r.top - 10
    const below = window.innerHeight - r.bottom - 10
    // **优先往上弹**：输入框基本都在底部，往下弹多半会顶出屏幕。
    // 上面实在放不下（比下面还窄）才往下。
    const up = above >= Math.min(wanted, MAX_H) || above > below
    const room = up ? above : below
    setPos({
      position: 'fixed',
      // 贴着输入框左边，但不许溢出屏幕
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(240, r.width) - 8)),
      width: Math.max(240, r.width),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      maxHeight: Math.max(90, Math.min(MAX_H, wanted, room))
    })
  }, [anchorRef, hits.length])

  if (!pos) return null

  return createPortal(
    <div className="ac-slash" style={pos} role="listbox" aria-label="命令与文件候选">
      {hits.slice(0, 8).map((c, i) => (
        <div
          key={`${c.from}:${c.name}`}
          className={`ac-slash-row${i === idx ? ' on' : ''}`}
          role="option"
          aria-selected={i === idx}
          // 用 mousedown 不用 click：click 之前 textarea 已经失焦，
          // 候选会先被别的逻辑收起来，那一下就点空了
          onMouseDown={(ev) => {
            ev.preventDefault()
            pick(i)
          }}
          onMouseEnter={() => setIdx(i)}
        >
          <span className="ac-slash-name">
            {c.from === 'file' || c.from === 'chip' ? '@' : '/'}
            {c.name}
          </span>
          <span className="ac-slash-desc">{c.desc}</span>
          {c.from === 'skill' && <span className="ac-slash-tag">skill</span>}
        </div>
      ))}
      {hits.length > 8 && (
        <div className="ac-slash-more">还有 {hits.length - 8} 个，接着打字缩小范围</div>
      )}
    </div>,
    document.body
  )
}

/** 浮层最高多少。再高就把画布挡掉大半，反而不好用 */
const MAX_H = 244
