// 探测子进程用的环境。**只有一份，谁要探测谁引它。**
//
// ── 为什么必须共用 ────────────────────────────────────────────────────
// 从 Dock / Finder 启动的 Electron，其 PATH 是 launchd 给的那份精简版，
// **不含 /opt/homebrew/bin**（终端里能跑是因为 pty 走登录 shell，会读 ~/.zshrc）。
// 所以直接 execFile('which', ['claude']) 会说「没装」，而它明明装着。
//
// 这个补丁原来只写在 agent.ts 里，`agentChat/adapters/detect.ts` 没有 ——
// 于是 AI 对话面板从 Dock 启动时报「没有探测到可用的 CLI」，
// 而同一台机器上「扩展能力」面板却显示 claude/codex 都在。同一个事实写两处，
// 漏的那处只在特定启动方式下暴露，开发时从终端起实例永远测不出来。
//
// 2026-08-18 用户报「会话怎么坏了」时才发现。抽到这里之后，
// 新增探测点直接 import，不会再各写一份。
//
// ── 2026-09-01：同样的病又犯了一次，这次代价更大 ──────────────────────
// 上面这份补丁只补了 homebrew 和 /usr/local，而 Claude Code 2.x 的原生安装器
// 把二进制装在 **`~/.local/bin`**（`~/.local/bin/claude -> ~/.local/share/claude/versions/<版本>`）。
// 用户原本是 npm 全局装的（落在 homebrew/bin，探得到），某次升级 CLI 自己迁走了 ——
// 于是「装了 Claude Code，界面一直说未安装、不给启动按钮」。
// 同一台机器上 codex 还在 homebrew 里，只有 claude 挂，看着更像 app 坏了。
//
// 讽刺的是 `agentInstall.hasBin` 和 `agentSkill.hasCli` 各自维护的候选目录里
// **都有 `~/.local/bin`** —— 三份清单，只有真正决定「装没装」的这份漏了。
// 所以这次不只是加一行：
//
//   1. 候选目录抽成 `userBinDirs()`，上面那两处改成引它，**清单从此只有一份**；
//   2. 更根本的：候选目录再全也是在猜。启动后跑一次登录 shell 问它真实的
//      `$PATH`（`applyLoginShellPath()`），装在 volta / asdf / rye / 自定义前缀
//      任何地方都能找到 —— 只要用户自己的终端里跑得起来。
//      写死的候选只是「问到之前」的止血。
import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

/**
 * 用户级 CLI 的常见安装位置。**唯一一份候选清单。**
 *
 * 顺序即优先级：`~/.local/bin` 放第一是因为它是 Claude Code / Codex 原生
 * 安装器的落点，也是「升级之后突然找不到」这类事故的高发地。
 *
 * 纯函数（home / platform / env 都从参数进）是为了能单测 —— 主进程里
 * `app.getPath('home')` 不跟随 `$HOME`，测试里没法伪造。
 */
export function userBinDirs(
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  // **按目标平台选 path 实现，而不是跟着当前进程走** —— 否则 mac 上跑
  // Windows 分支会拼出 `C:\Users\me\AppData\Roaming/npm` 这种混血路径，
  // 生产行为没错但测不了，等于这条分支永远没人验。
  const P = platform === 'win32' ? path.win32 : path.posix
  const j = (...seg: string[]): string => P.join(home, ...seg)
  if (platform === 'win32') {
    const appData = env.APPDATA || j('AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA || j('AppData', 'Local')
    return [
      j('.local', 'bin'),
      P.join(appData, 'npm'),
      P.join(localAppData, 'Microsoft', 'WindowsApps'),
      'C:\\Program Files\\nodejs'
    ]
  }
  return [
    j('.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    j('.claude', 'local'), // `claude migrate-installer` 的落点，2.x 之前的用户还留着
    j('.bun', 'bin'),
    j('.npm-global', 'bin'),
    j('.volta', 'bin'),
    '/usr/bin'
  ]
}

/**
 * 拼探测用的 PATH：写死候选 → 登录 shell 的 PATH → 进程自带的，去重去空。
 *
 * **空段必须丢掉** —— POSIX 下 PATH 里的空项等于「当前目录」，
 * 而探测是拿用户的 cwd 跑的，等于给了任意目录下同名脚本一次执行机会。
 */
export function buildProbePath(
  dirs: string[],
  loginPath: string | null,
  basePath: string,
  delim: string = path.delimiter
): string {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (d: string): void => {
    if (!d || seen.has(d)) return
    seen.add(d)
    out.push(d)
  }
  for (const d of dirs) push(d)
  for (const d of (loginPath ?? '').split(delim)) push(d)
  for (const d of (basePath ?? '').split(delim)) push(d)
  return out.join(delim)
}

/** 包住登录 shell 输出的标记。rc 文件会打 banner / 补全提示 / p10k 的转义序列，
 *  不加标记就会把那些噪声当成 PATH。 */
const MARK = '__EAS_PATH__'

/** 从登录 shell 的整段输出里取出 PATH。取不到返回 null（宁可退回候选目录）。 */
export function parseLoginPath(out: string): string | null {
  const m = out.match(new RegExp(`${MARK}([\\s\\S]*?)${MARK}`))
  const v = m?.[1]?.trim()
  return v ? v : null
}

const HOME = os.homedir()

export const PROBE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: buildProbePath(
    userBinDirs(HOME, process.platform, process.env),
    null,
    process.env.PATH ?? ''
  )
}

let applied = false

/**
 * 问登录 shell 要一次真实的 `$PATH`，合并进 `PROBE_ENV`。
 *
 * **就地改 `PROBE_ENV.PATH`，不返回新对象** —— 各处是
 * `import { PROBE_ENV }` 之后直接当 env 用的，换对象它们看不见。
 *
 * `-lic`：`-l` 读 `.zprofile`/`.zlogin`，`-i` 才读 `.zshrc` ——
 * 而绝大多数人的 PATH 恰恰写在 `.zshrc` 里。代价是会吃到交互式 rc 的输出，
 * 所以用 `MARK` 把 PATH 夹出来。
 *
 * 失败一律沉默：拿不到就继续用写死候选，**绝不能让探测这条路整个挂掉**。
 */
export function applyLoginShellPath(timeoutMs = 4000): Promise<boolean> {
  if (process.platform === 'win32' || applied) return Promise.resolve(false)
  applied = true
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      resolve(ok)
    }
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(process.env.SHELL || '/bin/zsh', ['-lic', `printf '${MARK}%s${MARK}' "$PATH"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: process.env
      })
    } catch {
      finish(false)
      return
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish(false)
    }, timeoutMs)
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    proc.on('close', () => {
      clearTimeout(timer)
      const login = parseLoginPath(out)
      if (!login) return finish(false)
      PROBE_ENV.PATH = buildProbePath(
        userBinDirs(HOME, process.platform, process.env),
        login,
        process.env.PATH ?? ''
      )
      finish(true)
    })
  })
}
