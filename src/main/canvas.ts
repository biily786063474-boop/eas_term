import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

// 无限画布场景持久化：整场景（frames/shapes/viewport/viewMode）落一个 JSON。
// 存在 userData（~/Library/Application Support/Eas-Term/canvas.json）——在 .app 外面，
// 所以升级替换 app、关机重启都不会丢。终端节点的 leafId 由渲染层在保存前剥掉（会话相关），
// 重开时按占位重新 spawn 绑定。
const storeFile = (): string => path.join(app.getPath('userData'), 'canvas.json')

export function registerCanvasHandlers(): void {
  ipcMain.handle('canvas:load', () => {
    try {
      return JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    } catch {
      return null // 文件不存在或损坏 → 当作空画布
    }
  })

  ipcMain.handle('canvas:save', (_e, scene: unknown) => {
    try {
      fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
      fs.writeFileSync(storeFile(), JSON.stringify(scene, null, 2), 'utf8')
    } catch {
      // 写盘失败（磁盘满 / 权限）不阻塞 UI，静默跳过
    }
  })
}
