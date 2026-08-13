import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Project, ProjectStatus } from '../shared/types'
import { planRename } from './projectPaths'
import { wikiPath } from './wiki/paths'
import { realResolve } from './fsGuard'
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
      // projectPaths.ts 顶部注释）。这里在动盘之前补一道等价解析：借 fsGuard.ts 的
      // realResolve 把两边都落到 realpath 之后再判一次「知识库是不是在这个项目里」，
      // 是就拒绝。
      if (wp) {
        const realOld = realResolve(plan.oldPath)
        const realWiki = realResolve(wp)
        if (realWiki === realOld || realWiki.startsWith(realOld + path.sep)) {
          return {
            ok: false,
            error:
              '知识库（经软链解析后）就在这个项目里。知识库路径存在另一份配置里、不会跟着改名走，改了会让它失联——先把知识库挪出去，或者换个项目改'
          }
        }
      }

      // 盘上先改。这道 existsSync 不是可有可无的人话包装，是真正的保护：
      // POSIX rename(2) 在目标恰好是个空目录时会静默替换掉它、不报错，
      // fs.promises.rename 原样透传这个语义——没有这道前置检查，目标正好是个空文件夹
      // 时会被悄悄顶替，而不是像想象中那样「重名了 rename 自己会失败」。
      if (fs.existsSync(plan.newPath)) {
        return { ok: false, error: '同级已经有一个叫这个名字的文件或文件夹' }
      }
      try {
        await fs.promises.rename(plan.oldPath, plan.newPath)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }

      // 盘上成功了才动配置。上面那个 await 期间，别的 projects:* 调用
      // （remove / setStatus / rename）完全可能已经落过盘——继续用 await 之前读到的
      // 那份旧 list 整体写回，会把它们的改动一起覆盖掉。这里重新读一遍最新的，
      // 用 id 重新 find（不复用上面 list 里那个对象引用），「读—改—写」之间
      // 不再跨任何 await，避免同样的问题在这里重演。
      const freshList = loadProjects()
      const p = freshList.find((x) => x.id === id)
      if (p) {
        const past = [plan.oldPath, ...(p.pastPaths ?? [])].filter(
          (v, i, a) => a.indexOf(v) === i // 去重：改回原名再改回去会重复
        )
        p.pastPaths = past.slice(0, 5) // 只用来找历史会话，不是审计日志
        p.path = plan.newPath
        if (plan.renameDisplayName) p.name = path.basename(plan.newPath)
      }
      try {
        saveProjects(freshList)
      } catch (err) {
        // 盘上已经改名成功，只是这一步没能落盘——全函数里唯一一种「盘/配置不一致」
        // 的失败，必须走同一个结构化返回把话说清楚，不能变成一个未捕获的 reject
        // （调用方是按 { ok, error } 的类型签名写 if(!r.ok) 的，reject 永远进不了那条分支，
        // 表现为一次没人接住的 promise rejection，用户什么提示都看不到）。
        // 不做自动回滚：把已经改名的目录再改回去，失败时只会制造更糟的中间态。
        return {
          ok: false,
          error: `文件夹已经改名成功，但保存项目列表失败（${err instanceof Error ? err.message : String(err)}）——请检查磁盘空间，必要时重启应用`
        }
      }
      return { ok: true, projects: freshList }
    }
  )
}
