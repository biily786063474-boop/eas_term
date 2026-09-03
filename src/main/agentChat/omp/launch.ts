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
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { agentMcpConfigPath, mcpEnv } from '../../mcpBridge.ts'
import type { HostPaths } from '../../../shared/agentChat'
import type { AcpMcpServer, AcpProcess } from './transport.ts'
import { ompLaunchGate } from '../../../shared/ompSetup.ts'
import { ompAcpArgs, ompAgentDir, ompBaseEnv, ompBinPathOrNull } from './paths.ts'
import { readOmpSetup } from './store.ts'
import {
  ompConfigYml,
  ompEasTermSkillDir,
  ompModelsYml,
  ompSkillMarkdown,
  ompSkillsDir,
  OMP_MODELS_FILENAME
} from './config.ts'


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
  /** 选了哪家。**闸门现在只剩这一条判据** —— 凭证在不在、过没过期全是 omp
   *  自己的事（在它的 `agent.db` 里），它比我们清楚，报的话也比我们编的准。
   *  我们唯一还该拦的是「压根没选服务商」，因为那时连起哪一家都不知道。 */
  provider?: string
  /** 带不带 MCP 桥的凭证。**冒烟传 false**：那一轮按设计不碰任何工具，
   *  多给一个能调本机 MCP 桥（含 `/secret-env` 路由）的 token 是白送一条出口。 */
  mcp: boolean
  /** 覆盖默认的 `omp acp` 参数。冒烟用它把工具集钉更窄 */
  extraArgs?: string[]
  /** 角色契约原文（`AgentRole.contract`）。走 `--append-system-prompt`。
   *  **只在 spawn 时传一次** —— 会话跑起来之后换角色改不了，
   *  界面那侧因此规定「换角色 = 结束当前会话重开」。 */
  roleContract?: string
  /** 角色的工具边界。`deny` 作用到 `--tools` 白名单（做减法，见 `ompToolsFor`），
   *  `denyServers` 作用到交给 `session/new` 的 MCP 名单（见 `readMcpServers`）。 */
  roleTools?: { deny?: string[]; denyServers?: string[] }
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

  // **闸门只剩一条判据了**（`shared/ompSetup.ts` 的 `ompLaunchGate`，纯函数、有单测）。
  // 拆掉密钥柜之后这里不再问柜子要任何东西 —— 凭证是 omp 自己的事。
  const gate = ompLaunchGate({ provider: input.provider })
  if (!gate.ok) return { ok: false, reason: gate.reason, message: gate.message }

  // **一个 key 都不注入。** omp 的 `auth-broker` 自己存、自己续期，
  // 需要 API key 的那些 provider 它自己会问。我们再塞一份进去只会打架：
  // `models.yml` 里的 `apiKey` 会**压过** broker 的凭证，登录成功也 401
  // （2026-09-02 真机，用户看到的是 MiniMax 的 1004）。
  const env: Record<string, string> = {
    ...ompBaseEnv(input.host),
    ...(input.mcp ? mcpEnv({ project: input.cwd }) : {})
  }

  return {
    ok: true,
    spec: {
      bin,
      cwd: input.cwd,
      env,
      args: input.extraArgs ?? ompAcpArgs(input.host, input.roleContract, input.roleTools)
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
 *  失败一律抛 —— 配置写不进去还硬起进程，等于分发一个**四条 deny 全没生效**的
 *  agent（生图 / 浏览器 / 电脑控制 / TTS 一路放行），那是红线。
 *  审批档位倒是可以缺省（缺省即 yolo，那本来就是默认），deny 不行。
 *
 *  **每次 spawn 前都读一遍用户的档位**，所以设置面板改完不用重启 ——
 *  下一次起会话自然带上。（判据挂在「起会话」这个必经之路上，
 *  不挂在某次点击的回调里 —— 那个形状在 omp 这条链路上已经错过三次。） */
export function writeManagedConfig(host: HostPaths): void {
  const agentDir = ompAgentDir(host.userData)
  fs.mkdirSync(agentDir, { recursive: true })
  const approvalMode = readOmpSetup(host.userData).approvalMode
  fs.writeFileSync(
    path.join(agentDir, 'config.yml'),
    ompConfigYml(agentDir, { approvalMode }),
    'utf8'
  )
  // **`providers` 恒为空，不接受参数。** 上游 `model-registry.ts:1377-1379` 明写
  // `apiKey` 会「wins over OAuth tokens from the broker」—— 我们往里写任何一条，
  // 都等于用自己那套顶掉 omp 刚存好的凭证（2026-09-02 用户看到的 MiniMax 1004）。
  // 拆掉密钥柜之后我们没有任何理由再声明 provider：模型表是 omp 自己的。
  fs.writeFileSync(path.join(agentDir, OMP_MODELS_FILENAME), ompModelsYml(), 'utf8')
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
export function readMcpServers(
  pluginId?: string,
  /** 角色禁用的 MCP server 名。**在这里就摘掉，不交给 omp** ——
   *  omp 的 ACP `session/new` 只收一份「要连哪些」的名单，没有「连上但禁用」的说法。
   *  Claude 那侧是把它展开成 `mcp__<名>__*` 加进 deny，Codex 是
   *  `mcp_servers.<名>.enabled=false`；三条路各不相同，但结论一致：
   *  选了「画师」，图像类 MCP 的工具在会话里就不该存在。 */
  denyServers?: readonly string[]
): { servers: AcpMcpServer[]; dropped: string[] } {
  const p = agentMcpConfigPath(pluginId)
  if (!p) return { servers: [], dropped: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { mcpServers?: Record<string, unknown> }
    const servers: AcpMcpServer[] = []
    const dropped: string[] = []
    const banned = new Set(denyServers ?? [])
    for (const [name, cfgRaw] of Object.entries(raw.mcpServers ?? {})) {
      // 角色禁掉的：**不进 servers，也不记进 dropped** ——
      // dropped 是给用户看的「这几个配置坏了」，而这是有意不连的，不是故障。
      if (banned.has(name)) continue
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

/** 问 omp 要订阅额度。**独立的短命进程**，与 Codex 读自己的日志是同一个模式。
 *
 *  事件流里只有花费与上下文占用，订阅额度只有这条路拿得到。
 *  **失败一律安静返回 null** —— 为一个百分比惊动用户，比额度条空着更烦人
 *  （`quotaApi.ts` 的四条纪律第 2 条，逐字适用）。
 *
 *  env 走 `ompBaseEnv`：少设一处就会去读用户**真实的 `~/.omp`**，
 *  拿回来的是别人账号的额度，而且不报错。 */
export function readOmpUsage(host: HostPaths, timeoutMs = 8000): Promise<unknown | null> {
  const bin = ompBinPathOrNull(host)
  if (!bin || !fs.existsSync(bin)) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      bin,
      ['usage', '--json'],
      { env: ompBaseEnv(host), timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          resolve(JSON.parse(stdout))
        } catch {
          resolve(null)
        }
      }
    )
  })
}
