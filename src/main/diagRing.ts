// 闪烁黑匣子的**纯逻辑**：事件行格式、环形缓冲、日志文件截断。零 electron，有测试。
// 设计动机见 diagLog.ts 文件头。

export interface DiagEvent {
  /** 毫秒时间戳 */
  t: number
  /** 来源：renderer / main */
  src: 'r' | 'm'
  /** 事件种类：mount / unmount / longtask / gpu / render / visibility … */
  kind: string
  /** 一句话：哪个组件、多长、什么原因 */
  what: string
}

export function formatLine(e: DiagEvent): string {
  const iso = new Date(e.t).toISOString()
  return `${iso} ${e.src} ${e.kind} ${e.what.replace(/\s+/g, ' ').slice(0, 200)}`
}

/** 固定容量的环形缓冲：满了丢最老的 */
export class Ring<T> {
  private buf: T[] = []
  private readonly cap: number
  // ⚠️ 不用参数属性（`constructor(private cap)`）—— node --test 的类型剥离不认，整文件加载失败
  constructor(cap: number) {
    this.cap = cap
  }
  push(v: T): void {
    this.buf.push(v)
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap)
  }
  items(): T[] {
    return [...this.buf]
  }
  get size(): number {
    return this.buf.length
  }
}

/** 日志文件超过上限就从头砍到一半，砍在行边界上，别留半行 */
export function trimLog(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const target = Math.floor(maxBytes / 2)
  let cut = Buffer.byteLength(text, 'utf8') - target
  // 找到 cut 之后第一个换行
  let i = 0
  let bytes = 0
  while (i < text.length && bytes < cut) {
    bytes += Buffer.byteLength(text[i], 'utf8')
    i++
  }
  const nl = text.indexOf('\n', i)
  return nl < 0 ? '' : text.slice(nl + 1)
}
