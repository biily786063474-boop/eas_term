// 手机上看「以前聊过的」：把电脑上落盘的对话记录（agentHistory，按画布节点存）和这次运行在内存里记的
// （agentChat/transcript.ts）拼成一份给手机。
//
// 为什么要有这一层（2026-10-02 真机回归，用户：「打开之后我看不到任何信息」）：
// 手机原来只读 transcript —— 那是**本次启动之后**主进程在事件流上记的。重启一次 Eas-Term，
// 画布上所有对话都是「没启动」，电脑上点开有完整历史，手机上一律空白。
//
// 拼法：落盘记录在前；内存里比落盘时刻（savedAt）**更晚**的接在后面。
// 渲染层每轮结束会把整段写盘，所以 savedAt 之前的内存条目已经在盘上了 —— 按时刻切，不按文字去重
//（一轮回复在内存里可能是好几段 text.done，盘上是拼好的一整段，文字对不上）。
// 节点在画布视口外时组件被裁掉、不写盘，那时 savedAt 停在旧时刻，内存条目全部接上，也对。
import { MAX_TEXT, type TranscriptEntry } from '../agentChat/transcript.ts'
import { tm } from '../../shared/i18n/current.ts'

export interface DiskHistory {
  turns: readonly unknown[]
  savedAt: number
}

/** 单条封顶，跟 transcript.ts 同一个上限、同一句截断说明 */
export function clipForPhone(text: string, max = MAX_TEXT): string {
  return text.length > max ? text.slice(0, max) + '\n' + tm('errCore.phone.truncatedMore', { n: text.length - max }) : text
}

export function mergeForPhone(disk: DiskHistory | null, live: readonly TranscriptEntry[], n = 40): TranscriptEntry[] {
  const old: TranscriptEntry[] = []
  for (const x of disk?.turns ?? []) {
    if (!x || typeof x !== 'object') continue
    const t = x as { role?: unknown; text?: unknown; seq?: unknown }
    if (t.role !== 'user' && t.role !== 'assistant') continue
    const text = typeof t.text === 'string' ? t.text.trim() : ''
    if (!text) continue // 只有工具调用、没说话的那轮：手机上不给空气泡
    old.push({ role: t.role, text: clipForPhone(text), at: typeof t.seq === 'number' ? t.seq : 0 })
  }
  const cut = disk?.savedAt ?? 0
  const fresh = live.filter((e) => e.at > cut)
  return [...old, ...fresh].slice(-n)
}
