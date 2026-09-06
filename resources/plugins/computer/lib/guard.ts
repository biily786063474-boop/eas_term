// **动作前的拒绝名单**。纯函数，有测试。
//
// 挡三类（设计稿 §二 C1 C2 与 §三 决定 7 10）：
//   ① 点 Eas-Term 自己 —— 模型能点到「清空画布」「删除项目」，甚至点开另一个对话去发指令。自噬。
//   ② 点笔纵画板 —— 会点会打字就能操作它去生图，绕开「生图只走 bizone-canvas / lovart」这条红线
//      （那条红线的意思是**由 Claude Code 直接跑那两条路**，不是「用鼠标去戳画板界面」）。
//   ③ 破坏性组合键 —— cmd+Q 关掉正在跑的东西、cmd+W 关窗口、cmd+Delete 删文件。
//      模型点错一次不可撤销（§二 A4：文件有 git 兜底，鼠标没有）。

export interface Target {
  bundleId?: string
  title?: string
}

/** 永远不许操作的 App。**不给配置项关掉** —— 这两条是红线不是偏好。 */
export const NEVER_TOUCH = [
  { bundleId: 'com.biily.easterm', why: '这是 Eas-Term 自己：让模型点自己的界面会绕开所有确认（清空画布、删项目、替你发消息）' },
  { bundleId: 'com.bizone.canvas', why: '这是笔纵画板：生图只能由 AI 直接调它的工具，不许用鼠标去戳它的界面（那会绕开生图路径的约定）' }
] as const

/** 破坏性组合键。键名统一小写，修饰键用 cmd/ctrl/alt/shift。 */
export const BLOCKED_COMBOS = [
  ['cmd', 'q'],
  ['cmd', 'w'],
  ['cmd', 'delete'],
  ['cmd', 'shift', 'delete'],
  ['cmd', 'alt', 'esc'],
  ['ctrl', 'alt', 'delete']
] as const

export type Verdict = { ok: true } | { ok: false; error: string }

export function checkTarget(t: Target): Verdict {
  const id = (t.bundleId ?? '').toLowerCase()
  if (!id) return { ok: true } // 拿不到 bundle id 不拦：拦了等于什么都点不了；真正的闸是授权窗口
  for (const n of NEVER_TOUCH) if (id === n.bundleId) return { ok: false, error: `不能操作这个窗口 —— ${n.why}` }
  return { ok: true }
}

const norm = (k: string): string => k.trim().toLowerCase().replace(/^(command|meta|⌘)$/, 'cmd').replace(/^(option|opt|⌥)$/, 'alt').replace(/^(control|⌃)$/, 'ctrl').replace(/^(⇧)$/, 'shift').replace(/^(del|backspace)$/, 'delete').replace(/^escape$/, 'esc')

export function checkKeys(keys: readonly string[]): Verdict {
  if (!Array.isArray(keys) || !keys.length) return { ok: false, error: '没有给按键' }
  if (keys.length > 5) return { ok: false, error: '一次最多 5 个键' }
  const got = keys.map(norm)
  const set = new Set(got)
  for (const combo of BLOCKED_COMBOS) {
    if (combo.length === set.size && combo.every((k) => set.has(k)))
      return { ok: false, error: `不允许 ${combo.join('+')} —— 这类操作不可撤销，请让用户自己按` }
  }
  return { ok: true }
}

/** 输入文本的上限与内容闸：不接受粘贴板、不接受超长文本（§四 act_type 的备注） */
export const MAX_TYPE_LEN = 500
export function checkText(text: unknown): Verdict {
  if (typeof text !== 'string' || !text.length) return { ok: false, error: '没有给文本' }
  if (text.length > MAX_TYPE_LEN) return { ok: false, error: `一次最多输入 ${MAX_TYPE_LEN} 个字符（给的是 ${text.length}）` }
  return { ok: true }
}
