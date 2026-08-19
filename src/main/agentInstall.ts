// 帮用户把 Claude Code / Codex 装上 —— 但**不替他执行**。
//
// 我们只做一件事：根据这台机器上有什么（node / brew / winget、什么系统），
// 挑出最合适的那条安装命令交给渲染层，由它预填进一个终端里，用户自己按回车。
//
// 为什么不代跑：
//   · 静默在别人电脑上装全局 CLI + 改 PATH 是恶意软件的行为特征，会被 Gatekeeper /
//     Defender 盯上——我们刚做完签名公证，不值得。
//   · 装完还要用用户自己的账号登录，这一步永远绕不过去，藏后台没有意义。
//   · 公司网络 / 代理 / 权限导致失败时，报错摆在终端里用户能自己查，
//     比一句「安装失败」有用得多。
//
// 命令来源（2026-07 核对过官方文档，不是凭记忆写的）：
//   Claude Code  https://code.claude.com/docs/en/setup
//   Codex        https://github.com/openai/codex  README
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import type { InstallPlan, InstallOption, AgentKind } from '../shared/types'

/** 某个可执行文件在不在。和 agentSkill 里的 hasCli 同源：GUI 启动时 PATH 很贫瘠，探常见位置 + PATH。 */
function hasBin(bin: string): boolean {
  const home = app.getPath('home')
  const win = process.platform === 'win32'
  const exts = win ? ['.cmd', '.exe', '.bat', ''] : ['']
  const dirs = win
    ? [
        path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm'),
        'C:\\Program Files\\nodejs',
        path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')
      ]
    : [
        path.join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        path.join(home, '.bun', 'bin'),
        path.join(home, '.npm-global', 'bin')
      ]
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) if (d) dirs.push(d)
  return dirs.some((d) => exts.some((e) => {
    try {
      return fs.existsSync(path.join(d, bin + e))
    } catch {
      return false
    }
  }))
}

/**
 * 给一个 CLI 排出候选安装方式，最合适的排第一。
 *
 * 排序理由：
 *   · 原生安装脚本排第一 —— 不依赖 Node，装完自己后台更新，对「什么都没有」的用户最省事
 *   · 有 brew / winget 的话给出来作为备选，用户后续升级更顺手
 *   · npm 放最后，且只在真有 node 时才给（没 node 却让人跑 npm 是最糟的体验）
 */
function optionsFor(kind: AgentKind): InstallOption[] {
  const win = process.platform === 'win32'
  const mac = process.platform === 'darwin'
  const out: InstallOption[] = []

  if (kind === 'claude') {
    if (win) {
      out.push({ via: '官方安装脚本', cmd: 'irm https://claude.ai/install.ps1 | iex', shell: 'powershell' })
      if (hasBin('winget')) out.push({ via: 'WinGet', cmd: 'winget install Anthropic.ClaudeCode' })
    } else {
      out.push({ via: '官方安装脚本', cmd: 'curl -fsSL https://claude.ai/install.sh | bash' })
      if (mac && hasBin('brew')) out.push({ via: 'Homebrew', cmd: 'brew install --cask claude-code' })
    }
    if (hasBin('npm')) out.push({ via: 'npm', cmd: 'npm install -g @anthropic-ai/claude-code' })
  } else {
    if (win) {
      out.push({
        via: '官方安装脚本',
        cmd: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      })
    } else {
      out.push({ via: '官方安装脚本', cmd: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' })
      if (mac && hasBin('brew')) out.push({ via: 'Homebrew', cmd: 'brew install --cask codex' })
    }
    // 注意包名必须带 @openai/ —— 裸 `codex` 是 2012 年的无关包，装错是最常见的翻车点
    if (hasBin('npm')) out.push({ via: 'npm', cmd: 'npm install -g @openai/codex' })
  }

  return out
}

export function installPlan(): InstallPlan {
  return {
    platform: process.platform,
    hasNode: hasBin('node'),
    hasBrew: hasBin('brew'),
    claude: {
      name: 'Claude Code',
      vendor: 'Anthropic',
      options: optionsFor('claude'),
      loginHint: 'claude',
      scope: { chat: true, terminal: true }
    },
    codex: {
      name: 'Codex',
      vendor: 'OpenAI',
      options: optionsFor('codex'),
      loginHint: 'codex login',
      scope: { chat: true, terminal: true }
    }
  }
}

export function registerAgentInstallHandlers(): void {
  ipcMain.handle('agent:installPlan', () => installPlan())
}
