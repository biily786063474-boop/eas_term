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
import os from 'os'
import path from 'path'

import type { RulesStatus, Footprint } from '../shared/types'
import { wikiPath } from './wiki'
import { mcpConfigStatus } from './mcpBridge'

const BEGIN = '<!-- eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除 -->'
const END = '<!-- eas-term:end -->'
/** 旧版留下的知识钩子标记也一并识别，迁移时好清理 */
const LEGACY_BEGINS = [BEGIN]

const home = (): string => app.getPath('home')
const codexAgents = (): string => path.join(home(), '.codex', 'AGENTS.md')
const claudeSkill = (name: string): string =>
  path.join(home(), '.claude', 'skills', name, 'SKILL.md')
/** 详细正文的落点：常驻区只写路径指过来 */
const detailDir = (): string => path.join(os.homedir(), '.eas', 'agent')

function readSource(rel: string): string | null {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  try {
    return fs.readFileSync(path.join(base, rel), 'utf8')
  } catch {
    return null
  }
}

// ── 画板能力 ────────────────────────────────────────────────────────
const canvasSkill = (): string | null => readSource(path.join('skills', 'eas-term', 'SKILL.md'))

// ── 知识库能力 ──────────────────────────────────────────────────────
/** Claude 侧的 skill：description 本身就是触发器，模型判断相关才加载正文 */
function wikiSkillText(kb: string): string {
  return `---
name: eas-wiki
description: 查用户的个人知识库。当用户问「怎么做」这类方法问题、提到某个博主/作者/人名、
  问过去做过的决定或踩过的坑、或者要你产出文案/脚本/设计/剪辑方案时使用。
  也在用户明说「查知识库」「wiki 里有没有」时使用。
---

# 用户的知识库

位置：\`${kb}\`

## 怎么查（按顺序，别跳步）

1. 先读 \`${kb}/index.md\` —— 全库目录，每页一行摘要。**只读这一个文件**。
2. 从索引里挑出真正相关的页面（一般 1–3 篇），读它们。
3. 回答时说明参考了哪几篇，方便用户自己去翻。

## 什么时候**不要**查

- 纯代码调试、跑构建、改配置这类执行类任务
- 用户已经把上下文给全了、不需要额外背景
- 同一轮对话里已经查过了

## 硬规矩

- 索引里没有相关内容 → **直说没有**。不要用知识库里不存在的内容假装引用。
- 不要在别的项目里写知识库。要沉淀新结论时**提议**用户去知识库目录开会话，
  或者问他「要不要存进知识库」——得到明确同意才写。
`
}

/**
 * Codex 的常驻区。**只有触发条件和路径，没有正文。**
 *
 * 为什么触发条件不能也挪到磁盘：按需读盘要求模型先意识到「该读」。
 * 详细做法可以晚点读，但「什么时候该动」必须在它眼前——
 * 这条挪走了，agent 就永远想不起来去查知识库。
 */
function codexRegion(mods: { canvas: boolean; wiki: string | null }): string {
  const lines = [BEGIN, '# Eas-Term 扩展能力', '']
  lines.push('你运行在 Eas-Term 里。下面是已启用的能力和各自的**触发条件**，')
  lines.push('详细约定按路径自己去读，不用背下来。', '')
  if (mods.canvas) {
    lines.push('**画板**：产出了给人看的东西（报告 / 预览页 / 图）→ 用画板 MCP 工具摆到用户眼前，')
    lines.push(`别只说「已生成」。详细：\`${path.join(detailDir(), 'canvas.md')}\``, '')
  }
  if (mods.wiki) {
    lines.push('**知识库**：用户问方法类问题、提到人名/博主、问过去的决定或踩过的坑、')
    lines.push('要你产出文案/脚本/设计方案时 →')
    lines.push(`先读 \`${mods.wiki}/index.md\`（全库一行摘要目录），挑 1–3 篇相关的看，回答注明出处。`)
    lines.push(`索引里没有就直说没有，不要编。详细：\`${mods.wiki}/AGENTS.md\``, '')
  }
  lines.push(END)
  return lines.join('\n')
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

/** 装/更新全部规则。知识库初始化、改位置、app 升级时都该调它——不等用户再点一次。 */
export function syncRules(): { ok: boolean; codexChars: number } {
  const kb = wikiPath()
  const canvas = canvasSkill()

  // Claude：一模块一目录，天然独立、按需加载、能单独删
  if (canvas) writeFileEnsured(claudeSkill('eas-term'), canvas)
  if (kb) writeFileEnsured(claudeSkill('eas-wiki'), wikiSkillText(kb))
  else {
    try {
      fs.rmSync(path.dirname(claudeSkill('eas-wiki')), { recursive: true, force: true })
    } catch {
      /* 没装过 */
    }
  }

  // Codex：常驻区只放路由；正文落到 ~/.eas/agent/ 供按需读取
  if (canvas) writeFileEnsured(path.join(detailDir(), 'canvas.md'), canvas)
  const region = canvas || kb ? codexRegion({ canvas: !!canvas, wiki: kb }) : null
  writeCodexRegion(region)
  return { ok: true, codexChars: region ? region.length : 0 }
}

export function rulesStatus(): RulesStatus {
  const kb = wikiPath()
  let codexChars = 0
  try {
    const raw = fs.readFileSync(codexAgents(), 'utf8')
    const i = raw.indexOf(BEGIN)
    const j = raw.indexOf(END)
    codexChars = i >= 0 && j > i ? j + END.length - i : 0
  } catch {
    codexChars = 0
  }
  const wikiSkill = fs.existsSync(claudeSkill('eas-wiki'))
  // 装了但知识库路径变了 → 规则里指的是旧地方，等于失效
  let stale = false
  if (wikiSkill && kb) {
    try {
      stale = !fs.readFileSync(claudeSkill('eas-wiki'), 'utf8').includes(kb)
    } catch {
      stale = true
    }
  }
  return {
    claudeCanvas: fs.existsSync(claudeSkill('eas-term')),
    claudeWiki: wikiSkill,
    codexRegionChars: codexChars,
    codexHasWiki: codexChars > 0 && !!kb && (() => {
      try {
        return fs.readFileSync(codexAgents(), 'utf8').includes(kb)
      } catch {
        return false
      }
    })(),
    stale
  }
}

/** 卸载我们写进两个 CLI 的使用指引（MCP 条目和钩子各有各的开关，这里不碰） */
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
        desc: '告诉 agent 什么时候该用画板工具、什么时候该查知识库',
        installed: r.claudeCanvas || r.claudeWiki || r.codexRegionChars > 0,
        files: [
          ...(r.claudeCanvas ? [claudeSkill('eas-term')] : []),
          ...(r.claudeWiki ? [claudeSkill('eas-wiki')] : []),
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
        note: kb ? '解除绑定只改指向，不动你的文件' : '',
        removable: false
      }
    ]
  })
}
