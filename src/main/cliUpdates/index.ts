import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { CliUpdateManager, CLI_IDS } from './manager.ts'
import { latestVersion, stageVersion, systemVersion, verifyVersion } from './packages.ts'
import { setManagedCliPaths } from '../probeEnv.ts'
import type { UpdatableCli } from '../../shared/cliUpdates.ts'

export function registerCliUpdateHandlers(): void {
  const root = path.join(app.getPath('userData'), 'cli-versions')
  const manager = new CliUpdateManager(root, {
    latest: latestVersion,
    stage: (id, version, signal) => stageVersion(root, id, version, signal),
    verify: (id, version) => verifyVersion(root, id, version),
    systemVersion,
    changed: () => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('cliUpdates:changed', manager.snapshot())
    }
  })
  try { setManagedCliPaths(manager.boot()) }
  catch (e) { setManagedCliPaths([]); console.error('[cliUpdates] 无法保存更新状态，保留系统 CLI', e) }
  const ready = manager.refreshVersions()
  const validId = (id: unknown): id is UpdatableCli => CLI_IDS.includes(id as UpdatableCli)
  ipcMain.handle('cliUpdates:get', async () => { await ready; return manager.snapshot() })
  ipcMain.handle('cliUpdates:setEnabled', async (_e, id: unknown, value: unknown) => {
    if (!validId(id) || typeof value !== 'boolean') throw new Error('无效 CLI 更新设置')
    manager.setEnabled(id, value)
    if (value) void ready.then(() => manager.check(id))
    return manager.snapshot()
  })
  ipcMain.handle('cliUpdates:retry', async (_e, id: unknown) => {
    if (!validId(id)) throw new Error('无效 CLI')
    await ready
    void manager.check(id)
    return manager.snapshot()
  })
  ipcMain.handle('cliUpdates:rollback', (_e, id: unknown) => {
    if (!validId(id)) throw new Error('无效 CLI')
    manager.rollback(id)
    return manager.snapshot()
  })
  // 启动后及每 6 小时检查；默认关闭的项目不发任何版本/下载请求。
  const check = (): void => { void ready.then(() => Promise.all(CLI_IDS.map(id => manager.check(id)))) }
  const initial = setTimeout(check, 30_000)
  const timer = setInterval(check, 6 * 60 * 60_000)
  initial.unref(); timer.unref()
  app.once('before-quit', () => { clearTimeout(initial); clearInterval(timer); manager.stop() })
}
