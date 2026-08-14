// Skill 管理面板：主进程这一半只做「读与显示」——列目录、扫 skill、解析 SKILL.md、
// 按分类分组。复制 / 禁用 / 拖到画布编辑 / 给 agent 开的分类写入口是另一半任务，
// 完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
//
// **这个文件绝不写用户的 skill 目录**，只读 SKILL.md。唯一的写操作是「自定义目录
// 列表」，落在 app 自己的配置里（<userData>/skills.json），和用户机器上任何一个
// skill 目录都无关——加/删一条只是记「面板下次该去哪块地方看」，不碰那块地方本身。
//
// **这个模块的 IPC 面为什么不过 fsGuard**：fsGuard.ts 的边界只圈「项目根 + 知识库根」，
// 且它自己在文件头写明了是**写操作**的边界（"文件写操作的路径边界"）。这里全是读，
// 而且要读的正是 fsGuard 白名单之外的地方（`~/.claude/skills` 等，不在任何项目或知识库
// 目录内——这正是本面板存在的意义）。套 guardDir/guardPath 只会把这个面板的核心用途
// 挡死，起不到真正的安全作用：`fs:readDir` / `fs:readTextFile`（main/fs.ts）本来就允许
// 渲染层读任意绝对路径的目录列表和文件内容，早已零限制；本模块的读取能力（列一层子目录、
// 读取其中名为 SKILL.md 的文件）完全被那两个既有通用 IPC 覆盖，不构成新的攻击面。
// 调用方只有本应用自己的渲染进程（contextBridge 暴露给固定的 preload，不接受远程输入），
// 这一点和 fs:readDir 等既有 IPC 的信任前提一致。
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { SkillCategoryGroup, SkillDirAddResult, SkillDirEntry, SkillListResult } from '../../shared/types'
import { resolveBuiltinDirs, mergeDirs, planAddDir, planRemoveDir } from './dirs'
import { scanSkillDir } from './scan'
import { groupByCategory, sanitizeCategoryAssignment } from './category'

/** 面板自己的配置：自定义目录列表 + skill 分类（跟禁用清单以后会共用同一处，
 *  见 design 文档「四、给 agent 的分类口子」）。这一半只往 customDirs 里写，
 *  categories 只读——写入是第二半 MCP 工具的事，字段先留在这份类型里，
 *  免得那边落地时又要挪文件位置。 */
interface StoredConfig {
  customDirs?: SkillDirEntry[]
  categories?: Record<string, string>
}

const cfgFile = (): string => path.join(app.getPath('userData'), 'skills.json')

function loadConfig(): StoredConfig {
  try {
    const v = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as StoredConfig) : {}
  } catch {
    return {} // 没配过 / 文件坏了 —— 都当成「还没有任何自定义目录、没有分类」
  }
}

/** 只覆盖传入的字段，其余原样保留——分类以后要写进同一个文件，不能因为这一半
 *  只管 customDirs 就把已经存在的 categories 字段覆盖掉。 */
function saveConfig(patch: Partial<StoredConfig>): void {
  const next = { ...loadConfig(), ...patch }
  try {
    fs.mkdirSync(path.dirname(cfgFile()), { recursive: true })
    fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2))
  } catch (e) {
    console.error('[skillLibrary] 配置写入失败（自定义目录这次没保存住）', e)
  }
}

function allDirs(): SkillDirEntry[] {
  const builtin = resolveBuiltinDirs(app.getPath('home'))
  const custom = loadConfig().customDirs
  return mergeDirs(builtin, Array.isArray(custom) ? custom : [])
}

/** 列出一个目录下的全部 skill + 按分类分组。这是本模块的核心读操作，见文件头
 *  为什么不需要额外的路径白名单。实际扫盘（含符号链接的坑）在 scan.ts，可单测。 */
function listSkillsIn(dirPath: unknown): SkillListResult {
  const dp = typeof dirPath === 'string' ? dirPath : ''
  if (!dp || !path.isAbsolute(dp)) {
    return { dirPath: dp, ok: false, error: '需要绝对路径', skills: [], categories: [] }
  }

  const scan = scanSkillDir(dp)
  if (!scan.ok) return { dirPath: dp, ok: false, error: scan.error, skills: [], categories: [] }

  const categoryMap = sanitizeCategoryAssignment(loadConfig().categories, new Set(scan.skills.map((s) => s.path)))
  const categories: SkillCategoryGroup[] = groupByCategory(scan.skills, categoryMap)

  return { dirPath: dp, ok: true, skills: scan.skills, categories }
}

export function registerSkillLibraryHandlers(): void {
  ipcMain.handle('skillLibrary:listDirs', (): SkillDirEntry[] => allDirs())

  /** 目录选择器，纯挑路径不落盘——落盘交给 addDir，两步分开和 wiki:pickPath/wiki:init
   *  同一个模式，方便面板在「选完之后要不要再确认一次标签」上留有余地。 */
  ipcMain.handle('skillLibrary:pickDir', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog({
      title: '选择 skill 目录',
      properties: ['openDirectory'],
      buttonLabel: '添加到列表'
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle('skillLibrary:addDir', (_e, newPath: unknown, label?: unknown): SkillDirAddResult => {
    const existing = allDirs()
    const plan = planAddDir(existing, newPath, typeof label === 'string' ? label : undefined)
    if (!plan.ok) return { ok: false, error: plan.error, dirs: existing }
    const cfg = loadConfig()
    const customDirs = [...(Array.isArray(cfg.customDirs) ? cfg.customDirs : []), plan.entry]
    saveConfig({ customDirs })
    return { ok: true, dirs: mergeDirs(resolveBuiltinDirs(app.getPath('home')), customDirs) }
  })

  ipcMain.handle('skillLibrary:removeDir', (_e, id: unknown): SkillDirEntry[] => {
    const cfg = loadConfig()
    const customDirs = planRemoveDir(Array.isArray(cfg.customDirs) ? cfg.customDirs : [], String(id ?? ''))
    saveConfig({ customDirs })
    return mergeDirs(resolveBuiltinDirs(app.getPath('home')), customDirs)
  })

  ipcMain.handle('skillLibrary:list', (_e, dirPath: unknown): SkillListResult => listSkillsIn(dirPath))
}
