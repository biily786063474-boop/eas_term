// 起一个 omp 进程之前要准备的全部东西：**受管配置落盘** ＋ **spawn 参数组装**。
//
// ── 为什么这两件事在同一个文件里 ────────────────────────────────────────────
// 它们是同一个不变量的两半：「omp 跑起来时，看到的必须是我们说了算的那套配置」。
// 拆开的话，很容易出现「env 指向 A 目录、配置写进 B 目录」这种谁看都对、合起来全错的状态
// —— 而那正是 §2.4 隔离承诺里最难发现的破法（`docs/superpowers/specs/2026-09-01-omp-底座接入-design.md`）。
//
// ── 为什么它允许 import electron，而 transport.ts 不允许 ──────────────────────
// 这一层要 `mcpEnv()`（`mcpBridge.ts` 第一行就 import electron）与 `secretsEnv()`
// （用 `app.isReady()`）。transport 那边要能在 `node --test` 下裸跑，
// 所以它只收一个**已经算好**的 spec，不认识 electron、不认识密钥柜、不认识 MCP 桥。
// 这条边界由 `scripts/verify-agent-chat.mjs` 的静态检查钉住。
//
// ── 三道闸：不满足就不起进程 ────────────────────────────────────────────────
// omp 的 `resolveConfigValue`（上游 `config/resolve-config-value.ts:21-27`）是
// 「环境变量取不到就**把那串字面量当 key 用**」。所以少注入一把 key 的症状不是
// 「未配置」而是 **provider 回 401**，用户会跑去改一把**根本没被读到**的 key。
// 与其让他去追那个幻觉，不如在起进程之前就说清楚缺什么。
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { PROBE_ENV } from '../../probeEnv'
import { agentMcpConfigPath, mcpEnv } from '../../mcpBridge'
import { secretsEnv, secretsHas } from '../../secrets'
import type { HostPaths } from '../../../shared/agentChat'
import type { AcpMcpServer, AcpProcess } from './transport.ts'
import { ompAgentDir, ompBinPathOrNull, ompConfigDirRelative, OMP_TOOLS } from './paths.ts'
import {
  ompConfigYml,
  ompEasTermSkillDir,
  ompModelsYml,
  ompSkillMarkdown,
  ompSkillsDir,
  OMP_MODELS_FILENAME,
  type OmpProviderConfig
} from './config.ts'

/** omp 会读、但会把配置目录整个挪走的环境变量。**必须从子进程环境里删掉**。
 *
 *  只设 `PI_CONFIG_DIR` 是不够的（spec v2 一度这么以为）：
 *  · `PI_CODING_AGENT_DIR`（上游 `utils/src/dirs.ts:316-320`）直接覆盖 agentDir，优先级最高
 *  · `OMP_PROFILE` / `PI_PROFILE`（`dirs.ts:39`）让 agentDir 变成 `<root>/profiles/<p>/agent`
 *  · XDG 三件套（`dirs.ts:338-361`）**在 darwin 上也生效**，会把 sessions / agent.db 挪出去
 *
 *  而我们的 spawn 环境是 `{...PROBE_ENV}`＝`{...process.env}` 全量透传，
 *  用户 shell 里设过任何一个都会被继承。目标用户恰恰是「已经在自己装 omp 做实验」的人
 *  —— 最可能设过它们的那批。命中的后果是受管配置整份读不到：`approvalMode` 回落成
 *  omp 的默认值 **yolo**、生图没被 deny、脱敏没开，而且**全程不报错**。
 *
 *  **置空串不算删**：`x || default` 那类判空写法会把空串当没有、回落默认值，
 *  但 `PI_CODING_AGENT_DIR` 那条走的是 `path.resolve()`，空串会解析成进程 cwd。
 *  两种回落方向不同，只有真的 `delete` 才对两者都安全。 */
const SCRUB_KEYS = [
  'PI_CODING_AGENT_DIR',
  'OMP_PROFILE',
  'PI_PROFILE',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME'
] as const

