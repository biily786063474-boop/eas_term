// Agent 角色：把每次开终端要重复交代的东西固化下来。
//
// 角色不是人设。「你是一个资深架构师」这种提示词是最弱的杠杆——同一个模型给不给
// 这句话，行为差异远小于「你能不能写文件」。真正改变产出的是三样：
//   · 用什么模型 / 什么思考档位
//   · 产出物是什么形状、落在哪
//   · 什么算做完
// 所以一个角色是一份**可执行的配置**，不是一段文案。
//
// 落点：~/.eas/roles.json。内置角色见下方 BUILTIN_ROLES（数量以那个数组为准，别在注释里写死
// —— 这里原先写「7 个」，加了一个之后就一直骗人）。用户可改可加可删（删了内置的能一键恢复）。
// 存档 version 2（2026-09-05）：tools 字段换成 caps/raw，读到 v1 时逐条迁移并在下次 save 时写回。
// 读的时候逐条 sanitize —— 这文件用户和外部工具都能改，一条坏数据不该让整个角色系统失效
// （同 canvasSlice 里 sanitizeCanvas 的思路，那个教训已经付过学费）。
// ⚠️ **反向不兼容**：v2 存档被 0.4.78 及更早版本读到会把 caps 整份丢掉（那版按 v1 清洗且不看
// version）。表现是勘探员/验官的写保护、画师的生图限制静默解除而界面一切正常——回滚旧版前
// 先从 .eas-backup 取回那份存档。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import type { AgentRole } from '../shared/types'
import { BUILTIN_ROLES } from './builtinRoles.ts'
import { ROLES_FILE_VERSION, sanitizeRoles } from './rolesSchema'

// 内置角色数组本体搬去了 builtinRoles.ts（electron-free，供 builtinRoles.test.ts 裸跑）；
// 这里继续 re-export，别处 import { BUILTIN_ROLES } from './roles' 不用改。
export { BUILTIN_ROLES }

const file = (): string => path.join(os.homedir(), '.eas', 'roles.json')

/**
 * 把「存档里没有、但当前版本内置」的角色补进来。
 *
 * 不这样做的话，新版本加一个内置角色（比如这次的「全流程」），对**已经存过档**的用户
 * 是永远不可见的——load() 只要读到非空文件就直接用它，BUILTIN_ROLES 里新加的那条
 * 无从触达。不能指望用户自己想起来去点「恢复内置」，那等于新功能默认对老用户隐藏。
 *
 * 只追加、不改已有项的顺序和内容：新角色统一接在数组末尾，然后立刻写回磁盘一次。
 * 关键在这个「写回」——之后每次 load() 读到的就是包含新角色的那份存档，
 * missing 算出来是空的，直接原样返回，不会再重新计算出别的位置。
 * 用户在「管理角色」里怎么拖过的顺序，也不会被这一步打乱。
 */
function reconcileBuiltins(saved: AgentRole[]): AgentRole[] {
  const have = new Set(saved.map((r) => r.id))
  const missing = BUILTIN_ROLES.filter((r) => !have.has(r.id))
  if (!missing.length) return saved
  const next = [...saved, ...missing.map((r) => ({ ...r, builtin: true }))]
  try {
    save(next)
  } catch {
    /* 这次写不进去就先用着，下次启动再补 */
  }
  return next
}

function load(): AgentRole[] {
  try {
    const parsed = sanitizeRoles(JSON.parse(fs.readFileSync(file(), 'utf8')))
    if (parsed.length) return reconcileBuiltins(parsed)
  } catch {
    /* 没这个文件（第一次用）或读坏了 */
  }
  return BUILTIN_ROLES.map((r) => ({ ...r, builtin: true }))
}

function save(roles: AgentRole[]): void {
  const f = file()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  if (fs.existsSync(f)) {
    try {
      fs.copyFileSync(f, f + '.eas-backup')
    } catch {
      /* 备份失败不阻断 */
    }
  }
  fs.writeFileSync(f, JSON.stringify({ version: ROLES_FILE_VERSION, roles }, null, 2) + '\n')
}

export function registerRoleHandlers(): void {
  ipcMain.handle('roles:list', () => load())

  /**
   * 把某个角色的契约落成文件，返回路径。
   *
   * Claude 有 --append-system-prompt-file，用文件比把整段契约塞进命令行强：
   * 命令行里那样会变成一条又长又难读的命令，而且契约里的换行/引号都要转义。
   * （Codex 没有对应的文件参数，那边只能内联，所以会压成单行。）
   */
  ipcMain.handle('roles:contractFile', (_e, roleId: string): string | null => {
    const role = load().find((r) => r.id === roleId)
    if (!role?.contract.trim()) return null
    try {
      const dir = path.join(app.getPath('userData'), 'role-prompts')
      fs.mkdirSync(dir, { recursive: true })
      // 文件名只用 id，且 id 已被 sanitize 过；再挡一层路径穿越
      const f = path.join(dir, role.id.replace(/[^\w-]/g, '_') + '.txt')
      fs.writeFileSync(f, role.contract)
      return f
    } catch {
      return null
    }
  })

  ipcMain.handle('roles:save', (_e, roles: unknown) => {
    const clean = sanitizeRoles({ roles })
    if (!clean.length) return { ok: false, error: '没有有效角色，拒绝写入' }
    try {
      save(clean)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return { ok: true, roles: clean }
  })

  /** 恢复内置角色：用户自建的保留，同 id 的内置项覆盖回原样 */
  ipcMain.handle('roles:reset', () => {
    const cur = load()
    const builtinIds = new Set(BUILTIN_ROLES.map((r) => r.id))
    const mine = cur.filter((r) => !builtinIds.has(r.id))
    const next = [...BUILTIN_ROLES.map((r) => ({ ...r, builtin: true })), ...mine]
    try {
      save(next)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    return { ok: true, roles: next }
  })
}
