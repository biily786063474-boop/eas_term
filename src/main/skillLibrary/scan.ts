// 扫一个目录下的 skill 子目录：判断哪些条目算「目录」、读每个的 SKILL.md。
//
// 从 skillLibrary/index.ts 抽出来是为了能测——这里的 isDirEntry 判断**必须跟随符号链接**，
// 这条规则不测的话很容易被写错。不引 electron：node --test 直接用真实临时目录 + 真实
// symlink 测，跟 wiki/paths.test.ts 用 fs.mkdtempSync 的方式一致（symlink 这类问题
// 只有真实文件系统才测得出来，内存 mock 测不出来）。
import fs from 'fs'
import path from 'path'

import type { SkillInfo } from '../../shared/types'
// .ts 后缀是刻意的：这个文件会被 node --test 直接加载（见 scan.test.ts），
// Node 原生的 ESM 解析不做扩展名推断，省略后缀在 node --test 下会直接 MODULE_NOT_FOUND
// ——tsconfig.node.json 开了 allowImportingTsExtensions 正是为了这种场景。
// index.ts（electron 胶水层，不被 node --test 加载）沿用项目里省略后缀的既有写法即可。
import { parseSkillFrontmatter } from './parse.ts'

/**
 * 一个 readdir 条目算不算「目录」。**必须跟随符号链接**——`Dirent.isDirectory()`
 * 不跟随链接判断，会把「skill 目录其实是个指向别处的软链」误判成「不是目录」而整个漏掉。
 *
 * 这不是假设性的边缘情况：这台用户机器上真实存在
 * `~/.claude/design-skills/motion-picker -> ~/Biily/资产收集/交互动效/skill`，
 * 第一版实现（只认 `ent.isDirectory()`）在真机验证时把这一个漏了——design-skills
 * 应该有 11 个，当时只扫出 10 个。断链（目标不存在）时 statSync 会抛错，按「不是目录」处理，
 * 安全跳过，不让一个坏链接搞崩整次扫描。
 */
function isDirEntry(parentDir: string, ent: fs.Dirent): boolean {
  if (ent.isDirectory()) return true
  if (!ent.isSymbolicLink()) return false
  try {
    return fs.statSync(path.join(parentDir, ent.name)).isDirectory()
  } catch {
    return false
  }
}

/** 一个 skill 子目录 → SkillInfo。读不到 SKILL.md（不存在/无权限/其实是文件）
 *  返回 null，调用方跳过这一项——不能让一个坏 skill 目录拖垮整个列表。 */
export function readSkillDir(parentDir: string, entryName: string): SkillInfo | null {
  const skillPath = path.join(parentDir, entryName)
  let raw: string
  try {
    raw = fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
  try {
    const { name, description } = parseSkillFrontmatter(raw)
    if (name) return { path: skillPath, name, description: description ?? '' }
    // SKILL.md 在、但 frontmatter 解析不出 name（格式不对/缺字段）——
    // 目录本身是真实存在的 skill，回落成目录名比整条隐藏掉更有用
    return { path: skillPath, name: entryName, description: description ?? '', fallback: true }
  } catch {
    // parseSkillFrontmatter 本身已经很防御了，这层兜底防的是「万一还有没想到的怪格式」
    return { path: skillPath, name: entryName, description: '', fallback: true }
  }
}

export type ScanResult = { ok: true; skills: SkillInfo[] } | { ok: false; error: string }

/**
 * 扫一个目录下所有 skill 子目录。
 *
 * 目录本身读不出来（不存在/无权限/其实是个文件）→ `ok:false`，error 给出人能看懂的原因。
 * 单个子目录没有 SKILL.md、或 SKILL.md 解析失败 → 跳过那一项，不影响其余项
 * （见 readSkillDir）——这是两种不同粒度的降级，前者是「整个目录读不了」，
 * 后者是「这一个 skill 有问题」，不能混成一种处理。
 */
export function scanSkillDir(dirPath: string): ScanResult {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    const error =
      err.code === 'ENOENT'
        ? '这个目录不存在'
        : err.code === 'EACCES' || err.code === 'EPERM'
          ? '没有权限读取这个目录'
          : err.code === 'ENOTDIR'
            ? '这不是一个文件夹'
            : (err.message ?? '读取失败')
    return { ok: false, error }
  }

  const skills: SkillInfo[] = []
  for (const ent of entries) {
    // 隐藏目录（.git 等）不当 skill 扫
    if (ent.name.startsWith('.')) continue
    if (!isDirEntry(dirPath, ent)) continue
    const info = readSkillDir(dirPath, ent.name)
    if (info) skills.push(info)
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { ok: true, skills }
}
