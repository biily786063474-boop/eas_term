import { clipboard, ipcMain, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import type {
  DirEntry,
  RecentFile,
  TextFileResult,
  ImageFileResult,
  OpResult,
  PathProbe
} from '../shared/types'
import { guardDir, guardPath, invalidNameReason } from './fsGuard'

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

// 递归扫描时跳过的目录（依赖 / 构建产物 / 虚拟环境）
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'release',
  'target',
  'vendor',
  'venv',
  '__pycache__',
  'Pods'
])

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

  /** 读原始字节：给渲染层的 WebAudio 解码音频用（视频/音频转录）。
   *  2GB 上限——再大 decodeAudioData 那边也会先撑爆内存，早点说清楚比崩了强。 */
  ipcMain.handle(
    'fs:readBinary',
    async (_e, filePath: string): Promise<{ ok: boolean; data: ArrayBuffer; error?: string }> => {
      try {
        const st = await fs.promises.stat(filePath)
        if (st.size > 2 * 1024 * 1024 * 1024)
          return { ok: false, data: new ArrayBuffer(0), error: '文件超过 2GB，转录不了' }
        const buf = await fs.promises.readFile(filePath)
        return { ok: true, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
      } catch (e) {
        return { ok: false, data: new ArrayBuffer(0), error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // 用户自建词库的读写搬去了 src/main/dict.ts（那边还管补全开关和待办队列）。

  // 项目内「最近产生的文件」：递归扫描 + 按创建时间倒序。画布双击插入菜单的「最近」排序用。
  // 跳过依赖/产物目录和隐藏目录——node_modules 一个就能把扫描时间拖到几十秒，且没人想插它。
  const DOC_EXTS = new Set(['md', 'txt', 'html'])
  ipcMain.handle(
    'fs:recentFiles',
    async (_e, rootPath: string, limit = 60, docsOnly = false): Promise<RecentFile[]> => {
      const out: RecentFile[] = []
      let budget = 20000 // 扫描条目上限：超大仓库别把主进程钉死
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 8 || budget <= 0) return
        let dirents: fs.Dirent[]
        try {
          dirents = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          return // 没权限就跳过这一支，别整个失败
        }
        for (const d of dirents) {
          if (budget-- <= 0) return
          if (d.name.startsWith('.') || SKIP_DIRS.has(d.name)) continue
          const full = path.join(dir, d.name)
          if (d.isDirectory()) {
            await walk(full, depth + 1)
            continue
          }
          if (!d.isFile()) continue
          // 过滤放在**这里**（扫描时），不能放到最后 slice 之后 ——
          // 这个列表是「按创建时间取前 N」，一次构建就能把名额占满，
          // 要找的报告排在第 80 位根本进不来。在扫描时滤掉非文档，名额才全给文档。
          if (docsOnly && !DOC_EXTS.has((d.name.split('.').pop() ?? '').toLowerCase())) continue
          try {
            const st = await fs.promises.stat(full)
            out.push({
              name: d.name,
              path: full,
              rel: path.relative(rootPath, full),
              time: st.birthtimeMs || st.mtimeMs
            })
          } catch {
            /* 读不到就当没有 */
          }
        }
      }
      await walk(rootPath, 0)
      out.sort((a, b) => b.time - a.time)
      return out.slice(0, limit)
    }
  )

  // 写回文本文件（代码预览里的「编辑」用）。先写临时文件再 rename——中途崩了也不会
  // 留下半截内容把用户原文件毁掉。
  ipcMain.handle(
    'fs:writeTextFile',
    async (_e, filePath: string, content: string): Promise<OpResult> => {
      try {
        // 和 rename/trash/mkdir 那几个走同一道边界：只能写项目根或知识库根之内。
        // 漏了它的话，「所有文件写操作都限制在你自己加过的目录内」这句话就是假的——
        // 这个 handler 面向的是同一个 preload，webview / MCP 场景都够得着它。
        const g = guardPath(filePath)
        // 这个场景（预览里点了「编辑」再保存）值得给条出路：用户多半是从终端链接点开了
        // 项目外的文件，告诉他把那个文件夹加成项目就能编辑，比只说「不允许」有用
        if (!g.ok) return { ok: false, error: g.error + '。把它所在的文件夹加成项目就能编辑' }
        const stat = await fs.promises.stat(g.path).catch(() => null)
        if (stat && !stat.isFile()) return { ok: false, error: '目标不是文件' }
        // 只读时读的是前 2MB，写回会截断剩下的——这种文件一律不给存
        if (stat && stat.size > MAX_TEXT_BYTES) return { ok: false, error: '文件超过 2MB，未开放编辑' }
        const tmp = g.path + '.eas-tmp'
        await fs.promises.writeFile(tmp, content, 'utf8')
        await fs.promises.rename(tmp, g.path)
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
      const bad = invalidNameReason(newName)
      if (bad) return { ok: false, error: bad }
      const g = guardPath(oldPath)
      if (!g.ok) return g
      const target = path.join(path.dirname(g.path), newName)
      if (target === g.path) return { ok: true, path: target }
      if (fs.existsSync(target)) return { ok: false, error: '同名的文件或文件夹已经存在' }
      await fs.promises.rename(g.path, target)
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fs:trash', async (_e, target: string): Promise<OpResult> => {
    try {
      const g = guardPath(target)
      if (!g.ok) return g
      await shell.trashItem(g.path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── 以下是文件树的 IDE 式操作。共同点：目标路径一律先过守卫，之后只用守卫返回的
  // 真实路径（realpath 解析过、确认在项目/知识库内），不再碰调用方传进来的原始字符串。

  ipcMain.handle('fs:mkdir', async (_e, parentDir: string, name: string): Promise<OpResult> => {
    try {
      const bad = invalidNameReason(name)
      if (bad) return { ok: false, error: bad }
      const g = guardDir(parentDir)
      if (!g.ok) return g
      const target = path.join(g.path, name)
      // 不用 recursive：那样 name 里带路径分隔符时会静默建出一串深目录。
      // 名字已经被 invalidNameReason 挡掉了斜杠，这里再用非递归兜一层。
      await fs.promises.mkdir(target)
      return { ok: true, path: target }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('EEXIST')) return { ok: false, error: '同名的文件或文件夹已经存在' }
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('fs:createFile', async (_e, parentDir: string, name: string): Promise<OpResult> => {
    try {
      const bad = invalidNameReason(name)
      if (bad) return { ok: false, error: bad }
      const g = guardDir(parentDir)
      if (!g.ok) return g
      const target = path.join(g.path, name)
      // 'wx' = 独占创建：目标已存在就直接失败。用 existsSync 先探再写会有竞态，
      // 让内核来保证「不覆盖已有文件」这件事。
      const fh = await fs.promises.open(target, 'wx')
      await fh.close()
      return { ok: true, path: target }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('EEXIST')) return { ok: false, error: '同名的文件或文件夹已经存在' }
      return { ok: false, error: msg }
    }
  })

  /** 移动（拖拽 / 剪切粘贴）。跨目录，所以不能复用 fs:rename —— 那个的目标目录是硬编码的 dirname(oldPath)。 */
  ipcMain.handle('fs:move', async (_e, src: string, destDir: string): Promise<OpResult> => {
    try {
      const gs = guardPath(src)
      if (!gs.ok) return gs
      const gd = guardDir(destDir)
      if (!gd.ok) return gd
      // 把目录移进它自己的子孙里 → 会把这棵子树从文件系统上摘掉。必须挡。
      if (gd.path === gs.path || gd.path.startsWith(gs.path + path.sep)) {
        return { ok: false, error: '不能把一个文件夹移动到它自己里面' }
      }
      const target = path.join(gd.path, path.basename(gs.path))
      if (target === gs.path) return { ok: true, path: target } // 原地放下，什么都不用做
      if (fs.existsSync(target)) return { ok: false, error: '目标位置已经有同名的文件或文件夹' }
      await fs.promises.rename(gs.path, target)
      return { ok: true, path: target }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 复制（复制粘贴 / 复制副本）。目标同名时自动加「副本」后缀，不覆盖、不报错 ——
   *  复制粘贴到同一个目录是很常见的意图，这时报「已存在」等于什么也没干。 */
  ipcMain.handle('fs:copy', async (_e, src: string, destDir: string): Promise<OpResult> => {
    try {
      const gs = guardPath(src)
      if (!gs.ok) return gs
      const gd = guardDir(destDir)
      if (!gd.ok) return gd
      if (gd.path === gs.path || gd.path.startsWith(gs.path + path.sep)) {
        return { ok: false, error: '不能把一个文件夹复制到它自己里面' }
      }
      const base = path.basename(gs.path)
      const ext = path.extname(base)
      const stem = ext ? base.slice(0, -ext.length) : base
      let target = path.join(gd.path, base)
      // 「foo.ts」→「foo 副本.ts」→「foo 副本 2.ts」…（对齐访达的中文习惯）
      for (let i = 1; fs.existsSync(target); i++) {
        target = path.join(gd.path, `${stem} 副本${i > 1 ? ' ' + i : ''}${ext}`)
      }
      await fs.promises.cp(gs.path, target, { recursive: true, errorOnExist: true, force: false })
      return { ok: true, path: target }
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
