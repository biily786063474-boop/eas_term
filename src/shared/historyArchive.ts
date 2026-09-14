// 完整归档（2026-09-14）。磁盘上的一份对话记录不再只留最近 100 条：
// 每条消息在产生时拿一个稳定序号，主进程保存时按序号做并集——内存里被裁掉的旧消息保留、
// 同序号的以新来的为准；界面读取时只回最近 n 条，正文全在盘上。
// 纯函数，主进程与渲染层共用；不引 electron / react。

export interface SeqTurn { seq?: number }

/** 序号：不小于产生时刻的毫秒数，且进程内严格递增。跨重启靠时钟天然大于旧记录；
 *  时钟倒拨也只会让顺序不对，并集按序号取，不会丢消息。 */
export function createSeq(): () => number {
  let last = 0
  return () => { last = Math.max(last + 1, Date.now()); return last }
}
export const nextSeq = createSeq()

/** 旧档没有序号：按下标补 0..n-1。任何新消息的序号都是毫秒级时间戳，天然排在它们之后。 */
export function assignLegacySeq<T extends SeqTurn>(turns: readonly T[]): T[] {
  return turns.map((t, i) => (typeof t.seq === 'number' ? t : { ...t, seq: i }))
}

/** 并集：prev（磁盘全量）∪ incoming（内存窗口），同序号 incoming 覆盖；没有序号的新消息追加到末尾（不丢）。 */
export function mergeArchiveTurns<T extends SeqTurn>(prev: readonly T[], incoming: readonly T[]): T[] {
  const base = assignLegacySeq(prev)
  const byKey = new Map<number, T>()
  for (const t of base) byKey.set(t.seq as number, t)
  let max = base.reduce((m, t) => Math.max(m, t.seq as number), 0)
  // 无序号的新消息（不该有，但真出现过：追问一度没带 seq）：不能每次保存都发新号追加，
  // 否则流式期间每秒一存就复制几十份。按「紧邻前驱的序号 + 角色 + 正文」定位：
  // 同一位置同样的话已经在档里就复用它的序号，否则才发新号。
  // 序号取**前后邻居的中点**（都没有就取当前时间），这样它落在正确的位置，且只要邻居不变、
  // 下一次保存算出同一把 key 就复用同一个序号，不会重复。
  let prevSeq: number | null = null
  const existing = new Map<string, number>()
  for (const t of base) existing.set(keyOf(t, prevSeqOf(base, t)), t.seq as number)
  for (let i = 0; i < incoming.length; i++) {
    const t = incoming[i]
    if (typeof t.seq === 'number') { byKey.set(t.seq, t); max = Math.max(max, t.seq); prevSeq = t.seq; continue }
    const k = keyOf(t, prevSeq)
    let seq = existing.get(k)
    if (seq === undefined) {
      const next = incoming.slice(i + 1).find(x => typeof x.seq === 'number')?.seq ?? null
      seq = prevSeq === null ? (next === null ? Date.now() : next - 0.5) : (next === null ? prevSeq + 0.5 : (prevSeq + next) / 2)
      while (byKey.has(seq)) seq += 1e-6
      max = Math.max(max, seq)
    }
    byKey.set(seq, { ...t, seq })
    existing.set(k, seq)
    prevSeq = seq
  }
  return [...byKey.values()].sort((a, b) => (a.seq as number) - (b.seq as number))
}

function keyOf(t: SeqTurn & { role?: string; text?: string }, prev: number | null): string {
  return `${prev ?? '-'}|${t.role ?? ''}|${t.text ?? ''}`
}
function prevSeqOf(sorted: readonly SeqTurn[], t: SeqTurn): number | null {
  const i = sorted.indexOf(t)
  return i > 0 ? (sorted[i - 1].seq as number) : null
}

/** 只取最近 n 条，顺序不变。 */
export function tailWindow<T>(turns: readonly T[], n: number): T[] {
  return n >= turns.length ? [...turns] : turns.slice(turns.length - n)
}

/** 界面一次加载多少条：与渲染层的裁剪额度同量级（40 条回答 + 60 条提问）。 */
export const HISTORY_WINDOW = 100
