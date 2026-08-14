// skill 目录集合：内置默认 + 用户自己加的自定义目录。
//
// **目录集合不能写死**——用户在这台机器上已经把 skill 从 `~/.claude/skills` 搬到了
// `~/.claude/design-skills`（11 个）、`~/.claude/motion-skills`（20 个），
// 由 design-router / motion-router 两个 skill 按需分发。那不是异常状态，是他刻意的
// 渐进式披露组织方式，面板必须照顾到——这正是「CLI 按钮可以选目录、且目录列表
// 可以再加」这条需求的由来（见 docs/superpowers/specs/2026-08-14-skill管理面板-design.md）。
//
// 这份文件不引 electron：home 目录由调用方（skillLibrary/index.ts，那边真的会
// `app.getPath('home')`）传进来，这里只管路径拼接和数据合并，node --test 能直接测。
import fs from 'fs'
import path from 'path'

import type { SkillDirEntry } from '../../shared/types'

/** 内置默认目录：这台用户机器上实测过的真实分布（见 design 文档「一、现状」）。
 *  顺序即展示顺序——全局 Claude 放最前面，因为多数场景查的就是它。 */
const BUILTIN_SPECS: { id: string; label: string; relSegments: string[] }[] = [
  { id: 'claude-global', label: 'Claude', relSegments: ['.claude', 'skills'] },
  { id: 'codex-global', label: 'Codex', relSegments: ['.codex', 'skills'] },
  { id: 'design-skills', label: 'design-skills', relSegments: ['.claude', 'design-skills'] },
  { id: 'motion-skills', label: 'motion-skills', relSegments: ['.claude', 'motion-skills'] }
]

export function resolveBuiltinDirs(home: string): SkillDirEntry[] {
  return BUILTIN_SPECS.map((b) => ({
    id: b.id,
    label: b.label,
    path: path.join(home, ...b.relSegments),
    builtin: true
  }))
}

/** 内置在前、自定义在后；自定义里如果 id 撞了内置（正常不会发生，防御一下）
 *  就丢掉撞车的那条——内置的优先级更高，不能被一条自定义配置顶掉。 */
export function mergeDirs(builtin: SkillDirEntry[], custom: SkillDirEntry[]): SkillDirEntry[] {
  const builtinIds = new Set(builtin.map((d) => d.id))
  return [...builtin, ...custom.filter((d) => !builtinIds.has(d.id))]
}

export type AddDirResult = { ok: true; entry: SkillDirEntry } | { ok: false; error: string }

/**
 * 校验并生成「添加一个自定义 skill 目录」的结果。**不落盘**——落盘是调用方
 * （skillLibrary/index.ts）的事，这里只判断这条请求站不站得住脚，纯函数、可测。
 *
 * id 直接取 `'custom:' + realpath`：两个不同的字符串路径只要指向同一个真实目录
 * （symlink、`..` 没归一化…），realpath 之后就是同一个 id，去重和「已经加过」的
 * 判断顺带就做完了，不需要再单独维护一份 realpath 比对逻辑。
 */
export function planAddDir(existing: SkillDirEntry[], newPath: unknown, label?: string): AddDirResult {
  if (typeof newPath !== 'string' || !newPath.trim()) return { ok: false, error: '路径不能为空' }
  if (!path.isAbsolute(newPath)) return { ok: false, error: '只接受绝对路径' }

  let real: string
  try {
    const st = fs.statSync(newPath)
    if (!st.isDirectory()) return { ok: false, error: '这不是一个文件夹' }
    real = fs.realpathSync(newPath)
  } catch {
    return { ok: false, error: '这个目录不存在或读不到' }
  }

  const id = 'custom:' + real
  if (existing.some((d) => d.id === id)) return { ok: false, error: '这个目录已经在列表里了' }

  const trimmedLabel = label?.trim()
  return {
    ok: true,
    entry: { id, label: trimmedLabel || path.basename(real) || real, path: real, builtin: false }
  }
}

/** 删除一条自定义目录。内置目录不可删——静默忽略（UI 本来就不会给内置目录挂删除按钮），
 *  不报错：调用方拿到的永远是「删除之后应该长什么样」，不用先判断这条是不是内置的。 */
export function planRemoveDir(customDirs: SkillDirEntry[], id: string): SkillDirEntry[] {
  return customDirs.filter((d) => d.id !== id)
}
