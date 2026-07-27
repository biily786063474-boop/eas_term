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

  // 写回文本文件（代码预览里的「编辑」用）。先写临时文件再 rename——中途崩了也不会
  // 留下半截内容把用户原文件毁掉。
  ipcMain.handle(
    'fs:writeTextFile',
    async (_e, filePath: string, content: string): Promise<OpResult> => {
      try {
        if (!path.isAbsolute(filePath)) return { ok: false, error: '需要绝对路径' }
        const stat = await fs.promises.stat(filePath).catch(() => null)
        if (stat && !stat.isFile()) return { ok: false, error: '目标不是文件' }
        // 只读时读的是前 2MB，写回会截断剩下的——这种文件一律不给存
        if (stat && stat.size > MAX_TEXT_BYTES) return { ok: false, error: '文件超过 2MB，未开放编辑' }
        const tmp = filePath + '.eas-tmp'
        await fs.promises.writeFile(tmp, content, 'utf8')
        await fs.promises.rename(tmp, filePath)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

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

  ipcMain.handle('clipboard:readText', () => clipboard.readText())

  // 剪贴板是否有图片：终端粘贴时据此判断"无文本但有图"，好补发粘贴信号让 Claude Code 读图
  ipcMain.handle('clipboard:hasImage', () => !clipboard.readImage().isEmpty())

  // 把剪贴板里的图片落盘到 <项目>/assets/img/。截图/复制的图直接粘进项目，
  // 不用先存桌面再拖进来。
  ipcMain.handle(
    'clipboard:saveImage',
    async (_e, projectPath: string): Promise<{ ok: boolean; error?: string; path?: string }> => {
      try {
        const img = clipboard.readImage()
        if (img.isEmpty()) return { ok: false, error: '剪贴板里没有图片' }
        if (!projectPath || !path.isAbsolute(projectPath))
          return { ok: false, error: '没有当前项目，不知道该存到哪' }
        const dir = path.join(projectPath, 'assets', 'img')
        await fs.promises.mkdir(dir, { recursive: true })
        // 文件名带时间戳，按名字排序就是按粘贴顺序；秒级重名再补一位序号
        const d = new Date()
        const p2 = (n: number): string => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
        let file = path.join(dir, `pasted-${stamp}.png`)
        for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `pasted-${stamp}-${i}.png`)
        await fs.promises.writeFile(file, img.toPNG())
        return { ok: true, path: file }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

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
