// 灵动岛窗口的 preload：刻意只有三个能力。
//
// 不复用主窗口那份 500 行的 api —— 那里有 pty spawn、文件读写、密钥柜。
// 灵动岛是个挂在屏幕顶上、永远开着的展示件，给它的权限越少越好：
// 它只需要「收状态、报尺寸、发动作」，多一个都是白送的攻击面。
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { IslandAction, IslandState } from '../shared/types'

const islandApi = {
  /** 订阅主进程推来的状态快照；返回退订函数 */
  onState: (cb: (s: IslandState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: IslandState): void => cb(s)
    ipcRenderer.on('island:state', listener)
    return () => ipcRenderer.removeListener('island:state', listener)
  },
  /** 组件挂载完、监听器挂好了 → 要一次当前状态。
   *  不能靠主进程在 did-finish-load 时推：那一刻 React 还没跑到 useEffect，
   *  推过来没人接，窗口就空着，直到下一次状态变化才有内容（可能是几分钟后）。 */
  ready: (): void => {
    ipcRenderer.send('island:ready')
  },
  /** 把量到的内容尺寸报给主进程，由它摆窗口 */
  /** 展开着在读 → 告诉主进程别收窗口（前台的露面窗口期会等你） */
  hold: (v: boolean): void => {
    ipcRenderer.send('island:hold', v)
  },
  reportSize: (w: number, h: number): void => {
    ipcRenderer.send('island:resize', w, h)
  },
  /** 主进程要关窗了 → 播退场动画。窗口会在动画时长后被销毁，这里不用自己收尾 */
  onLeave: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('island:leave', listener)
    return () => ipcRenderer.removeListener('island:leave', listener)
  },
  /** 退场播到一半又要显示（切走马上切回）→ 撤销退场，原地淡回来 */
  onEnter: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('island:enter', listener)
    return () => ipcRenderer.removeListener('island:enter', listener)
  },
  /** 用户点了什么 */
  action: (a: IslandAction): void => {
    ipcRenderer.send('island:action', a)
  }
}

export type IslandApi = typeof islandApi

contextBridge.exposeInMainWorld('island', islandApi)
