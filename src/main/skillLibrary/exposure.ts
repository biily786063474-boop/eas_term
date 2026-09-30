// skill「自动发现」开关：哪些 skill 的 name + description 不进模型上下文。
//
// 关掉的 skill 模型自己看不到，只有用户在输入框 `/` 菜单里点名时才生效
// （那条路插入的是 SKILL.md 的路径，模型直接读文件，不依赖 CLI 的 skill 注册）。
// 设计与两家 CLI 的探针结果：docs/superpowers/specs/2026-09-30-skill-exposure-toggle-design.md
//
// 落法（只作用于 Eas-Term 起的 AI 对话会话，**不写用户的 skill 文件与 CLI 配置**）：
//   · Claude：`--settings` 里的 `skillOverrides[名字] = "user-invocable-only"`（**按名字**）
//   · Codex：`-c skills.config=[{path=<SKILL.md>,enabled=false}]`（**按路径**）
//
// **不 import electron**：home / codexHome / userData 由调用方传进来，node --test 直接跑。
import fs from 'fs'
import path from 'path'

import { scanSkillDir } from './scan.ts'
import {
  EXPOSURE_EXEMPT,
  isSkillExposed,
  type Exposure,
  type ExposureConfig
} from '../../shared/skillExposure.ts'

export type { Exposure, ExposureConfig } from '../../shared/skillExposure.ts'

export function sanitizeExposureConfig(raw: unknown): ExposureConfig {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const exposure: Record<string, Exposure> = {}
  const m = o.exposure
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (path.isAbsolute(k) && (v === 'on' || v === 'off')) exposure[k] = v
    }
  }
  return { exposeByDefault: o.exposeByDefault !== false, exposure }
}

/** 改单个 skill 的设置：`null` = 复位成跟随全局。与全局相同的值也按「复位」处理，
 *  免得全局翻转之后留下一堆看起来是例外、其实和全局一致的旧条目。 */
export function applyExposure(
  cfg: ExposureConfig,
  skillPath: string,
  want: Exposure | null
): Record<string, Exposure> {
  const next = { ...cfg.exposure }
  const followsGlobal = want === null || (want === 'on') === cfg.exposeByDefault
  if (followsGlobal) delete next[skillPath]
  else next[skillPath] = want
  return next
}

export interface ScannedDir {
  skills: { path: string; name: string }[]
}

const trimSep = (p: string): string => p.replace(/[/\\]+$/, '')
const dirNameOf = (p: string): string => path.basename(trimSep(p))

/** Claude：被隐藏 skill 的名字。frontmatter 名与目录名不一致时两个都给 ——
 *  `skillOverrides` 按名字认，而我们没法确定 CLI 取的是哪一个；多出来的键指不到 skill 就不生效。 */
export function hiddenClaudeNames(cfg: ExposureConfig, dirs: ScannedDir[]): string[] {
  const out = new Set<string>()
  for (const d of dirs) {
    for (const s of d.skills) {
      const dn = dirNameOf(s.path)
      if (isSkillExposed(cfg, s.path)) continue
      if (EXPOSURE_EXEMPT.has(s.name)) continue
      out.add(dn)
      if (s.name) out.add(s.name)
    }
  }
  return [...out].sort()
}

/** Codex：被隐藏 skill 的 SKILL.md 路径（`skills.config` 的 path 选择器认它）。
 *  realpath 与原路径不同时（软链）两个都给，理由同上。 */
export function hiddenCodexPaths(
  cfg: ExposureConfig,
  dirs: ScannedDir[],
  real: (p: string) => string = (p) => p
): string[] {
  const out = new Set<string>()
  for (const d of dirs) {
    for (const s of d.skills) {
      if (isSkillExposed(cfg, s.path)) continue
      const md = path.join(trimSep(s.path), 'SKILL.md')
      out.add(md)
      const r = real(md)
      if (r) out.add(r)
    }
  }
  return [...out].sort()
}

// ── 下面碰磁盘：起会话时同步调用（agentChat:start 是同步 handler，不许 await）────────

export function readExposureConfig(userData: string): ExposureConfig {
  try {
    return sanitizeExposureConfig(JSON.parse(fs.readFileSync(path.join(userData, 'skills.json'), 'utf8')))
  } catch {
    return sanitizeExposureConfig({})
  }
}

function scanMany(dirs: string[]): ScannedDir[] {
  const out: ScannedDir[] = []
  for (const d of [...new Set(dirs)]) {
    const r = scanSkillDir(d)
    if (r.ok) out.push({ skills: r.skills })
  }
  return out
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return ''
  }
}

export interface HiddenSkillsInput {
  cli: string
  userData: string
  home: string
  codexHome?: string
  cwd: string
  /** 项目根（worktree 里的 cwd 剥回去之后）；与 cwd 相同时不重复扫 */
  root: string
}

/** 这次会话要隐藏哪些 skill。全开（没有任何 skill 被关）时返回空数组 —— 调用方据此不拼任何参数。
 *  只扫 CLI 自己会加载的目录：`~/.claude/design-skills` 这类面板里登记、但 CLI 不扫的目录
 *  本来就不在模型清单里，不用管。插件 skill 不在这里（键格式未实测，见设计稿「已知限制」）。 */
export function hiddenSkillsFor(i: HiddenSkillsInput): { claudeNames: string[]; codexPaths: string[] } {
  const cfg = readExposureConfig(i.userData)
  const anyOff = !cfg.exposeByDefault || Object.values(cfg.exposure).includes('off')
  if (!anyOff) return { claudeNames: [], codexPaths: [] }
  if (i.cli === 'claude') {
    const dirs = [
      path.join(i.home, '.claude', 'skills'),
      path.join(i.root, '.claude', 'skills'),
      path.join(i.cwd, '.claude', 'skills')
    ]
    return { claudeNames: hiddenClaudeNames(cfg, scanMany(dirs)), codexPaths: [] }
  }
  if (i.cli === 'codex') {
    const dirs = [
      path.join(i.codexHome || path.join(i.home, '.codex'), 'skills'),
      path.join(i.home, '.agents', 'skills'),
      path.join(i.root, '.agents', 'skills'),
      path.join(i.cwd, '.agents', 'skills')
    ]
    return { claudeNames: [], codexPaths: hiddenCodexPaths(cfg, scanMany(dirs), safeReal) }
  }
  return { claudeNames: [], codexPaths: [] }
}
