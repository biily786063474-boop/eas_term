// 斜杠命令候选：**两个输入框共用**（空态那个在 AgentChatView，对话态那个在 ChatToolbar）。
//
// 抽出来的理由很实在：两处各写一遍的话，「哪些命令能用」这件事就有了两个说法，
// 而它是靠实测维护的（见 shared/slashCommands.ts 与 .plans/slash-probe/findings.md）。

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BUILTIN_SLASH,
  matchSlash,
  skillsToCmds,
  slashQuery,
  type SlashCmd
} from '../../../../shared/slashCommands'

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
}

/** 候选的全部状态与键盘逻辑。UI 用 <SlashList>，两者配套但分开 ——
 *  空态和对话态的输入框长得不一样，共用状态、各自摆位置。 */
export function useSlashPicker(
  text: string,
  setText: (v: string) => void,
  onPicked?: () => void
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

  const q = slashQuery(text)
  const hits = q === null ? [] : matchSlash(q, [...BUILTIN_SLASH, ...skills])
  const open = !off && q !== null && hits.length > 0

  // 换了 query 就回到第一条 —— 停在上一次的下标上，看起来像随机选中
  useEffect(() => {
    setIdx(0)
  }, [q])
  // 打字就取消「按过 Esc」，否则关掉一次之后这个节点里再也弹不出来
  useEffect(() => {
    setOff(false)
  }, [text])

  const pick = (i: number): void => {
    const c = hits[i]
    if (!c) return
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

  return { open, hits, idx, handleKey, setIdx, pick }
}

/** 候选列表本体。最多显示 8 条，多的让人接着打字缩小范围。 */
export function SlashList({ hits, idx, setIdx, pick }: SlashPickerState): JSX.Element {
  return (
    <div className="ac-slash" role="listbox" aria-label="斜杠命令">
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
          <span className="ac-slash-name">/{c.name}</span>
          <span className="ac-slash-desc">{c.desc}</span>
          {c.from === 'skill' && <span className="ac-slash-tag">skill</span>}
        </div>
      ))}
      {hits.length > 8 && (
        <div className="ac-slash-more">还有 {hits.length - 8} 个，接着打字缩小范围</div>
      )}
    </div>
  )
}
