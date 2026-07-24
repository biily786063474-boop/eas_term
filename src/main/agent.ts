import { ipcMain } from 'electron'
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

async function probeCodex(): Promise<AgentProbe['codex']> {
  try {
    await pExecFile('codex', ['--version'], { timeout: 5000, env: PROBE_ENV })
    return { installed: true, models: CODEX_MODELS, efforts: CODEX_EFFORTS }
  } catch {
    return { installed: false, models: [], efforts: [] }
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:probe', async (): Promise<AgentProbe> => {
    const [claude, codex] = await Promise.all([probeClaude(), probeCodex()])
    return { claude, codex }
  })
}
