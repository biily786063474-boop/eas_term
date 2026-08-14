// Skill 管理面板：主进程侧的 IPC 面——列目录、扫 skill、解析 SKILL.md、按分类分组，
// 以及复制 skill / 临时禁用 / 编辑 skill 文件 / 给 agent 开的分类写入口。
// 完整背景见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md。
//
// ── 这个模块碰用户硬盘的边界（读一套、写一套，别混着看）──────────────────
//
// **读**（listDirs / list / listAll）：只列一层子目录、只读其中名为 SKILL.md 的文件。
// 不过 fsGuard——fsGuard.ts 的边界只圈「项目根 + 知识库根」，且它自己写明了是**写操作**
// 的边界；而这里要读的正是那个白名单之外的地方（`~/.claude/skills` 等，不在任何项目或
// 知识库目录内，这正是本面板存在的意义）。套 guardDir/guardPath 只会把面板的核心用途挡死，
// 也起不到真正的安全作用：`fs:readDir` / `fs:readTextFile`（main/fs.ts）本来就允许渲染层
// 读任意绝对路径，本模块的读取能力完全被那两个既有 IPC 覆盖，不构成新的攻击面。
//
// **写**（copySkill / writeFile）：**会真的写用户的 skill 目录**——复制功能就是干这个的。
// 第一半这里曾写着「这个文件绝不写用户的 skill 目录」，那句话现在只对上面那半成立，
// 留着会骗人，所以改掉了。写操作有它自己的、比 fsGuard 更窄的边界，
// 论证和实现都在 write.ts 的文件头 + skillWriteRoots()：
// **只能写「面板里已登记的 skill 目录」和「已注册项目的 <项目>/.claude/skills」**，
// 且落点必须是那些根之内的 skill 子目录。不改 fsGuard 的边界，也不绕过它。
//
// **只写 app 自己配置、不碰硬盘 skill 的**（addDir / removeDir / setDisabled /
// setCategories）：全部落在 <userData>/skills.json。禁用与分类刻意走这条路——
// 「不动硬盘上的 skill 文件」是用户拍板的决定（design 文档 §六 第 1 条 / §四）。
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type {
  SkillCategorizeResult,
  SkillCategoryGroup,
  SkillCopyResult,
  SkillDirAddResult,
  SkillDirEntry,
  SkillDisableResult,
  SkillLibrarySnapshot,
  SkillListResult
} from '../../shared/types'
import { realResolve } from '../fsGuard'
import { resolveBuiltinDirs, mergeDirs, planAddDir, planRemoveDir } from './dirs'
import { scanSkillDir } from './scan'
import { groupByCategory, sanitizeCategoryAssignment, validateCategoryBatch } from './category'
import { sanitizeDisabled, applyDisabled } from './disabled'
import { copySkillDir, planCopySkill, planWriteSkillFile } from './write'

/** 面板自己的配置：自定义目录列表 + skill 分类 + 临时禁用清单，同一份文件。
 *  三样都跟用户硬盘上的 skill 文件无关——加/删目录只是记「面板下次去哪看」，
 *  分类和禁用是本软件视图里的标记。 */
interface StoredConfig {
  customDirs?: SkillDirEntry[]
  categories?: Record<string, string>
  disabled?: string[]
}

/** 项目根列表：跟 fsGuard 一样直接读 projects.json，不从 projects.ts 导入——
 *  边界必须在任何时候都能独立算出来，不依赖别处的模块初始化顺序。 */
function projectRoots(): string[] {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'projects.json'), 'utf8')
    const list = JSON.parse(raw) as { path?: string }[]
    if (!Array.isArray(list)) return []
    return list.map((p) => p?.path).filter((p): p is string => typeof p === 'string' && !!p)
  } catch {
    return []
  }
}

/**
 * 允许写的 skill 根（全部 realpath 过）：已登记的 skill 目录 + 每个项目的
 * `<项目>/.claude/skills`。后者要算进来，是因为面板选中项目 Frame 时看的就是它，
 * 「把全局 skill 复制进这个项目」是这个功能最常见的用法之一。
 *
 * realpath：symlink 会让任何字符串前缀比对形同虚设。用 fsGuard 里既有的 realResolve
 * （它能处理「目标还不存在，退到最深的真实祖先」这种情况），不另写一份。
 */
