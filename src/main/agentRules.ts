// 把 Eas-Term 的能力说明装进两个 CLI —— 按「托管纪律」来，不是想到哪写到哪。
//
// 纪律（详见 docs/知识库-调研与执行规划.html 的「规则托管纪律」一节）：
//   1. 每个 CLI 只允许有**一个**托管区，内容按当前启用的模块整段重新生成。
//      不是「一个模块一段标记」——那样加一个模块就多一段，迟早变成一坨。
//   2. 常驻区只放「触发条件 + 去哪读」，不放「怎么做」。
//   3. 一个事实只写一处，需要引用就写路径，不复制正文。
//
// 为什么第 2 条最要紧：实测本机 ~/.codex/AGENTS.md 共 3306 字符，
// 我们的段占 3284（99%）—— 因为画板技能包是照 Claude 的 skill 机制写的
// （按需加载，平时只露一行描述），装到 Codex 时被原样整份灌进了**常驻**文件。
// 于是在 Codex 里改一行代码，都要先付这份画板指南的 token。
// 现在改成：常驻区只留触发条件和路径，详细正文落到 ~/.eas/agent/ 下按需读。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { RulesStatus, Footprint } from '../shared/types'
import { wikiPath } from './wiki/paths'
import { mcpConfigStatus } from './mcpBridge'

const BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const END = '<!-- eas-term:end -->'
/** 旧版留下的知识钩子标记也一并识别，迁移时好清理 */
const LEGACY_BEGINS = [BEGIN]

const home = (): string => app.getPath('home')
const codexAgents = (): string => path.join(home(), '.codex', 'AGENTS.md')
const claudeSkill = (name: string): string =>
  path.join(home(), '.claude', 'skills', name, 'SKILL.md')
/** 详细正文的落点：常驻区只写路径指过来。
 *
 *  **必须和上面的 home() 用同一个来源。** 这里原来是 os.homedir()，而 codexAgents()
 *  用的是 app.getPath('home') —— 两者平时相同，但 os.homedir() 跟随 $HOME 环境变量、
 *  app.getPath('home') 不跟随。一旦分叉（隔离测试、换个方式启动），
 *  就会往**真实**的 ~/.codex/AGENTS.md 里写一行指向**另一个 home** 的路径，
 *  而且这行是持久化的：等那个目录没了，Codex 每次都读到一个不存在的文件。
 *  实测踩到过。 */
const detailDir = (): string => path.join(home(), '.eas', 'agent')

/** 技能包源码根目录：打包后在 Resources 下，开发时就是 app 自己的目录。 */
const sourceRoot = (): string => (app.isPackaged ? process.resourcesPath : app.getAppPath())

// ── 画板能力 ────────────────────────────────────────────────────────
/** 技能包目录里的所有文件。原来只读 SKILL.md 一个 —— 拆成渐进式披露之后
 *  细节文件也要分发，Codex 那边尤其：它没有 skill 机制，
 *  常驻区只放指针，正文必须真的写到 ~/.eas/agent/ 下才读得到。 */
const canvasSkillFiles = (): { name: string; text: string }[] => {
  const dir = path.join(sourceRoot(), 'skills', 'eas-term')
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }))
  } catch {
    return []
  }
}

// ── 知识库能力 ──────────────────────────────────────────────────────
// **知识库不再写进这两个全局文件。** 以前这里有一个 wikiSkillText()（Claude 侧的
// eas-wiki skill）和 codexRegion() 里的一段 wiki 分支，把知识库的绝对路径、
// 目录结构、me/ 分区的用途，原样写进 ~/.claude/skills/ 和 ~/.codex/AGENTS.md ——
// 这两个文件不认「这条会话是不是 Eas-Term 起的」，同一台机器上不管从哪个终端起
// claude/codex 都读得到。用户明确要求知识库是 Eas-Term 专属：换个终端就不该读到。
//
// 现在整条能力搬到 MCP 工具 wiki_query（定义在 mcp/eas-mcp.mjs）。触发条件、
// 查询步骤、me/ 与 people/ 的区别，全部收进那个工具自己的 description ——
// 而 MCP 工具本身只有在 Eas-Term 往 PTY 里注入过 EAS_TERM_PORT/TOKEN 的终端里，
// tools/list 才会把它列出来（这条门禁已经在保护画板工具，现在延伸到知识库）。
// 在别的终端起同一个 claude/codex，这个工具在 tools/list 里根本不存在，
// 模型无从知道有这么个东西，也就无从知道知识库路径——不是「不建议读」，是「读不到」。
//
// 副作用是好的：内容不再有「装的时候固化进文件」这回事，每次调用都当场读盘，
// 换位置/建库/解绑都立即生效，不需要再回来调 syncRules() 同步。

