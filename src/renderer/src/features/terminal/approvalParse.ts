// 从终端屏幕上认出「正在等你审批」的那个框，并抽出可点的选项。
//
// 这是全项目最脆的一段代码，因为它读的是**画给人看的 TUI**，不是结构化事件。
// claude / codex 哪天改个边框样式它就瞎了。所以两条原则贯穿始终：
//
//   1. **宁可认不出，绝不认错。** 任何一处不满足就返回 null，调用方退回「只通知」。
//      认不出的代价是用户多点一下跳回终端；认错的代价是替用户按下了他没看清的确认。
//   2. **按序号写回，不按语义猜。** 我们把「1」写回去，是因为屏幕上那行写着 1，
//      不是因为我们看懂了它是「允许」。文案是给人读的，序号才是给机器用的。
//
// 纯函数、无依赖，可以直接喂字符串数组测试（tools/approval-check.mjs 有真实样本）。

export interface ApprovalOption {
  /** 屏幕上的序号，写回 pty 用的就是它 */
  index: number
  /** 去掉序号和框线后的选项文案，只用于显示 */
  label: string
}

export interface ApprovalInfo {
  /** 问句，如「Do you want to proceed?」 */
  question: string
  /** 问句上方的正文——通常是待执行的命令或待改动的文件 */
  body: string
  options: ApprovalOption[]
  /** 命中危险模式：灵动岛不给直通按钮，强制跳回终端 */
  dangerous: boolean
}

/** 只扫末尾这么多行。要够装下一整个审批框（框可能比终端还高、上半截在 scrollback 里），
 *  又不能太多——扫得越远，越可能把更早的无关编号列表卷进来。 */
const SCAN_LINES = 40

/** 框线与列表指示符：box-drawing (U+2500–U+257F) + 常见箭头 */
const CHROME = /[─-╿•❯▶►>»]/g

/**
 * 认危险命令。命中就禁掉灵动岛上的直通按钮——
 * 卡片只有一行宽，`rm -rf node_modules` 和 `rm -rf ~/Documents` 截断后可能长得一样，
 * 这种命令必须让用户回到终端，把完整上下文看清楚再决定。
 */
const DANGER = [
  /\brm\s+-[a-zA-Z]*[rf]/, // rm -rf / rm -fr / rm -r
  /\bsudo\b/,
  /\bdoas\b/,
  /curl[^|]*\|\s*(ba|z|fi)?sh/, // curl … | sh
  /wget[^|]*\|\s*(ba|z|fi)?sh/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+if=/,
  /\bchmod\s+-R\s+777\b/,
  /\bgit\s+push\b[^\n]*--force/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdrop\s+(table|database)\b/i,
  /\bshutdown\b|\breboot\b/,
  /:\(\)\s*\{.*\}\s*;\s*:/ // fork bomb
]

export function isDangerous(text: string): boolean {
  return DANGER.some((re) => re.test(text))
}

/** 去掉框线、指示符和首尾空白 */
function strip(line: string): string {
  return line.replace(CHROME, ' ').replace(/\s+/g, ' ').trim()
}

/** 一行是不是「<序号>. <文案>」。序号后可以是 . 、 ) 或中文顿号 */
function matchOption(line: string): ApprovalOption | null {
  const m = /^(\d{1,2})\s*[.、)]\s*(.+)$/.exec(strip(line))
  if (!m) return null
  const label = m[2].trim()
  if (!label) return null
  return { index: Number(m[1]), label }
}

/** 像不像一句在问你的话 */
function looksLikeQuestion(s: string): boolean {
  if (!s) return false
  if (/[?？]\s*$/.test(s)) return true
  return /\b(do you want|would you like|proceed\?|allow|approve|confirm)\b/i.test(s) ||
    /(是否|要不要|确认|允许|继续吗)/.test(s)
}

/**
 * 从屏幕行里认审批框。认不出返回 null。
 *
 * @param lines 屏幕内容，按显示顺序（最后一行是最新的）
 */
export function parseApproval(lines: string[]): ApprovalInfo | null {
  // 先扔掉末尾的空行，再往回数 SCAN_LINES。
  //
  // **这一步不能省。** 传进来的是整个可见区（term.rows 行），而终端内容不满一屏时
  // 光标下方全是空行。直接 slice(-24) 的话，那 24 行可能大半是空的，
  // 框被挤出扫描范围——表现为「同一个框，有时认得出有时认不出」，
  // 取决于当时屏幕上有多少历史输出。实测踩到过。
  const trimmed = lines.map(strip)
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop()
  const tail = trimmed.slice(-SCAN_LINES)

  // 从后往前收集连续的编号选项。中间允许夹空行（框里选项之间常有空隙），
  // 但一旦遇到有内容且不是选项的行就停——那是选项区的上边界。
  const opts: ApprovalOption[] = []
  let i = tail.length - 1
  let sawOption = false
  for (; i >= 0; i--) {
    const line = tail[i]
    if (!line) {
      if (sawOption) continue // 选项之间的空行
      continue // 框底部到最后一行之间的空行
    }
    const opt = matchOption(line)
    if (opt) {
      opts.unshift(opt)
      sawOption = true
      continue
    }
    if (sawOption) break // 选项区结束，i 停在选项上面那行
  }

  // 少于两个选项不算审批框：一个「1. Yes」孤零零出现，更可能是 agent 在列步骤。
  if (opts.length < 2) return null

  // 序号必须从 1 开始且连续。跳号说明我们把不相干的编号列表（比如 agent 输出的
  // 「1. 改了 A  2. 改了 B」加上别处的「5.」）拼在了一起。
  if (opts[0].index !== 1) return null
  for (let k = 1; k < opts.length; k++) {
    if (opts[k].index !== opts[k - 1].index + 1) return null
  }

  // 选项上方找问句（最多回看 4 行，再远就不是这个框的了）
  let question = ''
  let qAt = -1
  for (let k = i; k >= 0 && k > i - 4; k--) {
    if (!tail[k]) continue
    if (looksLikeQuestion(tail[k])) {
      question = tail[k]
      qAt = k
      break
    }
  }
  if (!question) return null

  // 问句上方的连续非空行作为正文（待执行的命令 / 待改的文件），最多 3 行
  const bodyLines: string[] = []
  for (let k = qAt - 1; k >= 0 && bodyLines.length < 3; k--) {
    if (!tail[k]) {
      if (bodyLines.length) break // 空行 = 正文段落结束
      continue
    }
    bodyLines.unshift(tail[k])
  }
  const body = bodyLines.join(' ')

  return {
    question,
    body,
    options: opts,
    // 整个框的文字都参与危险判定：命令可能出现在正文里，也可能就写在选项文案里
    dangerous: isDangerous([body, question, ...opts.map((o) => o.label)].join('\n'))
  }
}
