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
import { ROLES_FILE_VERSION, sanitizeRoles } from './rolesSchema'

const file = (): string => path.join(os.homedir(), '.eas', 'roles.json')

/**
 * 内置角色。分两类：
 *   主序列（main）—— 沿项目生命周期推进，通常按顺序用
 *   产出型（output）—— 横切，任何阶段都能叫
 *
 * contract 是拼进启动命令的职责契约。写法上刻意避开人设，只讲**产出、落点、完成判据**，
 * 因为那才是模型照着做了能被验证的部分。
 */
export const BUILTIN_ROLES: AgentRole[] = [
  {
    // 和下面 scout→builder→inspector 那条「分三次会话接力」的序列不是一回事——
    // 这个角色是那条序列的**替代品**：一个人在一条会话里从头走到尾，
    // 用外部方法论(obra/superpowers)的纪律把「一个人干全部」这件事的风险摁住。
    // 放在数组最前面：新装用户看到的第一个选项就是「要不要一杆到底」。
    id: 'e2e',
    name: '全流程',
    desc: '0→1 生产级应用，一条会话走完调研到验收；方法论对齐 GitHub obra/superpowers',
    group: 'main',
    color: '#fb923c',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
    contract: [
      '你这一轮的职责是把一个想法从 0 做到 1，做成生产级应用——不是「调研」「实现」「审查」分三次会话，',
      '是你一个人在这一条会话里从头走到尾，但纪律不能因为省了交接就松。',
      '方法论对齐 GitHub obra/superpowers 那套：',
      '1. 先把需求问清楚、写成 spec，分段给用户看、等他确认，再动手——不要一上来就写代码。',
      '2. spec 定下来后先写实施计划，再开工，别边写边想。',
      '3. 严格 TDD：先写一个会失败的测试，再写让它通过的代码。代码写在测试前面的话，删掉重来——这条最核心，不是可选项。',
      '4. 排障走「先复现、再定位、再修」，不要靠猜改代码。',
      '5. 任务里有能拆开、互不依赖的部分，用 Agent 工具分给子任务并行做，不要自己从头串到尾。',
      '完成判据：跑得起来、测试是绿的、UI/交互类改动亲眼验证过效果——代码改了不算做完了。',
      '如果这条会话是 Claude Code、且还没装 superpowers 插件：找合适的时机告诉用户一次就够，',
      '官方市场安装命令是 `/plugin install superpowers@claude-plugins-official`，这行要用户自己在这条会话里敲、自己确认，不要替他自动执行。',
      '不是 Claude Code（比如这条会话用的是 Codex）时，插件那件事不用管，上面 1-5 条纪律照样是硬性的——那是方法论本身，不依赖某个具体工具装没装。'
    ].join('\n')
  },
  {
    id: 'scout',
    name: '勘探员',
    desc: '前期调研 + 架构，只读不写代码',
    group: 'main',
    color: '#7dd3fc',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
    caps: { write: false },
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
    desc: '实现。改代码的主力',
    group: 'main',
    color: '#6ee7b7',
    kind: 'auto',
    model: { claude: 'opus' },
    effort: { claude: 'high', codex: 'high' },
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
    caps: { write: false },
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
    // 这一条是整个角色系统里最值钱的地方：把生图红线从「靠提示词提醒」变成能力意图，
    // 由 shared/roleBinding.ts 翻成各家参数（Claude 通配 deny；Codex --disable image_generation
    // ＋按名关 server；omp 按名不连）。通配那组黑名单在 IMAGE_MCP_PATTERNS。
    caps: { imageGen: false },
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
    // 故意留空：不给逃生口的系统会被绕过。想随手干点什么的时候，
    // 用户需要一个「不用选角色」的选项，否则他会干脆不用这套东西。
    contract: ''
  }
]

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