/**
 * Codex 的常驻区。**只有触发条件和路径，没有正文。**
 *
 * 为什么触发条件不能也挪到磁盘：按需读盘要求模型先意识到「该读」。
 * 详细做法可以晚点读，但「什么时候该动」必须在它眼前——
 * 这条挪走了，agent 就永远想不起来去查知识库。
 *
 * 知识库不在这里出现：MCP 工具的 description 本身就会被模型看到（这是 MCP 协议
 * 自带的机制，不需要另外「提醒」），在这儿再写一遍是同一件事说两遍——
 * 而且这份文件是**全局常驻**的，写了就等于给知识库开了后门，绕开了 wiki_query 的门禁。
 *
 * 触发条件按「细节文件是否真的存在」动态生成，不写死条数 —— 技能包从当前 4 个 .md
 * 到以后加 wiki-architect.md 变 5 个，这里不用跟着改：少一个文件就自动少一条触发条件，
 * 不会留下指向空气的路径（那是渐进式披露最典型的静默失败：模型照着路径去读，
 * 读不到，然后凭印象干活）。四条各自独占一段、绝不合并进同一条：生图和摆放合并写的话，
 * 用户说「画张封面」时模型只会想到摆放、想不到自己有生成能力——于是回一句「我不能生图」，
 * 或者去调别的图像 API。
 */
function codexRegion(fileNames: Set<string>): string {
  const lines = [BEGIN, '# Eas-Term 扩展能力', '']
  lines.push('你运行在 Eas-Term 里。下面是已启用的能力和各自的**触发条件**，')
  lines.push('详细约定按路径自己去读，不用背下来。', '')
  if (fileNames.has('canvas.md')) {
    lines.push('**画板**：产出了给人看的东西（报告 / 预览页 / 图）→ 用画板 MCP 工具摆到用户眼前，')
    lines.push(`别只说「已生成」。详细：\`${path.join(detailDir(), 'canvas.md')}\``, '')
  }
  if (fileNames.has('generate.md')) {
    lines.push('**生图 / 生视频**：用户要图、封面、海报、视频 → 走「笔纵画板」的 MCP')
    lines.push(`（\`bizone-canvas\`），不要调别的图像 API。详细：\`${path.join(detailDir(), 'generate.md')}\``, '')
  }
  if (fileNames.has('secrets.md')) {
    lines.push('**缺密钥**：撞到 401 / 鉴权失败 → 别让用户把 key 贴进对话，')
    lines.push(`走密钥柜。详细：\`${path.join(detailDir(), 'secrets.md')}\``, '')
  }
  if (fileNames.has('wiki-architect.md')) {
    lines.push('**重新设计知识库**：用户说分类不合适 / 要自定义知识库 →')
    lines.push(`详细：\`${path.join(detailDir(), 'wiki-architect.md')}\``, '')
  }
  lines.push(END)
  return lines.join('\n')
}

/** 这一版**应该**写进 AGENTS.md 常驻区的内容。
 *
 *  导出它是为了让状态判断有个正确的参照物：agentSkill.ts 那边原来拿
 *  「完整 SKILL.md 全文包在标记里」去比对盘上那段，而 syncRules 实际写的是上面这段
 *  短路由 —— 两者永不相等，于是「有更新待安装」恒为真，首启弹窗每次启动都弹，
 *  用户点多少次「安装」都没用。 */
export function expectedCodexRegion(): string | null {
  const files = canvasSkillFiles()
  if (files.length === 0) return null
  return codexRegion(new Set(files.map((f) => f.name)))
}

/** 只替换我们那一段，用户写在区外的内容一个字不碰 */
function writeCodexRegion(text: string | null): void {
  const f = codexAgents()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  if (raw) {
    try {
      fs.copyFileSync(f, f + '.eas-backup')
    } catch {
      /* 备份失败不阻断 */
    }
  }
  let next = raw
  for (const b of LEGACY_BEGINS) {
    const i = next.indexOf(b)
    const j = next.indexOf(END)
    if (i >= 0 && j > i) next = next.slice(0, i) + next.slice(j + END.length)
  }
  next = next.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
  if (text) next = next.trim() ? next.replace(/\n*$/, '') + '\n\n' + text + '\n' : text + '\n'
  fs.writeFileSync(f, next)
}

function writeFileEnsured(f: string, text: string): void {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}

/** 装/更新全部规则。app 升级、canvas 技能内容变化时调它。
 *  知识库不再需要——它没有「装」这回事，见上面的大注释。 */
export function syncRules(): { ok: boolean; codexChars: number } {
  const files = canvasSkillFiles()

  // Claude：一模块一目录，天然独立、按需加载、能单独删
  // Codex：常驻区只放路由；正文落到 ~/.eas/agent/ 供按需读取
  // 两边装的是同一份内容，一个循环里一起写——不会出现「Claude 装了 3 个、
  // Codex 只落了 1 个」这种半同步状态
  for (const f of files) {
    writeFileEnsured(path.join(home(), '.claude', 'skills', 'eas-term', f.name), f.text)
    writeFileEnsured(path.join(detailDir(), f.name), f.text)
  }
  // 清掉旧版本可能装过的 eas-wiki skill（这个函数以前会在 kb 配置时写它）——
  // 不能留着不管，那是一份指向真实知识库路径的全局文件，正是现在要堵的洞
  try {
    fs.rmSync(path.dirname(claudeSkill('eas-wiki')), { recursive: true, force: true })
  } catch {
    /* 没装过 */
  }

  const region = files.length > 0 ? codexRegion(new Set(files.map((f) => f.name))) : null
  writeCodexRegion(region)
  return { ok: true, codexChars: region ? region.length : 0 }
}