function skillWriteRoots(): string[] {
  const roots = [
    ...allDirs().map((d) => d.path),
    ...projectRoots().map((p) => path.join(p, '.claude', 'skills'))
  ]
  return [...new Set(roots.map(realResolve))]
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

/** 只覆盖传入的字段，其余原样保留——customDirs / categories / disabled 三样共用
 *  同一份文件，改其中一样绝不能把另外两样冲掉。 */
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

/** 列出一个目录下的全部 skill + 按分类分组 + 哪些被临时禁用。这是本模块的核心读操作，
 *  见文件头为什么不需要额外的路径白名单。实际扫盘（含符号链接的坑）在 scan.ts，可单测。 */
function listSkillsIn(dirPath: unknown): SkillListResult {
  const dp = typeof dirPath === 'string' ? dirPath : ''
  if (!dp || !path.isAbsolute(dp)) {
    return { dirPath: dp, ok: false, error: '需要绝对路径', skills: [], categories: [], disabled: [] }
  }

  const scan = scanSkillDir(dp)
  if (!scan.ok) return { dirPath: dp, ok: false, error: scan.error, skills: [], categories: [], disabled: [] }

  const cfg = loadConfig()
  const present = new Set(scan.skills.map((s) => s.path))
  const categoryMap = sanitizeCategoryAssignment(cfg.categories, present)
  const categories: SkillCategoryGroup[] = groupByCategory(scan.skills, categoryMap)
  // 只回这个目录里的那部分——面板一次只显示一个目录，把整份清单发过去没意义
  const disabled = sanitizeDisabled(cfg.disabled).filter((p) => present.has(p))

  return { dirPath: dp, ok: true, skills: scan.skills, categories, disabled }
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

  // ── 写：复制一个 skill 到另一个 skill 目录 ─────────────────────────────
  // 这是本模块**唯一会往用户 skill 目录里放新东西**的口子。边界见 write.ts 文件头。
  // 重名一律拒绝、不覆盖不改名（design 文档 §六 第 4 条）；
  // 落盘走「临时名 → 改名」，失败不留半个残缺的 skill 目录。
  ipcMain.handle('skillLibrary:copySkill', (_e, srcPath: unknown, destDirPath: unknown): SkillCopyResult => {
    const src = typeof srcPath === 'string' ? srcPath : ''
    const destDir = typeof destDirPath === 'string' ? destDirPath : ''
    if (!src || !destDir) return { ok: false, error: '缺少源或目标' }
    if (!path.isAbsolute(src) || !path.isAbsolute(destDir)) return { ok: false, error: '只接受绝对路径' }

    const srcReal = realResolve(src)
    const destDirReal = realResolve(destDir)
    let srcHasSkillMd = false
    try {
      srcHasSkillMd = fs.statSync(srcReal).isDirectory() && fs.statSync(path.join(srcReal, 'SKILL.md')).isFile()
    } catch {
      srcHasSkillMd = false
    }
    const destExists = fs.existsSync(path.join(destDirReal, path.basename(srcReal)))
    const plan = planCopySkill({ srcReal, srcHasSkillMd, destDirReal, roots: skillWriteRoots(), destExists })
    if (!plan.ok) return { ok: false, error: plan.error, duplicate: plan.duplicate }

    // 目标目录本身可能还不存在（项目里第一次放 skill），建出来再拷
    try {
      fs.mkdirSync(destDirReal, { recursive: true })
    } catch (e) {
      return { ok: false, error: `目标目录建不出来：${(e as Error).message}` }
    }
    const r = copySkillDir(srcReal, plan.dest)
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, dest: plan.dest }
  })

  // ── 只写 app 自己的配置：临时禁用 / 恢复 ──────────────────────────────
  // **不动硬盘上的 skill 文件**（design 文档 §六 第 1 条，用户拍板过）。
  // 代价（已知并接受）：CLI 自己仍会加载它，禁用只在本软件的视图里生效——
  // 这句话要在面板上说给用户看，见 CanvasSkillPanel 的 .skl-note。
  ipcMain.handle('skillLibrary:setDisabled', (_e, skillPath: unknown, want: unknown): SkillDisableResult => {
    const p = typeof skillPath === 'string' ? skillPath.trim() : ''
    if (!p || !path.isAbsolute(p)) return { ok: false, error: '需要 skill 的绝对路径', disabled: [] }
    const cur = sanitizeDisabled(loadConfig().disabled)
    const next = applyDisabled(cur, p, want !== false)
    saveConfig({ disabled: next })
    return { ok: true, disabled: next }
  })

  // ── 写：编辑一个 skill 里的文件（文件树拖到画布上之后的保存路径）──────────
  // 比复制更窄：只能改**已经存在的**、位于某个 skill 子目录里的文件。
  // 为什么不走 fs:writeTextFile：那条路过 fsGuard，边界是「项目根 + 知识库根」，
  // 全局 skill 目录不在里面——保存会失败。正确做法是本模块给出自己的窄边界（见 write.ts），
  // 而不是去放宽 fsGuard（那会把所有写操作的边界一起放宽）。
  ipcMain.handle(
    'skillLibrary:writeFile',
    (_e, filePath: unknown, content: unknown): { ok: boolean; error?: string } => {
      const p = typeof filePath === 'string' ? filePath : ''
      if (!p || !path.isAbsolute(p)) return { ok: false, error: '只接受绝对路径' }
      if (typeof content !== 'string') return { ok: false, error: '内容必须是文本' }
      const fileReal = realResolve(p)
      let isExistingFile = false
      try {
        isExistingFile = fs.statSync(fileReal).isFile()
      } catch {
        isExistingFile = false
      }
      const plan = planWriteSkillFile({ fileReal, roots: skillWriteRoots(), isExistingFile })
      if (!plan.ok) return { ok: false, error: plan.error }
      try {
        fs.writeFileSync(plan.path, content, 'utf8')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '写入失败' }
      }
    }
  )

  // ── 给 agent 的分类口子：读全景 ────────────────────────────────────────
  // 面板一次只看一个目录，agent 要整理分类必须看全量（含项目 skill 目录）。
  // 只读，不写任何东西。
  ipcMain.handle('skillLibrary:listAll', (): SkillLibrarySnapshot => {
    const cfg = loadConfig()
    const disabledSet = new Set(sanitizeDisabled(cfg.disabled))
    const dirs: SkillLibrarySnapshot['dirs'] = []
    const skills: SkillLibrarySnapshot['skills'] = []
    const seen = new Set<string>()

    const projectDirs: SkillDirEntry[] = projectRoots().map((root) => ({
      id: 'project:' + root,
      label: `项目 · ${path.basename(root)}`,
      path: path.join(root, '.claude', 'skills'),
      builtin: false
    }))

    for (const d of [...allDirs(), ...projectDirs]) {
      const scan = scanSkillDir(d.path)
      dirs.push({
        id: d.id,
        label: d.label,
        path: d.path,
        builtin: d.builtin,
        ok: scan.ok,
        ...(scan.ok ? {} : { error: scan.error })
      })
      if (!scan.ok) continue
      for (const s of scan.skills) {
        if (seen.has(s.path)) continue // 两个登记目录指向同一处（symlink）时不重复报
        seen.add(s.path)
        skills.push({
          path: s.path,
          name: s.name,
          description: s.description,
          dir: d.path,
          category: null, // 下面统一填，避免每个目录都 sanitize 一遍
          disabled: disabledSet.has(s.path)
        })
      }
    }
    const assignment = sanitizeCategoryAssignment(cfg.categories, seen)
    for (const s of skills) s.category = assignment[s.path] ?? null
    return { dirs, skills }
  })

  // ── 给 agent 的分类口子：写回一批分类 ──────────────────────────────────
  // 严格 schema：分类名非空且有长度上限、一个 skill 只能属于一个分类、
  // **引用了不存在的 skill 就拒绝整批**（design 文档 §四，硬要求）。
  // 校验逻辑在 category.ts 的 validateCategoryBatch，有单测。
  // 分类只写 app 自己的配置，**不写进用户的 skill 目录**。
  ipcMain.handle('skillLibrary:setCategories', (_e, raw: unknown): SkillCategorizeResult => {
    const valid = new Set<string>()
    const projectSkillDirs = projectRoots().map((root) => path.join(root, '.claude', 'skills'))
    for (const dirPath of [...allDirs().map((d) => d.path), ...projectSkillDirs]) {
      const scan = scanSkillDir(dirPath)
      if (scan.ok) for (const s of scan.skills) valid.add(s.path)
    }
    const v = validateCategoryBatch(raw, valid)
    if (!v.ok) return { ok: false, error: v.error }

    // patch 语义：这批没提到的 skill 保持原样。agent 通常只整理一部分，
    // 整份覆盖会让它每次都得把全部分类重发一遍，漏一个就等于把那个 skill 的分类抹了。
    const cur = sanitizeCategoryAssignment(loadConfig().categories, valid)
    saveConfig({ categories: { ...cur, ...v.assignment } })
    return { ok: true, applied: Object.keys(v.assignment).length }
  })
}
