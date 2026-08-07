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
    // bracketed paste：取中间内容整段入缓冲
    if (data.startsWith('\x1b[200~', i)) {
      const end = data.indexOf('\x1b[201~', i)
      buf += end < 0 ? data.slice(i + 6) : data.slice(i + 6, end)
      i = end < 0 ? data.length : end + 6
      continue
    }
    // 其它转义序列整段跳过，别让残骸进缓冲
    if (ch === '\x1b') {
      const rest = data.slice(i)
      // CSI（方向键、Home/End…）：ESC [ ... 终止字节
      const csi = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(rest)
      if (csi) {
        i += csi[0].length
        continue
      }
      // SS3：ESC O <字符> —— F1–F4、应用光标模式下的方向键
      const ss3 = /^\x1bO[\s\S]/.exec(rest)
      if (ss3) {
        i += ss3[0].length
        continue
      }
      // Meta 前缀（Option/Alt 组合键，本仓库开着 macOptionIsMeta）：ESC + 紧跟的一个字符，
      // 两个字节一起跳过 —— 否则那个字符会落进默认分支被当成普通按键
      if (rest.length > 1) {
        i += 2
        continue
      }
      // 孤立的 ESC（比如单独按一下 Escape，字节还没到齐）：只跳它自己
      i += 1
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
