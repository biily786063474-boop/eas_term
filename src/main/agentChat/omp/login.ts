// 驱动 omp 的订阅登录（`omp auth-broker login <provider>`）。
//
// ── 这条路和「填 API key」那条是并列的两种选择，不是一种的补充 ────────────────
// omp 认识 70 家服务商，头几个正是最要紧的订阅：Claude Pro/Max、ChatGPT Plus/Pro、
// 智谱 GLM Coding Plan、Kimi Code、GitHub Copilot、Cursor…
// **订阅用户没有 API key，也不该被逼着去申请一把** —— 他们已经付过钱了。
//
// ── 凭证落在哪，以及为什么和密钥柜那条路不一样 ──────────────────────────────
// OAuth 的令牌要能被**刷新**，而刷新是 omp 自己在做的（它把凭证存进
// `<agentDir>/agent.db`）。把令牌搬进我们的密钥柜等于要我们自己实现每一家的刷新逻辑，
// 那既做不好也没必要。所以：
//   · **订阅** → 凭证进 omp 的 agent.db（在我们的隔离配置目录里，不碰用户自己的 ~/.omp）
//   · **API key** → 进我们的密钥柜（用户已有的习惯，一处管所有密钥）
// 两条路在界面上并列，各自说清楚东西存在哪。
//
// ── 为什么不能直接把这个进程扔给用户的终端 ──────────────────────────────────
// 它是为终端写的交互流程：往 stdout 写提示语、从 stdin 读回答。丢给终端的话
// 用户得自己配一遍环境变量（`PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` / `HOME`），
// 少一个就登进了他自己的 `~/.omp`，而我们的会话读不到 —— 界面显示「已登录」、
// 一发消息却说没配。所以由我们起、由我们喂环境。
import { spawn, type ChildProcess } from 'node:child_process'

import type { HostPaths } from '../../../shared/agentChat.ts'
import { ompBaseEnv } from './launch.ts'
import { ompBinPathOrNull } from './paths.ts'
import { createOmpLoginParser } from './loginParse.ts'

/** 登录进行到哪一步。**照 `LoginState` 的形状想** —— 渲染层那侧要显示的东西是一样的：
 *  一个可点的网址、一个可能要贴东西的输入框、一段能看见的输出。 */
export interface OmpLoginState {
  provider: string
  /** `working` = 已经把用户输入交给它、正在验证。**单独一个态**：
   *  没有它的话界面只能停在上一屏（那时它还显示着输入框和已经提交过的内容），
   *  用户不知道自己那一下有没有生效。 */
  phase: 'starting' | 'browser' | 'input' | 'working' | 'done' | 'failed'
  /** 要用户去浏览器打开的地址 */
  url?: string
  /** 本机快捷入口（同一台机器上点它更省事；SSH 场景下只有 `url` 有意义） */
  launchUrl?: string
  /** omp 正在问什么。**原样透传它的原话** —— 不同 provider 问的不一样
   *  （贴授权码 / 填 key / 选账号），我们改写就等于把分类揽回自己身上 */
  prompt?: string
  /** omp 最新说的那一句进度（比如「Validating API key...」）。
   *  **界面只显示这一行，不倒整段日志** —— 用户不该在设置面板里读终端输出。
   *  它是 omp 的原话，所以是真话；一行就够，而且随时被下一句覆盖。 */
  progress?: string
  /** 输出尾部。**只在失败时给用户看** —— 正常流程里读日志是我们没做完事。 */
  lines: string[]
  error?: string
}

type Listener = (s: OmpLoginState) => void

/** **全程只允许一个登录在跑。**
 *
 *  不是洁癖：`auth-broker login` 会占一个固定的本机回调端口（每家一个），
 *  同一家起两次，第二个进程绑不上端口、第一个又可能被第二次浏览器跳转打断，
 *  最后两个都失败而且看不出为什么。
 *
 *  **不借 `cliAuth` 的那个槽**：那是 Claude / Codex 登录用的，借了会出现
 *  「点 omp 登录把正在跑的 Claude 登录踢掉」这种莫名其妙的互斥。 */
