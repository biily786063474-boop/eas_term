import { clipboard, ipcMain, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import type { DirEntry, TextFileResult, ImageFileResult, OpResult, PathProbe } from '../shared/types'

// 在访达中选中文件：macOS 上 shell.showItemInFolder 有时不把 Finder 带到前台，
// 改用 `open -R` 既能定位文件又能激活 Finder；失败再回退到原 API。
function revealInFinder(target: string): void {
  if (process.platform === 'darwin') {
    // 用绝对路径 /usr/bin/open：从访达启动的打包应用 PATH 受限，'open' 可能找不到
    execFile('/usr/bin/open', ['-R', target], (err) => {
      if (err) shell.showItemInFolder(target)
    })
  } else {
    shell.showItemInFolder(target)
  }
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024 // 代码预览上限 2MB，超出截断
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

export function registerFsHandlers(): void {
  ipcMain.handle('fs:readDir', async (_e, dirPath: string): Promise<DirEntry[]> => {
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const entries: DirEntry[] = []
    for (const d of dirents) {
      const full = path.join(dirPath, d.name)
      let isDir = d.isDirectory()
      if (d.isSymbolicLink()) {
        try {
          isDir = (await fs.promises.stat(full)).isDirectory()
        } catch {
          isDir = false
        }
      }
      entries.push({
        name: d.name,
        path: full,
        isDir,
        isHidden: d.name.startsWith('.')
      })
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' })
    })
    return entries
  })

  ipcMain.handle('fs:readTextFile', async (_e, filePath: string): Promise<TextFileResult> => {
    try {
      const stat = await fs.promises.stat(filePath)
      const fd = await fs.promises.open(filePath, 'r')
      try {
        const readBytes = Math.min(stat.size, MAX_TEXT_BYTES)
        const buf = Buffer.alloc(readBytes)
        await fd.read(buf, 0, readBytes, 0)
        // 简单二进制探测：开头 8KB 内出现 NUL 字节即视为二进制
        const probe = buf.subarray(0, Math.min(8192, buf.length))
        const binary = probe.includes(0)
        return {
          ok: true,
          content: binary ? '' : buf.toString('utf8'),
          truncated: stat.size > MAX_TEXT_BYTES,
          binary,
          size: stat.size
        }
      } finally {
        await fd.close()
      }
    } catch (err) {
      return {
        ok: false,
        content: '',
        truncated: false,
        binary: false,
        size: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('fs:readImageFile', async (_e, filePath: string): Promise<ImageFileResult> => {
    try {
      const ext = path.extname(filePath).toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) return { ok: false, dataUrl: '', size: 0, error: '不支持的图片格式' }
      const stat = await fs.promises.stat(filePath)
      if (stat.size > MAX_IMAGE_BYTES) {
        return { ok: false, dataUrl: '', size: stat.size, error: '图片超过 50MB，无法预览' }
      }
      const buf = await fs.promises.readFile(filePath)
      return {
        ok: true,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        size: stat.size
      }
    } catch (err) {
      return {
        ok: false,
        dataUrl: '',
        size: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('fs:openPath', (_e, target: string) => shell.openPath(target))

  ipcMain.handle('fs:showInFolder', (_e, target: string) => {
    revealInFinder(target)
  })

  ipcMain.handle('fs:rename', async (_e, oldPath: string, newName: string): Promise<OpResult> => {
    try {
      if (!newName || /[/\\:]/.test(newName)) return { ok: false, error: '名称不合法' }
      const target = path.join(path.dirname(oldPath), newName)
      if (target === oldPath) return { ok: true, path: target }
      if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在' }
      await fs.promises.rename(oldPath, target)
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fs:trash', async (_e, target: string): Promise<OpResult> => {
    try {
      await shell.trashItem(target)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })

  // 终端链接解析：把候选路径（绝对 / ~ / file:// / 相对 baseCwd）解析为绝对路径，
  // 仅返回真实存在者，null 表示该候选不是文件/目录（不渲染为链接）。
  ipcMain.handle(
    'fs:probePaths',
    (_e, inputs: string[], baseCwd: string): (PathProbe | null)[] => {
      const base = baseCwd && path.isAbsolute(baseCwd) ? baseCwd : os.homedir()
      return inputs.map((input) => {
        try {
          let p = String(input).trim()
          if (!p) return null
          if (p.startsWith('file://')) {
            p = fileURLToPath(p)
          } else {
            // 去掉编译器/grep 常见的 :行 或 :行:列 后缀
            p = p.replace(/:(\d+)(:\d+)?$/, '')
            if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1))
            if (!path.isAbsolute(p)) p = path.resolve(base, p)
          }
          const st = fs.statSync(p)
          return { absPath: p, isDir: st.isDirectory() }
        } catch {
          return null
        }
      })
    }
  )
}
