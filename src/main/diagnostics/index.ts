import { savePending, loadPending, clearPending } from './pending.ts'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Journal } from './journal.ts'
import { makeReport, encodeReport, type Report } from './core.ts'
import { ENDPOINT, sendReport, sendWithConsent } from './transport.ts'
import { setDiagnosticSink, recordDiagnostic } from './record.ts'
import { isDiagnosticBuild } from './identity.ts'
let journal: Journal | undefined
let previousUnclean = false
let pending: Report | undefined
let busy = false

export function initializeDiagnostics(): void {
  if (!isDiagnosticBuild()) return
  journal = new Journal(path.join(app.getPath('userData'), 'diagnostics'))
  previousUnclean = journal.start()
  pending = loadPending(app.getPath('userData'))
  setDiagnosticSink((kind, data) => journal?.record(kind, data))
  process.on('uncaughtExceptionMonitor', error => recordDiagnostic('main-error', { error }))
  process.on('unhandledRejection', error => recordDiagnostic('main-rejection', { error }))
  app.on('quit', () => journal?.finish())
  app.on('child-process-gone', (_e, d) => recordDiagnostic('child-gone', { processType: d.type, reason: d.reason, code: d.exitCode }))
  app.on('browser-window-created', (_e, win) => {
    recordDiagnostic('window-open')
    win.on('closed', () => recordDiagnostic('window-close'))
    win.on('unresponsive', () => recordDiagnostic('window-unresponsive'))
    win.webContents.on('render-process-gone', (_e, d) => recordDiagnostic('render-gone', { reason: d.reason, code: d.exitCode }))
    win.webContents.once('did-finish-load', () => {
      if (!previousUnclean || win.webContents.getURL().includes('island.html')) return
      previousUnclean = false
      void showDiagnostics(win, true)
    })
  })
}
function currentReport(): Report {
  return makeReport({ version: app.getVersion(), os: os.release(), arch: process.arch }, journal?.events() ?? [])
}
function exportReport(report: Report): string {
  // No caller-supplied paths. Fixed app-owned export, overwritten to keep storage bounded.
  const file = path.join(app.getPath('userData'), 'diagnostic-report.json.gz')
  fs.writeFileSync(file, encodeReport(report), { mode: 0o600 })
  shell.showItemInFolder(file)
  return file
}
async function showDiagnostics(win: BrowserWindow, unclean = false): Promise<{ ok: boolean }> {
  if (!journal || busy || win.isDestroyed()) return { ok: false }
  busy = true
  try {
    pending ??= currentReport()
    const report = pending
    const packed = encodeReport(report)
    const answer = await dialog.showMessageBox(win, {
      type: 'info', title: 'Eas-Term Diagnostic · 私发测试版',
      message: unclean ? '上次未正常退出，是否发送诊断？' : '诊断报告 · 发送前确认',
      detail: `发送到：${ENDPOINT}\n版本：${report.version} · 系统：${report.os} · ${report.arch}\n报告编号：${report.id}\n${report.events.length} 条结构化事件，压缩后 ${packed.length} 字节。\n\n只含启动阶段、错误类型、应用栈位置和退出码。不含对话、命令、密钥或私人路径。接收端保留 14 天。\n可先导出查看，再决定是否发送。异常退出也可能是断电或强制关闭，不代表已确认软件崩溃。`,
      buttons: ['取消', '导出查看', '同意并发送'], defaultId: 0, cancelId: 0, noLink: true
    })
    if (answer.response === 1) { exportReport(report); return { ok: true } }
    const id = await sendWithConsent(report, async () => answer.response === 2, r => { savePending(app.getPath('userData'), r); return sendReport(r) })
    if (id) {
      clearPending(app.getPath('userData'))
      pending = undefined
      await dialog.showMessageBox(win, { type: 'info', message: '诊断报告已收到', detail: `报告编号：${id}\n请把编号发给测试负责人。`, buttons: ['知道了'] })
    } else if (answer.response === 0) { pending = undefined; clearPending(app.getPath('userData')) }
    return { ok: true }
  } catch {
    if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'warning', message: '诊断报告未确认送达', detail: '报告保留在本机。可稍后重新发送（同一编号不会重复存储），或导出后交给测试负责人。', buttons: ['知道了'] }).catch(() => {})
    return { ok: false }
  } finally { busy = false }
}
function trustedWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(e.sender)
  return win && win.webContents === e.sender && e.senderFrame === e.sender.mainFrame ? win : null
}
export function registerDiagnosticHandlers(): void {
  ipcMain.handle('diagnostics:chatOpen', e => { if (trustedWindow(e)) recordDiagnostic('chat-open') })
  ipcMain.handle('diagnostics:enabled', () => isDiagnosticBuild())
  ipcMain.handle('diagnostics:open', e => {
    const win = trustedWindow(e)
    return win ? showDiagnostics(win) : { ok: false }
  })
  recordDiagnostic('app-ready')
}
