import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Project } from '../shared/types'

const storeFile = (): string => path.join(app.getPath('userData'), 'projects.json')

function loadProjects(): Project[] {
  try {
    const list = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    if (Array.isArray(list)) return list
  } catch {
    // 文件不存在或损坏
  }
  return []
}

function saveProjects(list: Project[]): void {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2), 'utf8')
}

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list', () => loadProjects())

  ipcMain.handle('projects:addViaDialog', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择或新建项目文件夹',
      buttonLabel: '添加为项目',
      properties: ['openDirectory', 'createDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return loadProjects()

    const list = loadProjects()
    for (const dirPath of result.filePaths) {
      if (list.some((p) => p.path === dirPath)) continue
      list.push({
        id: crypto.randomUUID(),
        name: path.basename(dirPath),
        path: dirPath,
        addedAt: Date.now()
      })
    }
    saveProjects(list)
    return list
  })

  ipcMain.handle('projects:remove', (_e, id: string) => {
    const list = loadProjects().filter((p) => p.id !== id)
    saveProjects(list)
    return list
  })

  /** 改项目显示名。只改列表里的 name，**不动磁盘上的目录名** ——
   *  项目名一开始是 path.basename 推导出来的，但它是个显示标签：
   *  用户可能有两个都叫 web 的目录，想在侧栏区分开，不该被迫去动真实目录。 */
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => {
    const trimmed = String(name ?? '').trim().slice(0, 60)
    const list = loadProjects()
    const p = list.find((x) => x.id === id)
    // 名字清空 → 回落到目录名（和「重命名成空」这个操作的直觉一致，不留空白项）
    if (p) p.name = trimmed || path.basename(p.path)
    saveProjects(list)
    return list
  })
}
