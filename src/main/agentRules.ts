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
import { planRefresh } from './rulesRefresh'

const BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const END = '<!-- eas-term:end -->'
/** 旧版留下的知识钩子标记也一并识别，迁移时好清理 */
const LEGACY_BEGINS = [BEGIN]

const home = (): string => app.getPath('home')
const codexAgents = (): string => path.join(home(), '.codex', 'AGENTS.md')
/** 【历史残留清理】0.4.27–0.4.30 支持过 DeepSeek Harness，会往 `<DSH_HOME>/AGENTS.md`
 *  和 `<DSH_HOME>/skills/eas-term/` 写东西。支持已经移除，但**装过的人机器上还留着** ——
 *  这两个路径只为清掉它们而保留，不再有任何写入。跟着 DSH_HOME 走：用户改过它的话，
 *  东西就在他改的那个位置。清干净之后这段可以整体删掉。 */
const legacyDshHome = (): string => process.env.DSH_HOME || path.join(home(), '.dsh')
const legacyDshAgents = (): string => path.join(legacyDshHome(), 'AGENTS.md')
const legacyDshSkill = (): string => path.join(legacyDshHome(), 'skills', 'eas-term')
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

/** 目录里**实际存在**的 .md 文件名——读的是目标目录本身，不是拿源文件名单去
 *  反查存在。footprint 要报的是「盘上现在真的有什么」，不是「这个版本应该装
 *  什么」：正常同步之后两者一致，但如果目录里有旧版本遗留的孤儿文件（比如
 *  以后哪个文件改名或被移除），只有直接读目标目录才照得见、才报得出来。 */
const existingMdFiles = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
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
 *
 * SKILL.md 那条不是第五个触发条件，措辞刻意分开写：它指向的「边界」「分寸」两节
 * 不是「场景触发了才读」的东西（不像画板/生图/密钥/知识库各自对应一类具体请求），
 * 是**任何时候操作画布都作数的规矩**（终端关不了、别刷屏、notify 别滥用）——
 * 改动前 syncRules 把整份 SKILL.md 灌进 canvas.md，这两节顺带可达；拆分成渐进式
 * 披露之后 canvas.md 只剩画布子集，这两节在 Codex 侧变得不可达，得单独补一条指针。
 */
function codexRegion(fileNames: Set<string>): string {
  const lines = [BEGIN, '# Eas-Term 扩展能力', '']
  lines.push('你运行在 Eas-Term 里。下面是已启用的能力和各自的**触发条件**，')
  lines.push('详细约定按路径自己去读，不用背下来。', '')
  if (fileNames.has('SKILL.md')) {
    lines.push('**这条不是触发条件，是随时都作数的规矩**：SKILL.md 的「边界」（终端关不了、')
    lines.push('没有替用户打命令的工具、路径白名单）和「分寸」（别刷屏、notify 别滥用）两节，')
    lines.push(`操作画布全程都要记着，不是等下面某条触发了才去读。\`${path.join(detailDir(), 'SKILL.md')}\``, '')
  }
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
  writeManagedRegion(codexAgents(), text)
}

/** 清掉 0.4.27–0.4.30 往 DeepSeek Harness 里装过的东西：常驻区一段 + 整个 skill 目录。
 *  **漏一样就是删不掉的残留**（同 MANAGED 那条教训）。安装和卸载都会调 ——
 *  跟 eas-wiki 那条同款，用户不必为了清残留专门去点一次卸载。 */
export function purgeLegacyDsh(): void {
  try {
    writeManagedRegion(legacyDshAgents(), null)
  } catch {
    /* 没装过 dsh，或那个目录本来就不存在 */
  }
  try {
    fs.rmSync(legacyDshSkill(), { recursive: true, force: true })
  } catch {
    /* 没装过 */
  }
}

/** 往某个 AGENTS.md 里写/清我们那一段。**只动标记之间的内容**，
 *  用户写在区外的一个字不碰（纪律 6）；写之前先备份成 `.eas-backup`（纪律 5）。 */
