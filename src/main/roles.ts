// Agent 角色：把每次开终端要重复交代的东西固化下来。
//
// 角色不是人设。「你是一个资深架构师」这种提示词是最弱的杠杆——同一个模型给不给
// 这句话，行为差异远小于「你能不能写文件」。真正改变产出的是三样：
//   · 用什么模型 / 什么思考档位
//   · 产出物是什么形状、落在哪
//   · 什么算做完
// 所以一个角色是一份**可执行的配置**，不是一段文案。
//
// 落点：~/.eas/roles.json。内置 7 个角色，用户可改可加可删（删了内置的能一键恢复）。
// 读的时候逐条 sanitize —— 这文件用户和外部工具都能改，一条坏数据不该让整个角色系统失效
// （同 canvasSlice 里 sanitizeCanvas 的思路，那个教训已经付过学费）。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import type { AgentRole } from '../shared/types'

const file = (): string => path.join(os.homedir(), '.eas', 'roles.json')

/**
 * 内置 7 个角色。分两类：
 *   主序列（main）—— 沿项目生命周期推进，通常按顺序用
 *   产出型（output）—— 横切，任何阶段都能叫
 *
 * contract 是拼进启动命令的职责契约。写法上刻意避开人设，只讲**产出、落点、完成判据**，
 * 因为那才是模型照着做了能被验证的部分。
 */
export const BUILTIN_ROLES: AgentRole[] = [
  {
    id: 'scout',
    name: '勘探员',
    desc: '前期调研 + 架构，只读不写代码',
    group: 'main',
    color: '#7dd3fc',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
    tools: { deny: ['Write', 'Edit', 'NotebookEdit'] },
    contract: [
      '你这一轮的职责是调研与架构设计，不是实现。',
      '产出：一份 Markdown 或 HTML 文档，放在项目的 docs/ 下。',
      '完成判据：文档里必须有**多于一个**方案并说明取舍——只给一个方案的不算调研。',
      '不要修改业务代码。要动手实现时，提醒用户换「工匠」角色开新会话。'
    ].join('\n')
  },
  {
    id: 'builder',
    name: '工匠',
    desc: '实现。唯一有写代码权限的角色',
    group: 'main',
    color: '#6ee7b7',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
    tools: {},
    contract: [
      '你这一轮的职责是实现。',
      '完成判据：改完代码必须构建通过，并且**亲眼验证过效果**才能说「已修复」——',
      'UI/交互类改动要真的打开应用看一眼。没验证的部分要明确说「未验证」。',
      '构建失败、测试失败一律原样报告，不粉饰。',
      '如果用户说「还是不对」，先全局搜索是否存在重复或冲突的旧逻辑，不要在补丁上叠补丁。'
    ].join('\n')
  },
  {
    id: 'inspector',
    name: '验官',
    desc: '分发前审查 / 回归，禁改代码',
    group: 'main',
    color: '#fcd34d',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
    tools: { deny: ['Write', 'Edit', 'NotebookEdit'] },
    contract: [
      '你这一轮的职责是审查，不是修复。自己改自己审等于没审。',
      '产出：一份风险清单，放在项目的 docs/ 下。',
      '完成判据：每一条都要写清**会在什么情况下挂**，并给出复现路径；',
      '没有复现路径的猜测要标注为「未验证」。',
      '不要修改任何代码。发现问题就记下来，交给用户决定谁来修。'
    ].join('\n')
  },
  {
    id: 'prototyper',
    name: '原型师',
    desc: '出界面稿，不碰生产代码',
    group: 'main',
    color: '#c4b5fd',
    kind: 'auto',
    model: { claude: 'sonnet' },
    effort: { claude: 'medium', codex: 'medium' },
    tools: {},
    contract: [
      '你这一轮的职责是出界面原型。',
      '产出：完整 standalone 的 HTML（含 doctype/head/body，内联样式，零外部依赖，断网可开），',
      '放在项目的 docs/prototype/ 下。',
      '完成判据：双击就能在浏览器里打开看，不需要起服务器。',
      '不要修改生产代码——原型是拿来讨论的，不是拿来上线的。'
    ].join('\n')
  },
  {
    id: 'writer',
    name: '笔杆子',
    desc: '文案 / 脚本 / 自媒体',
    group: 'output',
    color: '#7dd3fc',
    kind: 'auto',
    model: { claude: 'sonnet' },
    effort: { claude: 'medium', codex: 'medium' },
    tools: {},
    contract: [
      '你这一轮的职责是写文字：文案、脚本、选题、复盘。',
      '如果本机装了 media-pipeline 之类的自媒体流程 skill，按它的 SOP 走，不要自创流程。',
      '产出落回自媒体的工作目录，不要污染当前代码项目。',
      '完成判据：产出的是可直接使用的成稿，不是提纲。'
    ].join('\n')
  },
  {
    id: 'illustrator',
    name: '画师',
    desc: '视觉产出。生图路径受限',
    group: 'output',
    color: '#fda4af',
    kind: 'auto',
    model: { claude: 'sonnet' },
    effort: { claude: 'medium', codex: 'medium' },
    // 这一条是整个角色系统里最值钱的地方：把生图红线从「靠提示词提醒」
    // 变成「工具层面不可见」。第 3 期由 MCP 层按这个名单过滤 tools/list。
    tools: { denyMcp: ['*image*', '*dalle*', '*imagen*', '*flux*', '*banana*', '*midjourney*'] },
    contract: [
      '你这一轮的职责是产出视觉素材。',
      '生图只允许走用户指定的生成路径。**不要**调用任何其他图像生成工具，',
      '也不要为了绕开限制去安装新的生图依赖。需要生图时，把提示词交给用户指定的工具执行。',
      '产出的图片存进项目的 assets/img/ 下。',
      '从图片提取颜色、抽帧、把 HTML 渲染成图这类不产生新画面的操作不受此限。'
    ].join('\n')
  },
  {
    id: 'runner',
    name: '杂役',
    desc: '不套任何规矩的裸终端',
    group: 'output',
    color: '#a3a3a3',
    kind: 'auto',
    model: {},
    effort: {},
    tools: {},
    // 故意留空：不给逃生口的系统会被绕过。想随手干点什么的时候，
    // 用户需要一个「不用选角色」的选项，否则他会干脆不用这套东西。
    contract: ''
  }
]

