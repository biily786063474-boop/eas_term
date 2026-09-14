// S4（2026-09-14 评审）：有副作用的 IPC 只接受"某个 BrowserWindow 的主 frame"发来的调用。
// 子 frame、没有窗口的 webContents（webview guest、OOPIF 面板）一律拒——
// 和 runtime/ipc.ts 里逐个手写的那句是同一条规则，这里收成一处。
import { ipcMain, BrowserWindow, type IpcMainInvokeEvent, type IpcMainEvent, type WebContents } from 'electron'
import { isWorkbenchSender, type GuardEvent } from './ipcGuardCore.ts'
export { isWorkbenchSender } from './ipcGuardCore.ts'

const check = (event: GuardEvent): boolean => isWorkbenchSender<WebContents>(event, wc => BrowserWindow.fromWebContents(wc))

/** ipcMain.handle 的守卫版：不是工作台主 frame 发来的，抛错给调用方。 */
export function guardedHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!check(event)) throw new Error('仅工作台可调用 ' + channel)
    return handler(event, ...args)
  })
}
/** ipcMain.on 的守卫版：不是工作台主 frame 发来的，静默丢弃（没有返回通道可报）。 */
export function guardedOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => { if (check(event)) listener(event, ...args) })
}