function writeManagedRegion(f: string, text: string | null): void {
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

/**
 * 写一个「分发产物」文件：内容由 app 带来，用户和 agent 都不该改。写完设成只读。
 *
 * **为什么要拦**：这几份 md 决定了 agent 在这个软件里怎么干活（生图走哪条路、
 * 什么不许做、密钥怎么拿）。被改坏的后果是软件行为异常，而且极难查 ——
 * 表现是「agent 忽然不听话了」，没人会想到去看一个全局目录里的 md。
 * agent 自己「顺手优化一下说明」这种事尤其容易发生。
 *
 * **只读挡不住铁了心要改的人**（chmod 回去就行），它挡的是两件更常见的事：
 * 顺手写入会拿到 EACCES —— 那是个明确的「这里不该动」的信号；以及误操作。
 * 真被改了还有第二道：启动时 refreshInstalledRules 比对内容，不一致就重写回去。
 *
 * **写之前必须先解除只读** —— 上一次写完是 444，不解除的话这次直接 EACCES，
 * 于是升级再也推不下去。这条是这个函数唯一容易写错的地方。
 *
 * 只用于我们**独占的目录**（~/.claude/skills/eas-term/、~/.eas/agent/）。
 * `~/.codex/AGENTS.md` 不能这么干：那是用户自己的文件，我们只占其中一个区域，
 * 设成只读会挡住他改自己的内容。
 */
function writeDistributed(f: string, text: string): void {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  try {
    fs.chmodSync(f, 0o644) // 解除上一次设的只读；文件还不存在时会抛，忽略即可
  } catch {
    /* 首次写入 */
  }
  fs.writeFileSync(f, text)
  try {
    fs.chmodSync(f, 0o444)
  } catch (e) {
    // 设不上不致命：内容校验那道还在。但要留痕，否则「护栏没生效」会完全无声
    console.error('[rules] 设只读失败', f, e)
  }
}

/** 装/更新全部规则。app 升级、canvas 技能内容变化时调它。
 *  知识库不再需要——它没有「装」这回事，见上面的大注释。 */
/** 目标目录里现在有哪些 .md 及其内容。**目录不存在返回 null**（＝没装）——
 *  这个区别是 planRefresh 的判据，不能用空对象混过去。 */
function onDiskMd(dir: string): Record<string, string> | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return null // 目录不存在 = 没装
  }
  const out: Record<string, string> = {}
  for (const n of names) {
    try {
      out[n] = fs.readFileSync(path.join(dir, n), 'utf8')
    } catch {
      /* 读不到就当没有，下面会重写它 */
    }
  }
  return out
}

/**
 * 启动时把**已经装了的**规则更新到当前版本。
 *
 * app 里带的 skills/ 会随版本更新，但分发到用户机器上那份不会 —— `syncRules()` 只由
 * 「扩展能力」面板的按钮触发。于是升级完 agent 读到的还是上一版规则，而且毫无提示。
 *
 * **只更新、不安装**（判据见 rulesRefresh.ts）。卸载过的人不该在下次启动被装回来。
 */
export function refreshInstalledRules(): { updated: string[] } {
  const files = canvasSkillFiles()
  if (!files.length) return { updated: [] }
  const updated: string[] = []

  for (const dir of [path.join(home(), '.claude', 'skills', 'eas-term'), detailDir()]) {
    const plan = planRefresh(files, onDiskMd(dir))
    for (const name of plan) {
      const f = files.find((x) => x.name === name)
      if (!f) continue
      writeDistributed(path.join(dir, name), f.text)
      updated.push(path.join(dir, name))
    }
  }

  // Codex 常驻区：只在**已经有区域**时重写。没有 = 没装，同上不主动写。
  // 它的内容随文件清单变（codexRegion 拿的是名字集合），新增模块时这里也要跟上。
  if (rulesStatus().codexRegionChars > 0) {
    const region = codexRegion(new Set(files.map((f) => f.name)))
    writeCodexRegion(region)
  }

  if (updated.length) console.log(`[rules] 已把 ${updated.length} 个规则文件更新到当前版本`)
  return { updated }
}