/** 起 omp 要的一切。transport 只认这个结构，不认识它是怎么算出来的。 */
export interface OmpSpawnSpec {
  bin: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

/** 起不来的原因。**分类是给界面用的**，不是给日志用的：
 *  每一类对应用户要做的一件**不同**的事，所以不能合并成一句「配置有问题」。 */
export type OmpBlockedReason =
  /** 包里没有这个平台的二进制（或被改名了） */
  | 'no-binary'
  /** 还没选 provider —— `prefs.omp` 是空的 */
  | 'no-provider'
  /** 选了 provider，但那把 key 不在密钥柜里 */
  | 'no-key'
  /** key 在柜里，但柜子锁着 */
  | 'vault-locked'

export type OmpLaunchPlan =
  | { ok: true; spec: OmpSpawnSpec }
  | { ok: false; reason: OmpBlockedReason; message: string }

export interface OmpLaunchInput {
  cwd: string
  host: HostPaths
  /** 这个会话要注入哪几个环境变量名（`EAS_OMP_<ID>_KEY`）。
   *  **每次 spawn 现算，不缓存在 adapter 上** —— adapter 是模块级常量，
   *  用户换 provider 之后那份静态值就是错的，而空名单会让下面两道闸恒真放行。 */
  keyVarNames: string[]
  /** 带不带 MCP 桥的凭证。**冒烟传 false**：那一轮按设计不碰任何工具，
   *  多给一个能调本机 MCP 桥（含 `/secret-env` 路由）的 token 是白送一条出口。 */
  mcp: boolean
  /** 覆盖默认的 `omp acp` 参数。冒烟用它把工具集钉更窄 */
  extraArgs?: string[]
}

/** 组装 spawn 需要的一切，并在起进程**之前**把不该起的挡下来。
 *
 *  返回值刻意是判别联合而不是抛异常：调用方要把 `reason` 翻成
 *  `{k:'error', kind:'setup'}` 推给界面，异常携带不了这个分类。 */
export function planOmpLaunch(input: OmpLaunchInput): OmpLaunchPlan {
  const bin = ompBinPathOrNull(input.host)
  if (!bin || !fs.existsSync(bin)) {
    return {
      ok: false,
      reason: 'no-binary',
      message: '这个版本的安装包里没有随附 omp 可执行文件（或它被移动过），无法启动。'
    }
  }

  // 闸 ①：名单为空 = 还没选 provider。
  // **必须单独判**：`secretsEnv([])` 直接返回 `{}`（`secrets.ts:329`），
  // 而 `secretsHas([])` 返回空数组、任何 `.every()` 形式的判据对它**恒真**。
  // 少了这一闸，「没选 provider」会一路放行到 401。
  if (input.keyVarNames.length === 0) {
    return { ok: false, reason: 'no-provider', message: '还没选模型服务商，先在设置里选一个并填 key。' }
  }

  // 闸 ②：key 在不在柜里。`secretsHas` **故意不要求解锁**（它的文件头写着），
  // 所以它只回答「有没有」，回答不了「现在拿不拿得到」。
  const has = secretsHas(input.keyVarNames)
  const missing = has.filter((h) => !h.inVault || !h.readable).map((h) => h.varName)
  if (missing.length > 0) {
    return { ok: false, reason: 'no-key', message: `密钥柜里还没有 ${missing.join('、')}，先在设置里填。` }
  }

  // 闸 ③：柜子锁着。`secretsEnv` 在锁定态返回 `{}`（`secrets.ts:330-334`）——
  // 于是「柜里有、但现在取不到」只能靠这个组合推出来：②说有、③拿到空。
  // **不给 secrets.ts 加 `isUnlocked` 导出**：那是 🔴 文件，为一个只读判断去动它不值当。
  const keys = secretsEnv(input.keyVarNames)
  if (Object.keys(keys).length === 0) {
    return { ok: false, reason: 'vault-locked', message: '密钥柜锁着，解锁之后才能起会话。' }
  }

  const agentDir = ompAgentDir(input.host.userData)
  const env: Record<string, string> = {
    ...(PROBE_ENV as Record<string, string>),
    ...(input.mcp ? mcpEnv({ project: input.cwd }) : {}),
    // **HOME 必须与算相对路径用的那个同源**。`agentRules.ts:41-43` 记着一次实测事故：
    // `os.homedir()` 跟随 `$HOME`、`app.getPath('home')` 不跟随，两者分叉过。
    // omp 那边用的是 `os.homedir()`，所以显式把 HOME 钉成我们算路径时用的那一个，
    // 否则会出现「配置写进 A、omp 读的是 B」，而界面显示「已配置」。
    HOME: input.host.home,
    PI_CONFIG_DIR: ompConfigDirRelative(input.host.home, input.host.userData),
    // 绝对路径版。同时设两个是有意的：它优先级最高、且**把 XDG 分支整个关掉**
    // （`dirs.ts:316-320` 一旦有 override，`isDefault` 为假）——
    // 于是 agentDir 不再依赖「相对 HOME」这条假设，Windows 跨盘符那种情形也稳。
    PI_CODING_AGENT_DIR: agentDir,
    // 跳过 omp 的交互式初始化向导（上游 `modes/setup-wizard/index.ts:49`）。
    // 不设的话首次起会话会挂在等输入，界面上看到的是「超时」而看不出原因。
    OMP_SKIP_SETUP: '1',
    // **放最后**：用户 rc 里可能 export 过同名变量，我们注入的这份必须压过它
    ...keys
  }
  for (const k of SCRUB_KEYS) delete env[k]

  return {
    ok: true,
    spec: {
      bin,
      cwd: input.cwd,
      env,
      args: input.extraArgs ?? ['acp', '--approval-mode=always-ask', `--tools=${OMP_TOOLS.join(',')}`]
    }
  }
}

/** 把受管配置整份写到 `<agentDir>`。**每次 spawn 之前都写一遍。**
 *
 *  为什么是「整份重写」而不是「有就不动」：这是我们的目录、我们说了算
 *  （与 `agentRules.ts` 分发规则同一条纪律）。用户要改走我们的设置面板，
 *  手改这里下次起会话就被覆盖 —— 生成的文件头里写明了这一点。
 *
 *  代价（`config.ts` 文件头也记了）：omp 自己 `settings.set` 写回文件的状态会被一并覆盖。
 *  哪天要给它留自留地，就改成「读回来 + 只覆盖我们那几个键」，`ompConfigYml` 的返回值
 *  仍然是那份权威清单。
 *
 *  失败一律抛 —— 配置写不进去还硬起进程，等于分发一个 approvalMode 是 **yolo**、
 *  生图没被 deny 的 agent，那是红线。 */
export function writeManagedConfig(host: HostPaths, providers: OmpProviderConfig[]): void {
  const agentDir = ompAgentDir(host.userData)
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, 'config.yml'), ompConfigYml(agentDir), 'utf8')
  fs.writeFileSync(path.join(agentDir, OMP_MODELS_FILENAME), ompModelsYml(providers), 'utf8')
  // 残留的 config.yaml 读不到（上游命中第一个就 return，`config.yml` 排第一），
  // 删它纯粹是别让排障的人对着一个永不生效的文件想半天。
  const stale = path.join(agentDir, 'config.yaml')
  if (fs.existsSync(stale)) fs.rmSync(stale, { force: true })
  copySkill(host, agentDir)
}

