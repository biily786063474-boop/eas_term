import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Project, ProjectStatus } from '../shared/types'
import { planRename } from './projectPaths'
import { wikiPath } from './wiki/paths'
import type { RenameFolderResult } from '../shared/types'

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

/** symlink 会让字符串前缀比较形同虚设——这是 fsGuard.ts:36-50 的 realResolve 解过的
 *  同一个问题。这里独立实现一份而不是从 fsGuard.ts 导入/导出：那个文件管的是「项目内部」
 *  的写边界，这里管的是项目根本身要不要改名，是两件事，不该互相依赖，也不碰 fsGuard.ts。
 *  目标可能不存在（知识库配置指向的路径已经被删），这时退到「最深的那个真实存在的
 *  祖先」做 realpath，再把剩下的段落拼回去。 */
function realResolveForRename(target: string): string {
  const abs = path.resolve(target)
  let cur = abs
  const tail: string[] = []
  for (;;) {
    try {
      return tail.length ? path.join(fs.realpathSync(cur), ...tail) : fs.realpathSync(cur)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return abs
      tail.unshift(path.basename(cur))
      cur = parent
    }
  }
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

  /** 打/清项目状态标签（传 null 清除 = 回到未分类）。
   *  看板拖拽、画布右键、分屏 tab 右键三处共用这一条 —— 各写各的迟早对不上。 */
  ipcMain.handle('projects:setStatus', (_e, id: string, status: ProjectStatus | null) => {
    const list = loadProjects()
    const p = list.find((x) => x.id === id)
    if (p) {
      if (status) p.status = status
      else delete p.status
    }
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

  /** 真改盘上的目录名，与访达同步。
   *
   *  和 projects:rename 是两件事：那个只改 projects.json 里的展示名。
   *  两个入口在菜单里都留着，各自的 hint 说清区别。
   *
   *  顺序是「先动盘、再动配置」：盘上改失败是常见的（权限、重名、被别的程序占着），
   *  配置改失败几乎不会。先做容易失败的那个，失败就直接返回，不留半截状态。
   *  反过来的话——配置改了盘没改——项目在应用里就彻底找不到了，用户也不知道去哪找。 */
  ipcMain.handle(
    'projects:renameFolder',
    async (_e, id: string, newName: string): Promise<RenameFolderResult> => {
      const list = loadProjects()
      const wp = wikiPath()
      const plan = planRename({
        projects: list,
        projectId: id,
        newName: String(newName ?? ''),
        wikiPath: wp
      })
      if (!plan.ok) return { ok: false, error: plan.error }

      // planRename 只做字符串前缀比较，解不了 symlink（它刻意不碰文件系统，见
      // projectPaths.ts 顶部注释）。这里在动盘之前补一道等价解析：两边都落到
      // realpath 之后再判一次「知识库是不是在这个项目里」，是就拒绝。
      if (wp) {
        const realOld = realResolveForRename(plan.oldPath)
        const realWiki = realResolveForRename(wp)
        if (realWiki === realOld || realWiki.startsWith(realOld + path.sep)) {
          return {
            ok: false,
            error:
              '知识库（经软链解析后）就在这个项目里。知识库路径存在另一份配置里、不会跟着改名走，改了会让它失联——先把知识库挪出去，或者换个项目改'
          }
        }
      }

      // 盘上先改。存在性检查放在 rename 之前只是为了给一句人话错误，
      // 真正的原子性靠 fs.rename 本身（它在同名已存在时会失败）
      if (fs.existsSync(plan.newPath)) {
        return { ok: false, error: '同级已经有一个叫这个名字的文件或文件夹' }
      }
      try {
        await fs.promises.rename(plan.oldPath, plan.newPath)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }

      // 盘上成功了才动配置
      const p = list.find((x) => x.id === id)
      if (p) {
        const past = [plan.oldPath, ...(p.pastPaths ?? [])].filter(
          (v, i, a) => a.indexOf(v) === i // 去重：改回原名再改回去会重复
        )
        p.pastPaths = past.slice(0, 5) // 只用来找历史会话，不是审计日志
        p.path = plan.newPath
        if (plan.renameDisplayName) p.name = path.basename(plan.newPath)
      }
      saveProjects(list)
      return { ok: true, projects: list }
    }
  )
}
