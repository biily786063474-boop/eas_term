import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWorkbenchSender } from './ipcGuardCore.ts'

// S4：有副作用的 IPC 统一只接受"某个 BrowserWindow 的主 frame"发来的调用。
// 子 frame、没有窗口的 webContents（webview guest）一律拒。
test('主 frame 且属于窗口 → 放行；子 frame 或无窗口 → 拒', () => {
  const main = {}
  const ok = { senderFrame: main, sender: { mainFrame: main } }
  const sub = { senderFrame: {}, sender: { mainFrame: main } }
  const hasWin = () => ({}), noWin = () => null
  assert.equal(isWorkbenchSender(ok as never, hasWin), true)
  assert.equal(isWorkbenchSender(sub as never, hasWin), false)
  assert.equal(isWorkbenchSender(ok as never, noWin), false)
})