/** 把随包的 `skills/eas-term/` 整个拷过去，只在 SKILL.md 末尾追加一段围栏说明。
 *
 *  **原版一个字不改**（用户 2026-09-02 定的「动得少、方便维护」）：拷贝是原样的，
 *  唯一的 omp 专属文字是那段围栏 —— 原版以后怎么改都自动带过去，
 *  不需要有人记得同步两份内容。
 *
 *  拷不动不算致命：skill 缺席只是模型少一份规则，不像配置写不进去那样会打开红线。
 *  所以这里吞掉异常、只留日志。 */
function copySkill(host: HostPaths, agentDir: string): void {
  try {
    const src = host.isPackaged
      ? path.join(host.resourcesPath, 'skills', 'eas-term')
      : path.join(host.appPath, 'skills', 'eas-term')
    if (!fs.existsSync(src)) return
    const dst = ompEasTermSkillDir(agentDir)
    fs.mkdirSync(ompSkillsDir(agentDir), { recursive: true })
    fs.rmSync(dst, { recursive: true, force: true })
    fs.cpSync(src, dst, { recursive: true })
    const md = path.join(dst, 'SKILL.md')
    if (fs.existsSync(md)) fs.writeFileSync(md, ompSkillMarkdown(fs.readFileSync(md, 'utf8')), 'utf8')
  } catch (e) {
    console.error('[omp] 拷 eas-term skill 失败（不致命，模型会少一份规则）：', e)
  }
}

