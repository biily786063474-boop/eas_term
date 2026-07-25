// 设计模块：把导出的产物（PNG / WebM / MP4 …）写入项目的 demo/ 目录。
// 渲染层把导出 Blob 转成 ArrayBuffer 传来，这里按项目路径落盘（目录不存在则建）。
import { ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'

interface ExportResult {
  ok: boolean
  error?: string
  path?: string
}

export function registerDesignHandlers(): void {
  ipcMain.handle(
    'design:exportToDemo',
    async (_e, projectPath: string, filename: string, data: ArrayBuffer): Promise<ExportResult> => {
      try {
        if (!projectPath || !filename) return { ok: false, error: '缺少项目路径或文件名' }
        // basename 兜底：防路径穿越，产物只落在项目 demo/ 下
        const safeName = path.basename(filename)
        const demoDir = path.join(projectPath, 'demo')
        await fs.promises.mkdir(demoDir, { recursive: true })
        const outPath = path.join(demoDir, safeName)
        await fs.promises.writeFile(outPath, Buffer.from(data))
        return { ok: true, path: outPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // 导出后在访达里定位产物（可选）
  ipcMain.handle('design:revealDemo', (_e, filePath: string) => shell.showItemInFolder(filePath))
}