export function rulesStatus(): RulesStatus {
  let codexChars = 0
  try {
    const raw = fs.readFileSync(codexAgents(), 'utf8')
    const i = raw.indexOf(BEGIN)
    const j = raw.indexOf(END)
    codexChars = i >= 0 && j > i ? j + END.length - i : 0
  } catch {
    codexChars = 0
  }
  return {
    claudeCanvas: fs.existsSync(claudeSkill('eas-term')),
    codexRegionChars: codexChars
  }
}

/** 卸载我们写进两个 CLI 的使用指引（MCP 条目和钩子各有各的开关，这里不碰）。
 *  eas-wiki 留在清单里是为了清掉老版本可能装过的文件，即使现在已经不再写它。 */
export function removeRules(): void {
  for (const n of ['eas-term', 'eas-wiki']) {
    try {
      fs.rmSync(path.dirname(claudeSkill(n)), { recursive: true, force: true })
    } catch {
      /* 没装过 */
    }
  }
  writeCodexRegion(null)
  try {
    fs.rmSync(detailDir(), { recursive: true, force: true })
  } catch {
    /* 没写过 */
  }
}

export function registerRulesHandlers(): void {
  ipcMain.handle('rules:status', () => rulesStatus())
  ipcMain.handle('rules:sync', () => ({ ...syncRules(), status: rulesStatus() }))
  ipcMain.handle('rules:remove', () => {
    removeRules()
    return rulesStatus()
  })

  /**
   * 一处总账：Eas-Term 在这台机器上写过的**全部**位置。
   *
   * 分散的开关等于没有开关——技能包在标题栏、钩子在词典里、知识库规则在知识库抽屉里，
   * 用户根本没法回答「这软件到底动了我什么」。写隐私策略时这份清单就是依据。
   */
  ipcMain.handle('footprint:list', (): Footprint[] => {
    const mcp = mcpConfigStatus()
    const r = rulesStatus()
    const kb = wikiPath()
    const claudeSettings = path.join(app.getPath('home'), '.claude', 'settings.json')
    const codexHooks = path.join(app.getPath('home'), '.codex', 'hooks.json')
    const hookOn = ((): boolean => {
      for (const f of [claudeSettings, codexHooks]) {
        try {
          if (fs.readFileSync(f, 'utf8').includes('eas-term:knowledge-hook')) return true
        } catch {
          /* 没有 */
        }
      }
      return false
    })()
    return [
      {
        id: 'mcp',
        name: 'MCP 接入',
        desc: '让 agent 能操作画板（开预览、整理、通知）。不配这个，画板工具完全不可用',
        installed: mcp.claude || mcp.codex,
        files: mcp.files,
        note: '装了 CLI 就会自动配上——这是画板功能的前提。端口和令牌不写进配置，只走终端环境变量',
        removable: true
      },
      {
        id: 'rules',
        name: '使用指引',
        desc: '告诉 agent 什么时候该用画板工具',
        installed: r.claudeCanvas || r.codexRegionChars > 0,
        files: [
          ...(r.claudeCanvas ? [claudeSkill('eas-term')] : []),
          ...(r.codexRegionChars > 0 ? [codexAgents()] : [])
        ],
        note:
          r.codexRegionChars > 0
            ? `Codex 侧常驻 ${r.codexRegionChars} 字符（每轮对话都会带上），详细正文放在 ~/.eas/agent/ 按需读取`
            : '',
        removable: true
      },
      {
        id: 'hook',
        name: '提交即复盘钩子',
        desc: 'git commit 后扫一遍新增代码，把用到但词典没收录的术语存进自建词库',
        installed: hookOn,
        files: hookOn ? [claudeSettings, codexHooks].filter((f) => fs.existsSync(f)) : [],
        // 这是侵入性最高的一项，措辞上不含糊
        note: '**在你所有项目里、每一次 Bash 调用时都会触发**。纯本地脚本，零 token，不联网',
        removable: true
      },
      {
        id: 'wiki',
        name: '知识库',
        desc: '你自己选位置的 markdown 文件夹',
        installed: !!kb,
        files: kb ? [kb] : [],
        note: kb
          ? '只在 Eas-Term 的终端里，agent 才能通过 MCP 工具查到它——换成别的终端（哪怕开的是同一台电脑）看不到。解除绑定只改指向，不动你的文件'
          : '',
        removable: false
      }
    ]
  })
}
