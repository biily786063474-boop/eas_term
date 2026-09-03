// 从 agent 的回答里认出「它在问你选哪个」，把那几行变成可点的选项。
//
// **纯函数，可单测。** 这一层全是判断，而判断错了的表现很隐蔽
// （多出几个不该有的按钮 / 该有的按钮没出现），必须能拿真语料回归。
//
// ── 为什么不靠 CLI 的结构化工具 ────────────────────────────────────
// Claude Code 确实有 `AskUserQuestion`（用户 transcript 里 51 次，schema 完整），
// **但它在 app 的会话模式下不可用** —— 翻遍 20 份 agent-history、几千次工具调用，
// 它一次都没出现过；那唯一一条相关记录是 ToolSearch 去找它，返回
// "No matching deferred tools found"。Codex 那边连对应机制都没有
// （记录里只有 apply_patch / exec_command / MCP 工具）。
//
// 也就是说：**两个 CLI 都只会把选项写进正文**。所以这里只能认文本。
//
// ── 判据是怎么定的（拿真语料量出来的，不是拍脑袋）──────────────────
// 本机 agent-history 里 637 条 assistant 正文：
//   · 结尾是 2-6 项列表的只有 4 条（0.6%）
//   · 其中**真的在问你选哪个**的只有 1 条
// 也就是说光看结构，误判率 3/4。那 4 条的**引导句**却分得很干净：
//   ✅ 「👉 **建议下一步**（推荐第一个）」
//   ❌ 「两个新问题，一个是真 bug、一个是我的测试没写对：」
//   ❌ 「現在的状态：」
//   ❌ 「**疑虑**（详见 …）：」
// 前者在征求意见，后三者在陈述。所以**结构和引导句两条必须同时成立**。
//
// ── 误判的代价被压到接近零 ─────────────────────────────────────────
// 选项是**加在正文下面**的，不替换、不折叠任何内容（见 MessageList）。
// 认错了 = 多几个可以无视的按钮；认漏了 = 跟现在一样。
// 两边都不会让人看不到本来能看到的东西 —— 这是敢用启发式的前提。

/** 一条选项。detail 是「——」后面那段解释，没有就没有。 */
export interface ChatOption {
  /** 点了之后填进输入框的那句话 */
  label: string
  /** 附带的解释，界面上小字显示 */
  detail?: string
}

export interface ChatOptions {
  /** 引导句，界面上作为这组选项的标题 */
  lead: string
  options: ChatOption[]
}

/** 列表标记：数字（1. 1、 1)）、圆点（- * ·）、字母（A. A、 A)）。
 *  分三族是为了「同一组必须用同一族」—— 混着用的多半不是一组并列选项。 */
const MARKERS: { re: RegExp; family: string }[] = [
  // 句点和右括号后面**必须有空格**：不然 `1.5 倍速` 会被当成「标记 1. + 文本 5 倍速」。
  // 顿号后面**可以没有空格**（中文里 `1、甲` 是常态，而顿号从不当小数点用）。
  { re: /^[ \t]*(\d{1,2})(?:[.)]\s+|、\s*)(\S.*)$/, family: 'num' },
  { re: /^[ \t]*[-*·]\s+(\S.*)$/, family: 'dot' },
  { re: /^[ \t]*([A-Da-d])(?:[.)]\s+|、\s*)(\S.*)$/, family: 'alpha' }
]

/** 引导句里出现这些，才认为它在征求意见而不是在陈述。
 *
 *  **这张表宁可短。** 多收一个词的代价是把「陈述句 + 列表」也变成按钮，
 *  而那正是上面量到的 3/4 误判的来源。漏了的话最多是没按钮，跟现在一样。 */
const ASKING = [
  '?',
  '？',
  '你选',
  '选哪',
  '哪一个',
  '哪个',
  '哪种',
  '要不要',
  // 「还是」**不在这张强表里** —— 它是两面词，见下面的 ASKING_WEAK。
  '建议下一步',
  '下一步建议',
  '怎么办',
  '推荐',
  '你定',
  '你说了算',
  '我倾向',
  '二选一',
  '三选一',
  // ↓ 2026-09-02 从本机 27 份 agent-history、**748 条 assistant 正文**里量出来补的。
  //   补之前整份语料**一条都认不出**（0/748）—— 这个功能实际上是死的，
  //   用户看到的就是「选项卡没法点」，因为按钮从来没出现过。
  '拍板', // 「两个问题要你拍板：」
  '先确认', // 「**先确认两件事再动手：**」
  '问你', // 「### 问你两件事」
  '你来定'
]

/** 弱信号：**只在短引导句里才算**。
 *
 *  `还是` 是个两面词：「先做甲还是先做乙」是选择，
 *  「产出还是那两份」是「仍然」。真语料里后者害我误判过一条
 *  （748 条里唯一的假阳性，就是它）。
 *
 *  分界用**引导句长度**而不是词法：真在问你选哪个的那句话都短，
 *  而误判那条是 40+ 字的陈述句收尾。24 字这个数是对着语料量的
 *  （真例最长 30 字那条另有 `你定` 命中，不靠这条弱信号）。 */
