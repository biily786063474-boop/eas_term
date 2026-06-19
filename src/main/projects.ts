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
}
