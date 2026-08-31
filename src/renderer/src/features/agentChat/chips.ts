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

/**
 * 把输入框里的文字和挂着的 chip 合成真正发出去的内容。
 *
 * 只有空文本没有 chip 时才返回空串 —— 调用方拿它判断「能不能发」，
 * 所以**挂了 chip 没打字也必须能发**（用户就想让模型照着这条提示词做）。
 */
export function expandChips(text: string, chips: readonly DictChip[]): string {
  const body = text.trim()
  const prompts = chips.map((c) => c.text.trim()).filter(Boolean)
  if (!prompts.length) return body
  const joined = prompts.join('\n\n')
  return body ? body + SEP + joined : joined
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
