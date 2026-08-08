// 甘特图的采集：把「用户发出去的文本」和「agent 跑起来/停下」两件事对上。
//
// 为什么放渲染层而不是主进程的 pty:write（那才是输入的唯一汇合点）：
// 「agent 在不在跑」是 TerminalView 靠 spinner 判定的，主进程拿不到这个信号，
// 跨进程同步只会多一层竞态。而两条输入路径在渲染层同样齐全 ——
// term.onData 就是键盘输入写进 PTY 的唯一出口。
import type { GanttTask } from '../../../../shared/types'

/** 候选产出后等多久必须等到 agent 跑起来。不做成设置项 —— 多一个旋钮不会让它更准。 */
const PENDING_TTL_MS = 3000

/** 每个 pty 一份键盘缓冲 */
const keyBuf = new Map<string, string>()
/** 每个 pty 挂起的候选文本（等 running 确认） */
const pending = new Map<string, { text: string; at: number }>()
/** 每个 pty 当前那条还没结束的记录 id */
const active = new Map<string, string>()

/**
 * 从 data[i]（必须是 ESC，0x1b）算起，这一段转义序列一共多长，用来整段跳过。
 *
 * 设计取舍：term.onData 的语义是「要写给 PTY 的字节」，不等于「用户敲的字符」——
 * 除了键盘输入，鼠标追踪报告（SGR/X10/urxvt 等格式）、焦点事件报告、终端对 DA/DSR/CPR/
 * OSC 颜色查询等的自动回复，都会从这里过。这些序列的具体形式五花八门，逐一枚举「认识哪些」
 * 的做法（比如原来 CSI 正则的参数字符类漏了 `<`，SGR 鼠标序列 `ESC[<35;22;13M` 就被
 * 漏判成普通文本）注定按下葫芦浮起瓢。所以反过来：不枚举"要跳过什么"，只要是 ESC 开头，
 * 不管认不认识具体是哪种序列，一律整段跳过；只有明确不是转义序列的可打印字符才有资格
 * 进入用户输入缓冲。跳过的具体字节数仍然要按 ECMA-48 的转义序列语法算准，算错了一样会
 * 漏字节或吞错字节，不是「不管」而是「不用管每种序列的语义，但要管它有多长」。
 *
 * 四条分支覆盖 ECMA-48 定义的转义序列大类：
 *   1. 字符串型（OSC ']' / DCS 'P' / SOS 'X' / PM '^' / APC '_'）：BEL 或 ST(ESC \) 收尾，
 *      长度不固定（比如 OSC 颜色查询的自动回复）。
 *   2. CSI（'['）：参数字节(0x30-0x3F)* 中间字节(0x20-0x2F)* 结束字节(0x40-0x7E)——ECMA-48 §5.4。
 *      这一类涵盖方向键/Home/End、焦点报告 ESC[I/ESC[O、DA/DSR/CPR 自动回复，以及 SGR 和
 *      urxvt 两种鼠标追踪格式（它们的坐标就是普通的数字+分号参数字节，跟其他 CSI 没有区别）。
 *      唯独 X10 鼠标格式是例外——ESC[M 后固定跟 3 个原始字节（按钮/列/行各自 +32 编码，
 *      值可以是任何字节，不是参数语法），常规扫描一碰到它们里偶然落在结束字节区间
 *      （0x40-0x7E）的字节就会提前收尾，把剩下的原始字节露出去被当成文字处理，所以单独摘出来
 *      长度写死 6。
 *   3. SS2/SS3（'N'/'O'）：单一字符移位，协议定义上就是「介绍符后面恰好跟 1 个字符」，不需要
 *      关心那个字符具体是什么——F1-F4、应用光标模式下的方向键/Home/End 都落在这一类
 *      （xterm.js 实际只发 A-D/F/H/P-S 这几种，但没必要在这里再维护一份等价的枚举，
 *      协议本身没有把可能的第三字节限定在这个集合里）。
 *   4. 其余（主要是 Meta/Option 前缀，本仓库开着 macOptionIsMeta）：ESC + 紧跟的 1 个字符，
 *      跟原来的处理方式一致——这一类没有可靠信源会产生比 2 字节更长的独立转义序列
 *      （字符集切换这种带中间字节的形式是终端「输出方向」的功能，不会出现在这条「输入方向」
 *      的 onData 里），保持最简单的假设，不为假想的输入自找过度解析的风险。
 *
 * 序列还没收全（比如恰好卡在 onData 的分片边界上）就把手上能读到的全吃掉，宁可丢一小段
 * 转义残片，也不能放它当正文——跟原来处理「孤立 ESC」的取舍一致，只是把这个取舍从
 * 「仅覆盖孤立 ESC」推广到「覆盖任何读不全的转义序列」。
 */
