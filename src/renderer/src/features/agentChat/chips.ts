// 辞典 chip：输入框上方那一行「这条消息要带的提示词」。
//
// 为什么要有它：辞典里一条词条的提示词有 200–350 字。直接塞进输入框，
// 用户自己打的那句话被淹没在里面，也没法再撤掉。所以输入框里只放一个名字，
// **发送的一刻才展开成全文**——用户看到的是「防抖」，模型收到的是整条指令。
//
// 终端那条路不走 chip：终端是一条字节流，没有 DOM，插进去的只能是纯文本
// （见 DictView.insert）。那边本来也就是「把提示词交给命令行 agent」，全文反而是对的。
export type DictChip = {
  /** 词条 id，用来去重 */
  id: string
  /** 输入框上显示的名字（词条中文名） */
  label: string
  /** 发送时真正展开出去的完整提示词 */
  text: string
}

/** 分隔用户自己打的字和展开的提示词。模型看到这条线就知道下面是附加指令，
 *  不是用户说的话 —— 不加分隔的话两段会黏成一句读不通的话。 */
const SEP = '\n\n---\n'

/** 一次展开的结果。**`usedIds` 是给界面用的** —— 有了它，
 *  chip 行才能把「这条会发」和「这条只是备着」显示成两种样子。
 *  不给的话用户没法知道自己预加载的东西这次到底发没发出去，
 *  而「东西静默地没发出去」是最难自查的一类问题。 */
export interface ExpandedChips {
  /** 真正发给模型的正文 */
  text: string
  /** 这次**实际用到**的 chip id（去重、按出现顺序） */
  usedIds: string[]
}

/** 用户打的字里，`@名字` 就是一次引用。
 *
 *  **不用正则去「找 @ 后面的词」**：chip 的名字是中文词条名，可能带空格、
 *  标点、甚至本身含 `@`，靠分词切出来的边界必然对不齐。
 *  改成拿现有的名字去**逐个试匹配**，并且**长名字优先** ——
 *  否则「@代码规范」会被「@代码」截胡，用户看到的是一段风马牛不相及的提示词。
 *
 *  邮箱那种 `a@b.com` 不会被误伤：`@` 前面紧挨着字母数字时不算引用，
 *  引用要么在开头、要么前面是空白或标点。 */
function refStart(text: string, i: number): boolean {
  if (i === 0) return true
  return !/[\w\u4e00-\u9fa5]/.test(text[i - 1])
}

/**
 * 把输入框里的文字和挂着的 chip 合成真正发出去的内容。
 *
 * ── 2026-09-02 改了规矩 ────────────────────────────────────────────────────
 * 原来是**全部挂着的 chip 一股脑拼在末尾**（一条 `---` 之后）。用户改成：
 * 「在正文中通过艾特引用已经预加载的 chip，发送时只发被引用的，
 * 并根据引用的位置进行拼接。」
 *
 * 所以：**预加载只是「让它可被 @」，发不发、发在哪，由正文里的 @ 决定。**
 * 提示词于是能出现在句子中间（「按 @文案风格 改写下面这段」），
 * 而不是永远吊在末尾。
 *
 * **一个都没 @ 时退回旧行为**（末尾拼全部）：用户点辞典条目、直接打字发送
 * 这条老路子还在，静默什么都不发是最难自查的一种「东西不见了」。
 *
 * 只有空文本没有 chip 时才返回空串 —— 调用方拿它判断「能不能发」，
 * 所以**挂了 chip 没打字也必须能发**（用户就想让模型照着这条提示词做）。
 */
export function expandChips(text: string, chips: readonly DictChip[]): ExpandedChips {
  const body = text.trim()

  // 长名字优先：`@代码规范` 不能被 `@代码` 截胡
  const byLen = [...chips].sort((a, b) => b.label.length - a.label.length)
  const used: string[] = []
  let out = ''
  let i = 0
  while (i < body.length) {
    if (body[i] === '@' && refStart(body, i)) {
      const hit = byLen.find((c) => body.startsWith(c.label, i + 1))
      if (hit) {
        out += hit.text.trim()
        if (!used.includes(hit.id)) used.push(hit.id)
        i += 1 + hit.label.length
        continue
      }
    }
    out += body[i]
    i += 1
  }

  if (used.length > 0) return { text: out, usedIds: used }

  // 兜底：一个都没引用 → 老行为，末尾拼全部
  const prompts = chips.map((c) => c.text.trim()).filter(Boolean)
  if (!prompts.length) return { text: body, usedIds: [] }
  const joined = prompts.join('\n\n')
  return { text: body ? body + SEP + joined : joined, usedIds: chips.map((c) => c.id) }
}

/**
 * 加一个 chip。**同一个词条只挂一次** —— 重复点同一条时不该攒出两份相同的提示词，
 * 那既浪费上下文又会让模型以为要做两遍。
 *
 * 返回新数组；已存在时返回原数组本身，调用方可以据此跳过一次 setState。
 */
export function addChip(chips: readonly DictChip[], chip: DictChip): DictChip[] {
  if (chips.some((c) => c.id === chip.id)) return chips as DictChip[]
  return [...chips, chip]
}

export function dropChip(chips: readonly DictChip[], id: string): DictChip[] {
  return chips.filter((c) => c.id !== id)
}
