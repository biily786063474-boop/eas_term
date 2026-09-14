// 一个 ipc 频道只挂**一个**底层监听，订阅者进 Set 里分发。
//
// 浏览器节点每个组件都要订阅 browser:route / browser:favoritesChanged，画布上几十个网页节点
// （离屏的不建 webview，但 React 组件挂着）就是几十个 ipcRenderer 监听 —— 2026-09-14 正式版
// 数到各 11 个，Node 直接报 MaxListenersExceededWarning。分发一层之后 ipc 侧恒为 0 或 1 个。
//
// 放在 shared/ 且不 import electron：preload 把 ipcRenderer 传进来；web 工程经 api.d.ts 收录 preload，
// 所以它引的值模块也必须在两个 tsconfig 都能看见的目录里。可以 `node --test` 裸跑。
export interface ChannelSource {
  on(channel: string, handler: (event: unknown, data: unknown) => void): unknown
  removeListener(channel: string, handler: (event: unknown, data: unknown) => void): unknown
}

export function createSharedChannel<T>(source: ChannelSource, channel: string): (cb: (data: T) => void) => () => void {
  const subs = new Set<(data: T) => void>()
  let attached = false
  const handler = (_e: unknown, data: unknown): void => {
    // 快照一份再遍历：回调里退订自己不能打乱这一轮分发
    for (const cb of [...subs]) cb(data as T)
  }
  return (cb) => {
    subs.add(cb)
    if (!attached) {
      attached = true
      source.on(channel, handler)
    }
    let active = true
    return () => {
      if (!active) return // 重复调用退订函数不能把别人的订阅算掉
      active = false
      subs.delete(cb)
      if (subs.size === 0 && attached) {
        attached = false
        source.removeListener(channel, handler)
      }
    }
  }
}