/** 真正把进程起起来，并包成 transport 认识的那个最小形状。
 *
 *  **stdout 不交给 `wireProc()`**：那里的 data 回调走 `feed()` → `live.translator.push()`，
 *  而 omp 的翻译器返回 `{events, reply}`，for-of 一个对象要么当场抛、要么静默产出垃圾，
 *  而且 `reply` 永远不写回去 —— `session/prompt` 挂死。所以这一层自己切行。 */
export function openOmpProcess(
  input: OmpLaunchInput
): { ok: true; proc: AcpProcess } | { ok: false; message: string; setup: boolean } {
  const plan = planOmpLaunch(input)
  if (!plan.ok) {
    // 'no-binary' 是「这个包坏了」，另外三类都是「你还没配好」——
    // 界面据此决定摆的是普通错误还是「去设置」入口。
    return { ok: false, message: plan.message, setup: plan.reason !== 'no-binary' }
  }
  let child: ChildProcess
  try {
    child = spawn(plan.spec.bin, plan.spec.args, {
      cwd: plan.spec.cwd,
      env: plan.spec.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), setup: false }
  }

  let buf = ''
  return {
    ok: true,
    proc: {
      write(line) {
        child.stdin?.write(line)
      },
      onLine(cb) {
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          buf += chunk
          let i: number
          // 按 \n 切，**最后半行留着** —— JSON-RPC 一行一条，切坏了整条就解析不出来
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line) cb(line)
          }
        })
      },
      onStderr(cb) {
        child.stderr?.setEncoding('utf8')
        // 不解读 stderr —— 那是「判定」，这一层不该猜它是不是致命的
        // （与 `wireProc` 对 stderr 的处理同一条）。只留着给报错时贴尾巴。
        child.stderr?.on('data', (chunk: string) => cb(chunk))
      },
      onExit(cb) {
        child.on('exit', (code, signal) => cb(code, signal))
        // 'error' 是「进程压根没起来」（ENOENT 之类），对上层与退出是同一件事
        child.on('error', () => cb(null, 'error'))
      },
      kill() {
        child.kill()
      },
      pid: child.pid
    }
  }
}

/** 这个会话要带的 MCP 服务器，转成 ACP 的形状。
 *
 *  **来源是同一份**（`agentMcpConfigPath` 写出的那份 JSON），不另写第二份配置 ——
 *  于是用户在「扩展能力」里关掉 MCP，下一次 `session/new` 就跟着不带。
 *
 *  两处必须归一，否则整个 `session/new` 会失败（不是降级）：
 *  · **只取有 `command` 的条目**：插件里可能是 http/sse/url 型，上游 `#toMcpConfig`
 *    对认不出的 transport 直接 `throw`，而 `#configureMcpServers` 的异常会冒到
 *    `session/new` —— 用户看到的是一条 JSON-RPC error，和「模型配错了」长得一模一样。
 *  · **`env` 一律给数组，哪怕是空的**：上游 `#toNameValueMap` 无条件遍历它，
 *    省掉就是 TypeError。 */
export function readMcpServers(pluginId?: string): { servers: AcpMcpServer[]; dropped: string[] } {
  const p = agentMcpConfigPath(pluginId)
  if (!p) return { servers: [], dropped: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { mcpServers?: Record<string, unknown> }
    const servers: AcpMcpServer[] = []
    const dropped: string[] = []
    for (const [name, cfgRaw] of Object.entries(raw.mcpServers ?? {})) {
      const cfg = (cfgRaw ?? {}) as { command?: unknown; args?: unknown; env?: Record<string, string> }
      if (typeof cfg.command !== 'string' || !cfg.command) {
        dropped.push(name)
        continue
      }
      servers.push({
        name,
        command: cfg.command,
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
        env: Object.entries(cfg.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) }))
      })
    }
    return { servers, dropped }
  } catch {
    return { servers: [], dropped: [] }
  }
}

/** 当前进程的 `HostPaths`。**算一次就够**，不要在每个调用点各取一次
 *  —— `process.resourcesPath` 在 dev 下是 undefined，各处各自兜底会长出好几种写法。 */
export function hostPaths(): HostPaths {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? '',
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    home: app.getPath('home')
  }
}