function escapeLength(data: string, i: number): number {
  const c1 = data[i + 1]
  if (c1 === undefined) return 1 // 孤立 ESC，下一字节还没到，先跳它自己

  // 字符串型：OSC(]) DCS(P) SOS(X) PM(^) APC(_)，靠 BEL 或 ST(ESC \) 收尾
  if (c1 === ']' || c1 === 'P' || c1 === 'X' || c1 === '^' || c1 === '_') {
    for (let j = i + 2; j < data.length; j++) {
      if (data[j] === '\x07') return j - i + 1 // BEL
      if (data[j] === '\x1b' && data[j + 1] === '\\') return j - i + 2 // ST
    }
    return data.length - i // 这一片里没等到收尾字节，先把能读到的全吃掉
  }

  // CSI：见上面分支 2 的注释
  if (c1 === '[') {
    if (data[i + 2] === 'M') return Math.min(6, data.length - i) // X10 鼠标：固定 6 字节
    let j = i + 2
    while (j < data.length && data[j] >= '0' && data[j] <= '?') j++ // 参数字节
    while (j < data.length && data[j] >= ' ' && data[j] <= '/') j++ // 中间字节
    return j < data.length && data[j] >= '@' && data[j] <= '~' ? j - i + 1 : j - i
  }

  // SS2/SS3：见上面分支 3 的注释
  if (c1 === 'N' || c1 === 'O') {
    return data[i + 2] === undefined ? 2 : 3
  }

  // 其余：见上面分支 4 的注释
  return 2
}

/** 输入框提交：整段文本直接就是一条候选 */
export function noteSubmitted(ptyId: string, text: string): void {
  const t = text.trim()
  if (t) pending.set(ptyId, { text: t, at: Date.now() })
}

/**
 * 键盘输入：还原成「一条输入」。
 *
 * 准确性边界（有意不追）：TUI 有自己的行编辑和历史。按 ↑ 调出上一条命令时，
 * 画面上的内容不来自这个缓冲，产出的候选会和实际发出的不符；Tab 补全同理。
 * 追平意味着重新实现一遍各家 TUI 的编辑器，而且随它们改版失效。
 * **时间轴不受影响** —— 起止取自 setPtyRunning，与文本采集无关。
 */
export function feedKeystroke(ptyId: string, data: string): void {
  let buf = keyBuf.get(ptyId) ?? ''
  let i = 0
  while (i < data.length) {
    const ch = data[i]
    // bracketed paste：取中间内容整段入缓冲，原样保留——哪怕里面长得像转义序列或控制字符，
    // 用户是真的粘贴了这些字节，不能再按下面那条「ESC 一律跳过」的规则处理一遍
    if (data.startsWith('\x1b[200~', i)) {
      const end = data.indexOf('\x1b[201~', i)
      buf += end < 0 ? data.slice(i + 6) : data.slice(i + 6, end)
      i = end < 0 ? data.length : end + 6
      continue
    }
    // 只有明确认得出是「用户敲的可打印字符」才有资格进缓冲——反过来，任何 ESC 开头的东西，
    // 不管认不认识具体是哪种转义序列，一律整段跳过，不留残骸给下面的分支当成正文吃进去。
    // 具体跳多少字节见 escapeLength 顶部的注释。
    if (ch === '\x1b') {
      i += escapeLength(data, i)
      continue
    }
    if (ch === '\r' || ch === '\n') {
      const t = buf.trim()
      if (t) pending.set(ptyId, { text: t, at: Date.now() })
      buf = ''
      i++
      continue
    }
    if (ch === '\x7f' || ch === '\b') {
      buf = buf.slice(0, -1)
      i++
      continue
    }
    // 其余控制字符不入缓冲（Ctrl-C 之类）
    if (ch < ' ') {
      i++
      continue
    }
    buf += ch
    i++
  }
  keyBuf.set(ptyId, buf)
}

/** spinner 起落。running=true 时把挂起的候选转成一条记录；false 时收尾。 */
export function noteRunning(
  ptyId: string,
  running: boolean,
  ctx: { projectId: string; leafId: string }
): void {
  if (running) {
    const p = pending.get(ptyId)
    pending.delete(ptyId)
    // 没有候选，或候选早就过期了（说明这次跑起来跟用户刚才敲的没关系）→ 不记
    if (!p || Date.now() - p.at > PENDING_TTL_MS) return
    if (!ctx.projectId) return // 不属于任何项目的终端不进甘特图
    const task: GanttTask = {
      id: 'gt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      projectId: ctx.projectId,
      ptyId,
      leafId: ctx.leafId,
      prompt: p.text,
      startAt: Date.now(),
      endAt: null
    }
    active.set(ptyId, task.id)
    void window.api.gantt.push(task)
    return
  }
  const id = active.get(ptyId)
  active.delete(ptyId)
  if (id) void window.api.gantt.finish(id, Date.now())
}

/**
 * pty 彻底关闭时调用，清空这个 ptyId 名下的全部内存态。
 *
 * ptyId 由主进程 nextId++ 生成、同一会话内终身不复用 —— 不清理的话，每关一个
 * 终端就在这三个模块级 Map 里留一份死条目（要么是没等到 spinner 的 pending，
 * 要么是没按回车的半行 keyBuf），随开关终端次数无界增长，直到渲染进程重启。
 * 正常运行时 noteRunning(false, …) 已经会删 active，这里连 pending/keyBuf 一起兜底。
 */
export function forgetPty(ptyId: string): void {
  keyBuf.delete(ptyId)
  pending.delete(ptyId)
  active.delete(ptyId)
}

/**
 * agent 正在跑时又发一条（补充指令、排队）。
 * 这时不会有新的 false→true 转换，按上面的规则会被超时丢掉，而边跑边补是常态。
 * 附加到当前那条记录上，不为它单开一根条 —— 它没有自己的起止，
 * 硬拆只会让图上多出一堆零长度的条。
 */
export function drainFollow(ptyId: string): void {
  const id = active.get(ptyId)
  if (!id) return
  const p = pending.get(ptyId)
  if (!p) return
  pending.delete(ptyId)
  void window.api.gantt.follow(id, p.text)
}