let current: { proc: ChildProcess; state: OmpLoginState; listener: Listener } | null = null

function emit(patch: Partial<OmpLoginState>): void {
  if (!current) return
  current.state = { ...current.state, ...patch }
  current.listener(current.state)
}

/** 输出留多少行。失败时要看得见 omp 的原话，但不必把整个日志搬进内存。 */
const MAX_LINES = 40

export function startOmpLogin(
  host: HostPaths,
  provider: string,
  listener: Listener
): { ok: true } | { ok: false; error: string } {
  if (current) return { ok: false, error: '已经有一个登录在进行中，先完成或取消它' }
  const bin = ompBinPathOrNull(host)
  if (!bin) return { ok: false, error: '这个版本的安装包里没有随附 omp 可执行文件' }

  let proc: ChildProcess
  try {
    proc = spawn(bin, ['auth-broker', 'login', provider], {
      // 与会话、冒烟、额度那三处**用同一份环境**：少设一个变量就会登进用户自己的
      // `~/.omp`，而我们的会话读的是隔离目录 —— 症状是「登录成功了，但一发消息说没配」。
      env: ompBaseEnv(host),
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const parser = createOmpLoginParser()
  current = { proc, listener, state: { provider, phase: 'starting', lines: [] } }
  listener(current.state)

  const feed = (chunk: string): void => {
    if (!current) return
    const lines = [...current.state.lines, ...chunk.split('\n').map((l) => l.trimEnd()).filter(Boolean)]
    emit({ lines: lines.slice(-MAX_LINES) })
    for (const e of parser.push(chunk)) {
      if (e.k === 'url') emit({ phase: 'browser', url: e.url, launchUrl: e.launchUrl })
      else if (e.k === 'prompt') emit({ phase: 'input', prompt: e.message })
      else if (e.k === 'progress') emit({ progress: e.text })
      else if (e.k === 'done') emit({ phase: 'done', prompt: undefined, progress: undefined })
    }
  }

  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', feed)
  // **stderr 也要喂进同一个解析器**：有的 provider 把提示写在 stderr 上，
  // 只读 stdout 的话那种就永远等不到提问，界面停在「正在启动」。
  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', feed)

  proc.on('error', (err) => {
    emit({ phase: 'failed', error: err.message })
    current = null
  })
  proc.on('exit', (code) => {
    if (!current) return
    // 退出码 0 **不等于**登录成功：用户中途 Ctrl-C、或者 omp 自己判定放弃，
    // 都可能是 0。真正的判据是它写没写过那句「Credentials saved to …」。
    if (current.state.phase !== 'done') {
      emit({ phase: 'failed', error: `登录没有完成（退出码 ${String(code)}）` })
    }
    current = null
  })
  return { ok: true }
}

/** 把用户贴回来的东西写给它。**结尾必须有换行** —— readline 靠它断句，
 *  少了的话进程会一直等，而界面已经显示「已提交」。 */
export function submitOmpLogin(text: string): { ok: boolean; error?: string } {
  if (!current?.proc.stdin) return { ok: false, error: '没有正在进行的登录' }
  try {
    current.proc.stdin.write(`${text}\n`)
    emit({ phase: 'working', prompt: undefined })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 用户点了取消 / 关掉了面板。 */
export function cancelOmpLogin(): { ok: boolean } {
  if (!current) return { ok: true }
  const p = current.proc
  current = null
  try {
    p.kill()
  } catch {
    // 已经退了
  }
  return { ok: true }
}

/** 现在有没有登录在跑。面板重新挂载时用它决定要不要接着显示。 */
export function ompLoginInFlight(): OmpLoginState | null {
  return current?.state ?? null
}