const ASKING_WEAK = ['还是']
const WEAK_LEAD_MAX = 24

/** 列表后面还能跟多少收尾话。**放宽这两个数之前先拿语料跑一遍** ——
 *  它们直接决定误判率，而误判现在是有代价的（点一下就发出去了）。 */
const TAIL_MAX_LINES = 2
const TAIL_MAX_CHARS = 160

/** 去掉 markdown 的粗体/行内码记号 —— 按钮上不该出现 `**` 和反引号 */
const plain = (s: string): string =>
  s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()

/** 把一条列表项拆成「短标签 + 解释」。
 *  真语料里的形状是 `**补跑 T8 复审，然后直接做 T9 + T10** —— 跑完你就能…`，
 *  破折号前是选择本身，后面是理由。没有破折号就整条当标签。 */
function splitItem(raw: string): ChatOption {
  const t = plain(raw)
  const m = t.match(/^(.{2,60}?)\s*(?:——|——|—|--)\s*(.+)$/)
  if (m) return { label: m[1].trim(), detail: m[2].trim() }
  return { label: t }
}

/**
 * 认不认得出选项。认不出返回 null（**绝大多数消息都该返回 null**）。
 *
 * 五条判据，全部成立才算：
 *   ① 正文结尾是一段连续列表，**后面最多再跟一小段收尾话**
 *      （≤2 行且 ≤160 字，见 TAIL_* ）。
 *
 *      「必须一个字都不剩」曾经是这里的写法，**而它把这个功能整个废掉了**：
 *      2026-09-02 拿本机 27 份 agent-history、748 条 assistant 正文实测，
 *      `optionsOf` 认出 **0 条** —— 用户看到的「选项卡没法点」，
 *      根因是按钮从来没出现过。真语料里选项后面几乎总要再说一句
 *      （「你说一声我就开始」「来源：…」），**连本文件开头举的那个
 *      ✅ 正例（「建议下一步（推荐第 1 条）」）都栽在这一条上。**
 *      放宽之后同一份语料 8 命中 / 0 误判（每条都人工判过，测试里钉着）。
 *   ② 2-6 项（1 项不是选择；超过 6 项是清单不是选项）
 *   ③ 同一族标记（混着 `-` 和 `1.` 多半不是一组并列项）
 *   ④ 列表前面有一句**征求意见**的引导句（见 ASKING 的说明）
 *   ⑤ 每项首行不超过 120 字（选项是短的；长段落是论述）
 */
export function optionsOf(text: string): ChatOptions | null {
  const body = (text ?? '').replace(/\s+$/, '')
  if (!body) return null
  const lines = body.split('\n')

  // ① 先找到**最后一个**列表行；它后面允许再有一小段收尾话。
  let last = -1
  for (let k = lines.length - 1; k >= 0; k--) {
    if (MARKERS.some((m) => m.re.test(lines[k]))) {
      last = k
      break
    }
  }
  if (last < 0) return null
  const tail = lines.slice(last + 1).filter((l) => l.trim())
  // 收尾话要短：长了说明列表只是段落中间的插叙，这段话的落点在别处。
  if (tail.length > TAIL_MAX_LINES) return null
  if (tail.join('').length > TAIL_MAX_CHARS) return null

  // 从最后一个列表行往上收连续的列表行
  const items: string[] = []
  let family: string | null = null
  let i = last
  for (; i >= 0; i--) {
    const ln = lines[i]
    if (!ln.trim()) {
      // 列表里夹一个空行还算同一组；列表还没开始就遇到空行则继续往上找
      if (items.length) break
      continue
    }
    let matched: { text: string; family: string } | null = null
    for (const m of MARKERS) {
      const r = ln.match(m.re)
      if (r) {
        matched = { text: r[r.length - 1], family: m.family }
        break
      }
    }
    if (!matched) break
    // ③ 同一族
    if (family && matched.family !== family) break
    family = matched.family
    items.push(matched.text)
  }
  items.reverse()

  // ② 条数
  if (items.length < 2 || items.length > 6) return null
  // ⑤ 每项不能太长
  if (items.some((t) => t.length > 120)) return null

  // ④ 引导句：列表往上第一条非空行
  let lead = ''
  for (; i >= 0; i--) {
    if (lines[i].trim()) {
      lead = lines[i].trim()
      break
    }
  }
  if (!lead) return null
  const asks =
    ASKING.some((k) => lead.includes(k)) ||
    (lead.length <= WEAK_LEAD_MAX && ASKING_WEAK.some((k) => lead.includes(k)))
  if (!asks) return null

  const options = items.map(splitItem).filter((o) => o.label.length > 0)
  // 去重：同样的标签出现两次说明解析错了，不是两个选项
  const seen = new Set<string>()
  for (const o of options) {
    if (seen.has(o.label)) return null
    seen.add(o.label)
  }
  if (options.length < 2) return null

  return { lead: plain(lead), options }
}