export function syncRules(): { ok: boolean; codexChars: number } {
  const files = canvasSkillFiles()

  // Claude：一模块一目录，天然独立、按需加载、能单独删
  // Codex：常驻区只放路由；正文落到 ~/.eas/agent/ 供按需读取
  // 两边装的是同一份内容，一个循环里一起写——不会出现「Claude 装了 3 个、
  // Codex 只落了 1 个」这种半同步状态
  for (const f of files) {
    writeDistributed(path.join(home(), '.claude', 'skills', 'eas-term', f.name), f.text)
    writeDistributed(path.join(detailDir(), f.name), f.text)
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
  purgeLegacyDsh() // 顺手清掉 0.4.27–0.4.30 装过的 dsh 残留，同 eas-wiki 那条
  return { ok: true, codexChars: region ? region.length : 0 }
}

/** 某个 AGENTS.md 里我们那段有多长（没装就是 0）。两个 CLI 共用，不写两遍。 */
function regionChars(f: string): number {
  try {
    const raw = fs.readFileSync(f, 'utf8')
    const i = raw.indexOf(BEGIN)
    const j = raw.indexOf(END)
    return i >= 0 && j > i ? j + END.length - i : 0
  } catch {
    return 0
  }
}

export function rulesStatus(): RulesStatus {
  const codexChars = regionChars(codexAgents())
  // 判据和 agentSkill.ts 的 installed() 保持一致：源目录里每个 .md 都要在目标目录
  // 存在，才算装了。这里原来只查 SKILL.md 在不在，会把「SKILL.md 装了、细节文件
  // 没跟上」的半装状态误判成「已安装」——而且会和 skillStatus() 的判断对不上：
  // 一个说装了、一个说没装，标题栏的「有更新待安装」和「扩展能力」面板的
  // 「已启用」标签就会各说各话，用户看到自相矛盾的两个状态。
  const claudeCanvasDir = path.dirname(claudeSkill('eas-term'))
  const srcFiles = canvasSkillFiles()
  const claudeCanvas =
    srcFiles.length > 0 && srcFiles.every((f) => fs.existsSync(path.join(claudeCanvasDir, f.name)))
  // 判据与 claudeCanvas 同款：源目录里每个 .md 都到位才算装了，
  // 半装状态不能报成「已安装」
  return {
    claudeCanvas,
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
  purgeLegacyDsh()
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
    const claudeCanvasDir = path.dirname(claudeSkill('eas-term'))
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
        note:
          '装了 CLI 就会自动配上——这是画板功能的前提。端口和令牌不写进配置，只走终端环境变量。\n' +
          // 两条都是 2026-08-19 用户实际踩到才补的：他点了移除，既不知道画板的
          // bizone-canvas 被一起删了（生图路径当场断掉），也不知道还能不能加回来。
          '移除会**连笔纵画板的 bizone-canvas 一起删掉**（两条都是我们写进去的），生图会因此不可用。\n' +
          '移除之后不会在下次启动时自动装回来——想恢复就点这里的「安装」。',
        removable: true
      },
      {
        id: 'rules',
        name: '使用指引',
        desc: '告诉 agent 什么时候该用画板工具',
        installed: r.claudeCanvas || r.codexRegionChars > 0,
        // 落点不止一个文件——技能拆成渐进式披露之后，Claude 侧和 Codex 侧详细正文
        // 各自是一个目录，动态列出目录里实际存在的每个 .md，不写死数量或文件名，
        // 否则「卸载会删哪些」这个隐私承诺就只报得出其中一个文件
        files: [
          ...existingMdFiles(claudeCanvasDir).map((f) => path.join(claudeCanvasDir, f)),
          ...existingMdFiles(detailDir()).map((f) => path.join(detailDir(), f)),
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
