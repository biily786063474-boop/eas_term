// statusline 转发器的安装/卸载：碰硬盘和 electron 的那一半。
// **规划逻辑全在 statuslineInstall.ts**（纯函数、9 个单测）——
// 这里只负责读写 ~/.claude/settings.json 和注册 IPC。
//
// 分成两个文件是硬要求：node --test 直接跑 .ts，一旦文件里 import 了 electron，
// 整个测试文件都加载不起来（tidyOrder.ts 立的规矩）。

import { app, ipcMain } from 'electron'
import {
  planInstall,
  planUninstall,
  wrapperCommand,
  STATUSLINE_TAG,
  type StatusLineCfg
} from './statuslineInstall'
import fs from 'fs'
import path from 'path'

const settingsFile = (): string => path.join(app.getPath('home'), '.claude', 'settings.json')

/** hook 用的 node 解释器：绝对路径候选 + process.execPath 兜底。
 *  和 session.ts 的 nodeBinForHook 同一个理由 —— 不能祈祷 PATH 里有 node
 *  （statusline 由 Claude Code 起，它的 PATH 不受我们控制）。 */
function nodeBin(): string {
  const cands = process.platform === 'win32' ? [] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const c of cands) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* 下一个 */
    }
  }
  return process.execPath
}

/** 转发脚本的绝对路径。打包后在 resources 里，开发时在仓库里。 */
function scriptPath(): string {
  const packed = path.join(process.resourcesPath ?? '', 'agent-hooks', 'eas-statusline.mjs')
  if (fs.existsSync(packed)) return packed
  return path.join(app.getAppPath(), 'resources', 'agent-hooks', 'eas-statusline.mjs')
}

function readSettings(): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 写之前先备份。用户的全局配置写坏了是灾难，一份 .eas-backup 不值几个字节。 */
function writeSettings(next: Record<string, unknown>): boolean {
  const f = settingsFile()
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    if (fs.existsSync(f)) {
      try {
        fs.copyFileSync(f, f + '.eas-backup')
      } catch {
        /* 备份失败不阻断 —— 但下面写入失败时至少还有原文件 */
      }
    }
    fs.writeFileSync(f, JSON.stringify(next, null, 2))
    return true
  } catch (e) {
    console.error('[statusline] 写配置失败', e)
    return false
  }
}

export function statuslineStatus(): { installed: boolean; wrapped: string | null } {
  const cur = readSettings().statusLine as StatusLineCfg | undefined
  return {
    installed: cur?._easTerm === STATUSLINE_TAG,
    wrapped: typeof cur?._easWrapped === 'string' ? cur._easWrapped : null
  }
}

export function registerStatuslineHandlers(): void {
  ipcMain.handle('statusline:status', () => statuslineStatus())

  ipcMain.handle('statusline:install', () => {
    const s = readSettings()
    const cur = s.statusLine as StatusLineCfg | undefined
    // 原命令只在「还没被我们包过」时才从 command 取 —— 已经包过的话，
    // command 是我们自己那层，拿它当原命令会把包装层套进去
    const original = cur?._easTerm === STATUSLINE_TAG ? '' : (cur?.command ?? '')
    const plan = planInstall(cur, wrapperCommand(nodeBin(), scriptPath(), original || (cur?._easWrapped as string) || ''), original)
    if (!plan.next) return { ok: true, changed: false, reason: plan.reason }
    const ok = writeSettings({ ...s, statusLine: plan.next })
    return { ok, changed: ok, reason: plan.reason }
  })

  ipcMain.handle('statusline:uninstall', () => {
    const s = readSettings()
    const r = planUninstall(s.statusLine as StatusLineCfg | undefined)
    if (!r.changed) return { ok: true, changed: false, reason: '不是我们装的，没动' }
    const next = { ...s }
    if (r.next === undefined) delete next.statusLine
    else next.statusLine = r.next
    const ok = writeSettings(next)
    return { ok, changed: ok, reason: '已还原用户原有的 statusline' }
  })
}
