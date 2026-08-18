import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentProbe } from '../shared/types'

const pExecFile = promisify(execFile)

// GUI 启动的 Electron 其 PATH 常缺 homebrew（/opt/homebrew/bin），直接 execFile 会误判 CLI 未装。
// 这里补上常见安装目录，让 `claude`/`codex` 能被找到（终端里能跑是因为 pty 走登录 shell）。
const PROBE_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`
}

// 解析 `claude --help`：真实拉取当前 CLI 支持的「模型别名」与「effort 档位」，不在前端写死——
// claude 升级新增档位/别名时，开终端 probe 自动跟随。--help 是纯文本、无副作用、秒回，
// 绝不能跑会启动交互会话的子命令（曾误用 `claude config list` 启动了真实会话）。
async function probeClaude(): Promise<AgentProbe['claude']> {
  try {
    const { stdout } = await pExecFile('claude', ['--help'], { timeout: 8000, env: PROBE_ENV })
    // effort：抓 `--effort <level> ... (low, medium, high, xhigh, max)` 括号内容
    let efforts: string[] = []
    const em = stdout.match(/--effort[\s\S]{0,240}?\(([a-z][a-z,\s]+)\)/)
    if (em) efforts = em[1].split(/[,\s]+/).filter(Boolean)
    // model：抓 `--model` 段里单引号别名（排除 claude-fable-5 这种含连字符的「全名」示例）
    let models: string[] = []
    const mm = stdout.match(/--model\b[\s\S]{0,420}?(?=\n\s{2,}-|\n\n)/)
    if (mm) {
      const toks = [...mm[0].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])
      models = [...new Set(toks.filter((t) => !t.includes('-')))]
    }
    return { installed: true, models, efforts }
  } catch {
    return { installed: false, models: [], efforts: [] }
  }
}

// Codex 不像 Claude 那样在 `--help` 里列出模型/档位——它们是「按账号从服务端 model catalog
// 动态拉」的（`supportedReasoningEfforts`/`defaultReasoningEffort`/`model_catalog_json`，需登录 +
// 跑交互 TUI 的 /model 才可见）。CLI 层拿不到离线静态表，故这里给一组「已知可用」默认；
// 前端仍留「自定义…」输入兜底，可打任意别名（如 gpt-5-mini）。参数已在本机 codex 0.145 核对：
// 启动 `codex -m <model> -c model_reasoning_effort=<effort>`，回溯 `codex resume --last`。
const CODEX_MODELS = ['gpt-5-codex', 'gpt-5']
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']

/**
 * DeepSeek Harness。**模型和 effort 都给空数组**，不是漏了：
 *
 * 它的模型由 profile 的插件树决定（`dsh-agent-default-model` 的 config.model，
 * 默认 deepseek-v4-flash），命令行没有 `--model` 这类开关 —— 换模型要改
 * cordis.patch.yml。effort 档位它压根没有这个概念。
 * 空数组会让模型/强度选择器自动隐藏（UI 由能力声明驱动，不需要为它写分支）。
 *
 * 探测用 `--help` 而不是 `--version`：0.1.0-rc 阶段 `--version` 在某些安装方式下
 * 会先触发一次 profile 初始化，慢且有副作用；`--help` 是纯解析、秒回。
 */
async function probeDsh(): Promise<AgentProbe['dsh']> {
  try {
    await pExecFile('dsh', ['--help'], { timeout: 8000, env: PROBE_ENV })
    return { installed: true, models: [], efforts: [] }
  } catch {
    return { installed: false, models: [], efforts: [] }
  }
}

async function probeCodex(): Promise<AgentProbe['codex']> {
  try {
    await pExecFile('codex', ['--version'], { timeout: 5000, env: PROBE_ENV })
    return { installed: true, models: CODEX_MODELS, efforts: CODEX_EFFORTS }
  } catch {
    return { installed: false, models: [], efforts: [] }
  }
}

/**
 * 用户在 ~/.codex/config.toml 里配了哪些 MCP server。
 *
 * 为什么需要：角色的「禁用 MCP server」在 Codex 侧走 -c mcp_servers.<名>.enabled=false，
 * 而**名字不存在时 codex 会直接拒绝启动**（报 `invalid transport`，因为它试图现构造一个
 * 没有 command/url 的 server）。也就是说一个笔误就能让终端起不来。
 * 所以下发前先按这份清单过滤，并在编辑器里把可选名字摆出来，从源头避免手误。
 *
 * 逐行扫描找 [mcp_servers.<名>] 段头，不用正则整文件匹配 —— 上次用正则改这个文件
 * 把用户真实配置截断过，教训还热着。
 */
function codexServers(): string[] {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8')
    const out: string[] = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('[mcp_servers.')) continue
      const name = t.slice('[mcp_servers.'.length).replace(/\].*$/, '').trim()
      // 带引号的键名（[mcp_servers."a.b"]）去掉引号
      const clean = name.replace(/^"(.*)"$/, '$1')
      if (clean && !out.includes(clean)) out.push(clean)
    }
    return out
  } catch {
    return []
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:codexServers', () => codexServers())

  ipcMain.handle('agent:probe', async (): Promise<AgentProbe> => {
    const [claude, codex, dsh] = await Promise.all([probeClaude(), probeCodex(), probeDsh()])
    return { claude, codex, dsh }
  })

/** Codex 没有 --session-id 这类参数指定会话标识，只能起完之后去 sessions 目录捞。
 *  会话文件第一行 session_meta 里有 cwd，按它过滤能把竞态压到「同一项目同时起两个
 *  codex」才可能撞——真撞上（多个候选）就放弃绑定，宁可保持现状也不要瞎猜一个错的。 */
ipcMain.handle(
  'codex:captureSession',
  async (_e, cwd: string, sinceMs: number): Promise<{ id: string | null }> => {
    try {
      const root = path.join(app.getPath('home'), '.codex', 'sessions')
      const found: string[] = []
      const walk = async (dir: string): Promise<void> => {
        for (const ent of await fs.promises.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.name.endsWith('.jsonl')) {
            const st = await fs.promises.stat(full)
            if (st.mtimeMs >= sinceMs) found.push(full)
          }
        }
      }
      await walk(root)
      const hits: string[] = []
      for (const f of found) {
        // 只读开头一小段：session_meta 是第一行，不必把整个会话读进内存
        const fd = await fs.promises.open(f, 'r')
        try {
          const buf = Buffer.alloc(4096)
          const { bytesRead } = await fd.read(buf, 0, 4096, 0)
          const line = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0]
          const meta = JSON.parse(line) as { payload?: { cwd?: string; session_id?: string } }
          if (meta.payload?.cwd === cwd && meta.payload.session_id) hits.push(meta.payload.session_id)
        } catch {
          /* 半截文件或格式变了，跳过 */
        } finally {
          await fd.close()
        }
      }
      return { id: hits.length === 1 ? hits[0] : null }
    } catch {
      return { id: null }
    }
  }
)
}