function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt
}
function strMap(v: unknown): Partial<Record<'claude' | 'codex', string>> {
  const o = (v ?? {}) as Record<string, unknown>
  const out: Partial<Record<'claude' | 'codex', string>> = {}
  if (typeof o.claude === 'string') out.claude = o.claude
  if (typeof o.codex === 'string') out.codex = o.codex
  return out
}
function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}

/** 逐条规范化。坏的那条丢掉而不是整份失败；全坏就回落内置。 */
function sanitize(raw: unknown): AgentRole[] {
  const list = (raw as { roles?: unknown })?.roles
  if (!Array.isArray(list)) return []
  const out: AgentRole[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const r = (it ?? {}) as Record<string, unknown>
    const id = str(r.id).trim()
    const name = str(r.name).trim()
    if (!id || !name || seen.has(id)) continue // 没 id/名字，或重复 id → 丢
    seen.add(id)
    const k = str(r.kind, 'auto')
    const tools = (r.tools ?? {}) as Record<string, unknown>
    out.push({
      id,
      name,
      desc: str(r.desc),
      group: r.group === 'main' ? 'main' : 'output',
      color: str(r.color, '#a3a3a3'),
      kind: k === 'claude' || k === 'codex' ? k : 'auto',
      model: strMap(r.model),
      effort: strMap(r.effort),
      contract: str(r.contract),
      tools: { allow: strList(tools.allow), deny: strList(tools.deny), denyMcp: strList(tools.denyMcp) },
      builtin: r.builtin === true
    })
  }
  return out
}

function load(): AgentRole[] {
  try {
    const parsed = sanitize(JSON.parse(fs.readFileSync(file(), 'utf8')))
    if (parsed.length) return parsed
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
  fs.writeFileSync(f, JSON.stringify({ version: 1, roles }, null, 2) + '\n')
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
    const clean = sanitize({ roles })
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
