// 按 key 计数的进程复用表。**纯逻辑，定时器可注入，可测。**
// 给 pluginHost.ts 用：一个插件一个进程，面板与会话各自 acquire/release；
// refs 归零后延迟 graceMs 再真正回收（面板关了又开不抖）。
// 设计稿决定 #2 —— 不这么做，一个插件几块面板加几个会话就是几个进程。

export interface RegistryOpts<T> {
  graceMs: number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** refs 归零且宽限期过完：调用方在这里真正 kill */
  onIdle: (key: string, value: T) => void
}

interface Entry<T> {
  value: T
  refs: Set<string>
  idleTimer: unknown | null
}

export class HostRegistry<T> {
  private map = new Map<string, Entry<T>>()
  private opts: RegistryOpts<T>
  // ⚠️ 不用 `constructor(private opts)` 参数属性 —— `node --test` 的类型剥离不认它，
  // tsx 单跑能过、全量跑整文件加载失败（仓库已知坑，见 memory）
  constructor(opts: RegistryOpts<T>) {
    this.opts = opts
  }

  /** 没有就 create()；有就复用。ref 是持有方的身份（panelSession / 会话 id），同一 ref 重复 acquire 幂等 */
  acquire(key: string, ref: string, create: () => T): T {
    let e = this.map.get(key)
    if (!e) {
      e = { value: create(), refs: new Set(), idleTimer: null }
      this.map.set(key, e)
    }
    if (e.idleTimer !== null) {
      this.opts.clearTimer(e.idleTimer)
      e.idleTimer = null
    }
    e.refs.add(ref)
    return e.value
  }

  release(key: string, ref: string): void {
    const e = this.map.get(key)
    if (!e) return
    e.refs.delete(ref)
    if (e.refs.size > 0 || e.idleTimer !== null) return
    e.idleTimer = this.opts.setTimer(() => {
      const cur = this.map.get(key)
      if (!cur || cur.refs.size > 0) return
      this.map.delete(key)
      this.opts.onIdle(key, cur.value)
    }, this.opts.graceMs)
  }

  /** 进程自己死了（不是我们回收的）：立刻摘掉，让下一次 acquire 重新 create */
  drop(key: string): T | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.idleTimer !== null) this.opts.clearTimer(e.idleTimer)
    this.map.delete(key)
    return e.value
  }

  /** 把某个 ref 从所有 key 里摘掉（一个会话退出时，它可能持有多个插件） */
  releaseAll(ref: string): void {
    for (const key of [...this.map.keys()]) this.release(key, ref)
  }

  refs(key: string): number {
    return this.map.get(key)?.refs.size ?? 0
  }
  get(key: string): T | undefined {
    return this.map.get(key)?.value
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}
