// 会话进程管理。这一层是胶水：spawn / 喂行 / 推事件 / 定时回收。
// 「什么时候该回收」「该直接发还是重启 resume」「hook 请求怎么转成审批事件」
// 全部由 sessionState.ts 与 approvalRegistry.ts / approvalRoute.ts 的纯函数回答——
// 那些才测得了。**任何 if 判断如果需要写测试，就说明它放错地方了，应该挪回纯函数那边。**
// 本文件不写单测（2026-08-14 Ruling 3：胶水层的接线错误交给 Task 9 的真实端到端验证兜底）。
// （「审批两路怎么缝」是 Ruling 4 之前的措辞——实测流里的 hook 事件没有可用的关联键，
// 审批完全由 hook 脚本单独驱动，压根不存在"两路"要缝，这里的说法已经改过来。）
//
// 消息怎么送到 CLI 手上，两边完全不同、且都不是「分支出来的」，而是由 adapter 声明的
// `stdin` 字段决定（唯一允许按 CLI 分支的地方是选 translator，见下）：
// - Claude（stdin:'pipe'）：进程常驻，多轮共用同一个进程，每条消息是一行
//   `{"type":"user","message":{"role":"user","content":"..."}}` 写进 stdin
//   （spec §A.3 实测过，claude.ts 的文件头也把这一步的责任明确交给了这一层）。
// - Codex（stdin:'ignore'）：`exec` 一次只吃一个 prompt 就退出，prompt 是**位置参数**，
//   不经 stdin（codex.ts 文件头已经写明）。这里的处理是通用规则「stdin 是 ignore 时，
//   把消息追加进 buildArgs() 返回的 args 末尾」——不是 `if (cli==='codex')`，是照 adapter
//   自己声明的 stdin 能力位来决定，第三个 CLI 只要照这个约定填 stdin 字段就能直接工作。
//   代价：`codex exec resume <id> --json --sandbox X -m M -c K=V "<prompt>"` 这个位置参数
//   跟在全部 flag 后面是否总能被正确解析，spike 只验证过不带 resume/-m/-c 的最简形态
//   （见 docs/cli-headless-接口实测.md），resume 分支与多 flag 组合未被真实跑过，
//   照 clap 系 CLI 的通用行为推断——若 Task 9 或后续实测发现不成立，这里要跟着改。
import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, type WebContents } from 'electron'
import { getAdapter, listAdapters } from './adapters/index.ts'
import {
  NO_SILENCE,
  silenceAfterSlash,
  endSilence,
  shouldSilence,
  type SilenceState
} from './slashSilence'
import { createApprovalRegistry } from './approvalRegistry.ts'
import { onApprovalRequest, onApprovalSettled, resolveApproval as resolveApprovalGlobal } from './approvalRoute.ts'
import { planHookInstall, planHookUninstall, hookInstallStatusOf } from './hookInstall.ts'
import { shouldReap, planSend, applyParamChange, type SessionRecord , planRecovery} from './sessionState.ts'
import { tally, ZERO_TALLY } from '../../shared/teamCost'
import { buildCliList, type TerminalOnlyCli } from './cliList.ts'
import { detectByWhich } from './adapters/detect.ts'
import { installPlan } from '../agentInstall.ts'
import { guardPath } from '../fsGuard.ts'
import { WORKTREE_DIR } from '../../shared/teamWorktree.ts'
import { THIN_BYTES } from '../../shared/teamFindings.ts'
import { mcpEnv } from '../mcpBridge.ts'
import { PROBE_ENV } from '../probeEnv.ts'
import { AGENT_CHAT_EVENT_CHANNEL } from '../../shared/agentChat.ts'
import { agentMcpConfigPath } from '../mcpBridge.ts'
import type {
  ChatEvent,
  StartOpts,
  AgentChatStartParams,
  AgentChatStartResult,
  AgentChatSendResult,
  AgentApprovalHookStatus,
  AgentChatEventEnvelope,
  CliInfo,
  SessionBrief
} from '../../shared/agentChat.ts'

interface Live {
  rec: SessionRecord
  proc?: ChildProcess
  /** **这次进程消失是我们自己动的手。**
   *
   *  区分它是因为退出码分不清：`kill()` 送信号时 `on('exit')` 拿到的 code 是 null，
   *  而外部把进程杀掉（系统压力、崩溃、网络层把它带走）拿到的**也是 null**。
   *  老判据把 null 一律当成「我们 kill 的」，于是真正被打断的会话被记成正常结束，
   *  自动恢复永远不会触发。
   *
   *  三处主动 kill（restart / 空闲回收 / 用户点停）都要在 kill 之前把它立起来。 */
  killing?: boolean
  translator: { push(line: string): ChatEvent[] }
  approvals: ReturnType<typeof createApprovalRegistry>
  stdoutBuf: string
  /** 这个会话的事件只推给创建它的那个 webContents——不是全窗口广播。
   *  和 pty.ts 的 `wc.send(pty:data:${id}, ...)` 同一个道理。 */
  wc: WebContents
  /** 创建它的 webContents 的数字 id，创建时就取好。**不要在清理时现读 live.wc.id**：
   *  `win.on('closed')` 触发时 webContents 已经销毁，读它的属性会抛
   *  （index.ts 里那句 `const wcId = win.webContents.id` 提前取值就是为了这个）。
   *  pty.ts 的 entry.wcId 是同样的做法。 */
  wcId: number
  /** 切模型/切强度的 slash 回执静默期。状态机在 slashSilence.ts（纯函数，可单测）。 */
  silence: SilenceState
}

const sessions = new Map<string, Live>()
let nextId = 1

/** 按行切分喂给 translator——stdout 的 chunk 边界不等于行边界，
 *  不缓冲的话会把一行 JSON 劈成两半，解析必然失败 */
function feed(live: Live, chunk: string, emit: (e: ChatEvent) => void): void {
  live.stdoutBuf += chunk
  const lines = live.stdoutBuf.split('\n')
  live.stdoutBuf = lines.pop() ?? ''
  for (const l of lines) {
    // 审批不经过这里——它由 hook 路单独驱动（见 Task 3 背景，实测两路无共同关联键）
    for (const e of live.translator.push(l)) emit(e)
  }
}

// ── hook 脚本的绝对路径 + 怎么跑它（Ruling 12：打包后找不到会让审批功能整个是死的） ──────

/** 照抄 mcpBridge.ts:99 serverScriptPath() 的样板：打包版资源在 process.resourcesPath 下，
 *  开发时在源码树的 resources/ 下（package.json 的 extraResources 已加上 agent-hooks 这一项，
 *  见本次改动）。 */
function hookScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'agent-hooks', 'eas-pretooluse.mjs')
    : path.join(app.getAppPath(), 'resources', 'agent-hooks', 'eas-pretooluse.mjs')
}

/** hook 脚本要用哪个 node 跑。镜像 mcpBridge.ts 的 runnerFor()：GUI 启动的 app PATH
 *  很贫瘠（常只有 /usr/bin:/bin），bare 'node' 未必解析得到。这里只需要单个可执行文件
 *  路径去拼 shell 命令字符串，不需要 runnerFor 完整的 spawn 语义（它返回给 MCP server
 *  配置用的 {command,args,env} argv 数组形式），所以本地建一份短的，不改 mcpBridge.ts
 *  的导出面。
 *
 *  **兜底不能是裸 'node'**（审查发现的 Important）：PreToolUse hook 只有 exit code 2
 *  才会阻塞工具调用，其它任何"跑不起来"——包括 command not found——都是 non-blocking，
 *  工具照常执行、不等审批。也就是说 hook 起不来 = 审批静默失效（fail open），
 *  而且没有任何用户可见的信号。win32 分支的候选列表故意留空（Windows 上系统 node
 *  的常见安装位置不像 mac 那样有一两个固定路径可猜），这意味着**所有 Windows 用户**
 *  过去都会落到这个兜底——弱兜底 = 事实上的默认失效。
 *
 *  照抄 runnerFor() 真正管用的那条兜底：退回本 app 自带的 Electron 二进制
 *  （`process.execPath`）。它在任何装了这个 app 的机器上都保证存在，不依赖用户机器
 *  装没装 node、装在哪。配合 restartAndDeliver 里 spawn Claude 时注入的
 *  `ELECTRON_RUN_AS_NODE=1`——这个环境变量会经 Claude Code 的进程环境一路继承给它
 *  自己再起的 hook 子进程，让 Electron 以纯 node 模式跑。选环境变量而不是在这条
 *  shell 命令字符串里写 `VAR=val cmd` 前缀，是因为那种写法只有 POSIX shell 认，
 *  Windows 的 cmd.exe/PowerShell 不认——环境变量继承不依赖 shell 语法，是唯一一条
 *  跨平台都成立的路。 */
function nodeBinForHook(): string {
  const candidates =
    process.platform === 'win32' ? [] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* 试下一个 */
    }
  }
  return process.execPath
}

/** hook 脚本本身没有可执行位（打包资源目录里的普通静态文件，见 resources/agent-hooks/
 *  的 git 记录），且开发路径可能含空格（本仓库就是一例：".../vibe coding/terminal"）——
 *  所以不依赖 shebang + chmod +x，显式用 node 解释器跑，并给两段路径都加引号，
 *  避免在空格处被 shell 切成多个 token。nodeBin 由调用方传入（restartAndDeliver 里的
 *  hookNodeBin，或 approvalHookStatus 里现算的一份）——不在这里重复调 nodeBinForHook()
 *  （2026-08-14 全分支评审 I3：算一次、按需复用）。 */
function hookCommand(nodeBin: string): string {
  const quote = (s: string): string => `"${s}"`
  return `${quote(nodeBin)} ${quote(hookScriptPath())}`
}

function hookConfigPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.json')
}

function readHookConfig(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {} // 不存在 / 不是合法 JSON，都当空处理
  }
}

/** 写用户项目文件前先备份（2026-08-14 全分支评审 C1 ②：照抄 agentHook.ts 的 writeJson()
 *  做法）。tmp+rename 只保证不会写出半截文件，不保证内容本身没问题——万一
 *  planHookInstall/planHookUninstall 算出的下一份配置有错，用户还能从 .eas-backup 手动
 *  找回原文件。备份失败不阻断写入（和 agentHook.ts 的容错策略一致），但也别声张。 */
function writeHookConfig(target: string, data: unknown): { ok: boolean; reason?: string } {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (fs.existsSync(target)) {
      try {
        fs.copyFileSync(target, target + '.eas-backup')
      } catch {
        /* 备份失败不阻断，但也别声张 */
      }
    }
    const tmp = target + '.eas-tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return { ok: true }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.error('[agentChat] hook 写入失败', e)
    return { ok: false, reason }
  }
}

/** 往 <cwd>/.claude/settings.json 装 PreToolUse hook。只有 adapter 自己声明
 *  `approvalHook === 'claude-pretooluse'` 才需要——目前只有 Claude；这是"用哪种审批机制"
 *  的声明，与 capabilities.approval("能不能弹审批卡片")是两件事，调用点（restartAndDeliver）
 *  不再用 `capabilities.approval.length > 0` 当开关（2026-08-14 全分支评审 I6 第 2 点）。
 *
 *  这是用户自己的文件（spec §九 第 2 条 + hookInstall.ts 文件头）：
 *  - 读不出来（不存在/损坏）当空对象处理——planHookInstall 自己能吞坏形状，不在这里判断
 *  - 写之前必须过 fsGuard 的 guardPath 边界；cwd 不在任何已注册项目/知识库内时跳过不写
 *  - changed:false 时不写——那个函数是幂等的，每次启动都写没有意义，还会在用户
 *    手改过的文件上留下不必要的 diff（brief 原话："那个函数是幂等的，每次启动重复写没意义"）
 *
 *  **返回值不是可有可无的诊断信息，调用方必须处理失败**（审查发现的 Important）：
 *  PreToolUse hook 装不上 ≠ 温和降级。Claude Code 的 hook 机制只有 exit code 2 才会
 *  阻塞工具调用，其它任何"跑不起来"都是 non-blocking——装不上 hook 就等于这个会话
 *  完全没有审批保护、工具照常执行，而且**没有任何用户可见的信号**（claudeEvents.ts
 *  把流里的 hook 事件全当噪音丢了，这条路唯一的痕迹曾经只有主进程的 console.error，
 *  用户看不到）。裁定：不能因为装不上就拒绝启动会话（用户在未注册目录里临时用是合理
 *  需求），但必须让用户看见"这次没有保护"——调用方要把这里的失败转成一条
 *  {k:'error', fatal:false} 事件推给渲染层。 */
function installApprovalHook(cwd: string, nodeBin: string): { ok: boolean; reason?: string } {
  const target = hookConfigPath(cwd)
  const g = guardPath(target)
  if (!g.ok) {
    console.error('[agentChat] 跳过 hook 安装（不在允许写入的目录内）：', g.error)
    return { ok: false, reason: g.error }
  }
  const plan = planHookInstall(readHookConfig(g.path), hookCommand(nodeBin))
  if (!plan.changed) return { ok: true }
  return writeHookConfig(g.path, plan.next)
}

/** 卸载：只摘我们那条 marker 痕迹，用户自己的配置一个字不动（2026-08-14 全分支评审
 *  C1 ③：对齐 agentHook.ts 既有的 hook:uninstall 形状——这条 hook 比"提交即复盘"那条
 *  更侵入（PreToolUse 会阻塞，PostToolUse 不会），至少要能一键卸干净）。 */
function uninstallApprovalHook(cwd: string): { ok: boolean; reason?: string } {
  const target = hookConfigPath(cwd)
  const g = guardPath(target)
  if (!g.ok) return { ok: false, reason: g.error }
  const plan = planHookUninstall(readHookConfig(g.path))
  if (!plan.changed) return { ok: true }
  return writeHookConfig(g.path, plan.next)
}

/** 查询某个项目现在有没有装这个 hook（供渲染层展示，对齐既有 hook:status 的形状——
 *  2026-08-14 全分支评审 C1 ③）。guardPath 不通过（cwd 不在任何已注册项目/知识库内）时
 *  如实报「没装」——install 本来也走同一道 guard，装不上去，报「没装」不算撒谎。
 *  这是一次用户触发的偶发查询，不在 restartAndDeliver 的热路径上，所以现算一次
 *  nodeBinForHook() 就够，不必额外传参复用（I3 的"只算一次"针对的是每次消息都会走的
 *  那条路径）。 */
function approvalHookStatus(cwd: string): AgentApprovalHookStatus {
  const configPath = hookConfigPath(cwd)
  const g = guardPath(configPath)
  if (!g.ok) return { installed: false, outdated: false, configPath }
  const status = hookInstallStatusOf(readHookConfig(g.path), hookCommand(nodeBinForHook()))
  return { ...status, configPath }
}

// ── 事件推送 + 会话状态的机械式更新（不是判定，只是照实记录已经发生的事） ──────────────

/** 推给创建这个会话的那个 webContents。频道是**常驻单频道**、sessionId 走 payload——
 *  不是 `agentChat:event:<id>` 那种动态频道（2026-08-17 全分支最终评审 C1：本 handler
 *  在 `return` 之前就同步推完首批事件，动态频道那时还没有任何监听器，事件被静默丢弃；
 *  实测 30 条只到 1 条）。详见 shared/agentChat.ts 的 AGENT_CHAT_EVENT_CHANNEL 注释。 */
function emitEvent(live: Live, e: ChatEvent): void {
  if (!live.wc.isDestroyed()) {
    const envelope: AgentChatEventEnvelope = { sessionId: live.rec.id, event: e }
    live.wc.send(AGENT_CHAT_EVENT_CHANNEL, envelope)
  }
}

/**
 * 切模型 / 切强度走的是给 CLI 发 `/model`、`/effort` slash command，CLI 会用一条
 * 普通的助手消息回执（「Set effort level to high (this session only): …」），
 * 一条条铺在对话区里。用户拨一次强度滑块就多出五六条，把真正的对话顶没了。
 * 静默执行 —— 判据、解除路径和为什么不按文案匹配，全在 slashSilence.ts 里写着。
 */
function isSilenced(live: Live, e: ChatEvent): boolean {
  const { silenced, next } = shouldSilence(live.silence, e.k, Date.now())
  live.silence = next
  return silenced
}

/** translator 产出的事件里，session.ready 携带了 CLI 原生的会话/线程 id——
 *  记下来才能在下次 restart 时 --resume 接上（决定 4）。其余事件原样转发，
 *  这不是"判定"，只是把已经发生的事实记进 SessionRecord。
 *
 *  Codex 的 thread.started 没有 model/cwd，codexEvents.ts 特意留空串，注释写着"等
 *  session.ts 用启动参数补齐"——这里补上，不能让这句承诺落空（2026-08-14 全分支评审
 *  I4）。补的是 live.rec 在 restartAndDeliver 里已经写好的、这次真正用来启动这个进程的
 *  参数，不是编造值。`||` 只在 e.model/e.cwd 是空串时才回退，Claude 的 init 事件本来就
 *  带真实值，不会被覆盖。 */
function handleEvent(live: Live, e: ChatEvent): void {
  if (isSilenced(live, e)) return
  // busy 的唯一来源。**放在 isSilenced 之后是有意的** —— 静默期吞掉的那些
  // turn.start/turn.done 属于 slash 回执（切模型/切强度），不是真的在干活，
  // 不该让面板显示成「在跑」。slashSilence.ts:48-53 明写了这两种事件都会被吞。
  // **后台任务的标记在这里立、在这里清。**
  //
  // 立：exec.start 的 label 就是工具名（toLabel 对这几个是原样返回的），
  //     Workflow / Task / Agent 都是「派出去、自己在后台跑」的东西。
  // 清：下一轮 turn.start —— 它又开始说话了，说明后台那件事回来了。
  if (e.k === 'exec.start' && BG_TOOLS.has(e.label.trim())) {
    live.rec = { ...live.rec, bgTask: true }
  }
  if (e.k === 'turn.start') live.rec = { ...live.rec, busy: true, bgTask: false }
  else if (e.k === 'turn.done') {
    // 用量在这里收 —— **CLI 只在 turn.done 报一次**，错过就补不回来。
    // 累加规则（token 加、花费取最新）见 shared/teamCost.ts，那是实测出来的
    live.rec = {
      ...live.rec,
      busy: false,
      tally: tally(live.rec.tally ?? ZERO_TALLY, e.usage, e.costUsd),
      // 跑完一轮 = 上次那场中断真的翻篇了。**账要清** ——
      // 不清的话，一个断过一次、恢复后又跑了几小时的 agent，
      // 下次再断就直接吃到「试到头了」。
      retries: 0,
      ended: undefined
    }
  }
  if (e.k === 'session.ready') {
    live.rec = { ...live.rec, resumeId: e.sessionId, alive: true, lastActiveAt: Date.now() }
    emitEvent(live, { ...e, model: e.model || live.rec.model || '', cwd: e.cwd || live.rec.cwd })
    return
  }
  emitEvent(live, e)
}

/** Claude 走 stdin 送消息用的行格式（spec §A.3 实测确认）。这是 Claude 专有的 wire
 *  format，但只有一个 CLI 声明 stdin:'pipe'，所以不构成"按 cli 分支"——等哪天第二个
 *  stdin:'pipe' 的 CLI 接进来、且格式不一样，这里才需要真正分支，到时候再改。 */
function writeStdin(live: Live, message: string): void {
  if (!live.proc?.stdin) return
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n'
  try {
    live.proc.stdin.write(line)
  } catch {
    // 进程可能正在退出，写入失败不算致命——和 pty.ts 的 pty:write 同样的容错方式
  }
}

function wireProc(live: Live, proc: ChildProcess): void {
  // 新进程接上了 —— 上一轮的「是我们杀的」到此为止。
  // 这是第二道保险：万一还有别的路径立了标记却没等到 exit，
  // 也不会连累下一个进程的判定。
  live.killing = false
  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    // 收到输出＝还活着，不是空闲——15 分钟空闲回收判的是「没交互」，一轮长任务
    // 跑再久也不该被当成空闲杀掉，所以每收到一块输出就续一次 lastActiveAt。
    live.rec = { ...live.rec, lastActiveAt: Date.now() }
    feed(live, chunk, (e) => handleEvent(live, e))
  })
  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', (chunk: string) => {
    // stderr 不做任何解读——那是"判定"，这一层不该猜它是不是致命。只留痕迹方便排障。
    console.error(`[agentChat:${live.rec.id}] stderr`, chunk)
  })
  proc.on('error', (err) => {
    // 进程级错误一定是中断 —— 正常收尾走的是 exit，不走这里
    live.rec = { ...live.rec, alive: false, busy: false, ended: 'interrupted' }
    handleEvent(live, { k: 'error', message: err.message, fatal: true })
  })
  proc.on('exit', (code, signal) => {
    live.proc = undefined
    // busy 一并落回：进程都没了，不可能还在跑一轮。不清的话，崩在半路的会话会
    // 永远停在 busy=true，面板把一个连进程都没有的会话显示成「在跑」。
    // 中断的三条证据，命中任意一条就算 —— 但**前提是这一下不是我们自己动的手**。
    //
    // ① `killing` 为真 → 我们主动 kill（重启 / 空闲回收 / 用户点停），一律不算中断。
    //    没有这个标记的话，`kill()` 和「进程被外部杀掉」在 exit 回调里长得一模一样
    //    （code 都是 null），自动恢复要么永不触发、要么在用户点了「停」之后
    //    还自己爬起来。
    // ② **被信号带走**（signal 非空且不是我们杀的）→ 一定是异常，进程没机会收尾。
    // ③ 退出时 `busy` 还是 true → 话说到一半没的；或者退出码非 0。
    //    Codex 的 exec 跑完一轮正常退出时 busy 已经落回 false、code 是 0，不会误判。
    const selfKilled = live.killing === true
    live.killing = false
    // **进程怎么没的，一律留痕。**
    //
    // 2026-08-20 用户报「三次派发，三次死在同一处：agent 还在跑，承载它的
    // 会话进程就没了」——那是 claude **自己进程内**的 Task 子 agent，
    // 不是我们的 team agent。查的时候发现这条路径一句日志都没有：
    // 退出码、信号、当时是不是 busy、静默了多久，全都无从得知。
    // 没有这些，任何结论都只能靠猜。
    logSession(
      `进程结束 ${live.rec.role ?? live.rec.id}` +
        `（code=${String(code)} signal=${String(signal)}` +
        ` busy=${String(live.rec.busy)} 后台任务=${live.rec.bgTask ? '有' : '无'}` +
        ` 静默=${Math.round((Date.now() - live.rec.lastActiveAt) / 1000)}s` +
        ` 我们杀的=${selfKilled ? '是' : '否'}）`
    )
    const interrupted =
      !selfKilled && (!!signal || live.rec.busy === true || (code !== 0 && code !== null))
    live.rec = {
      ...live.rec,
      alive: false,
      busy: false,
      ended: interrupted ? 'interrupted' : 'ok'
    }
    // code === 0 或 null（被我们自己 kill）都不算错——Codex 的 exec 正常跑完一轮后
    // 本来就会退出，那是预期行为，不是故障。
    //
    // **`selfKilled` 也不算错。** kill() 送的是 SIGTERM，进程自己处理掉的话退出码
    // 是 143（128+15）—— 非 0 非 null，正好落进下面这条。于是用户点一下「停」，
    // 除了那句温和的「已停下这一轮」，还会收到一条红色的
    // 「CLI 进程退出（code 143）」。用户 2026-08-20 的原话：「有点多余，有点吓人」。
    // 他自己按的停，那不是故障。空闲回收和 restart 同理。
    if (!selfKilled && code !== 0 && code !== null) {
      handleEvent(live, { k: 'error', message: `CLI 进程退出（code ${code}）`, fatal: true })
    }
  })
}

/** restart 分支：无条件先 kill 再 spawn（Ruling 8）。planSend 是纯函数、杀不了进程；
 *  若 alive 因系统休眠等原因滞后，不先 kill 就 spawn 会造成两个进程同时存活、
 *  stdout 都灌进同一个 translator。kill 是幂等的（已经死的进程再 kill 一次没有副作用），
 *  无脑调即可。 */
function restartAndDeliver(live: Live, opts: StartOpts, message: string): void {
  // **只有真的有进程要杀时才立这个标记。**
  // 写成无条件 `live.killing = true` 会留下一个永久为真的标记：
  // proc 已经是 undefined（会话刚建、或已被空闲回收）时 kill() 根本不发生，
  // 也就没有 exit 事件来清它 —— 于是**之后那个进程无论怎么没的，都会被当成
  // 「我们自己杀的」**，自动恢复永远不触发。2026-08-20 端到端验证时抓到：
  // kill -9 掉 agent 的进程，面板照样记成 ended:'ok'。
  if (live.proc) {
    live.killing = true
    live.proc.kill()
  }
  live.proc = undefined

  const adapter = getAdapter(live.rec.cli)
  if (!adapter) {
    handleEvent(live, { k: 'error', message: `未知 CLI：${live.rec.cli}`, fatal: true })
    return
  }

  // hook 脚本万一要靠兜底（本 app 自带的 Electron 二进制）跑，才需要 ELECTRON_RUN_AS_NODE。
  // 算一次，装 hook 用的 hookCommand() 和下面 spawn 的 env 共用同一个值——不重复探测
  // fs.existsSync，也不会出现"装 hook 时判定用了兜底、spawn 时却没注入"这种不一致
  // （2026-08-14 全分支评审 I3：这里原来无条件注入，会经 CLI 进程一路"传染"给 agent 在
  // 这个会话里跑的每一条 Bash——包括这个仓库自己的 `npm run dev`，会被静默拉成纯 Node
  // 模式，永远不开窗口。照抄 mcpBridge.ts 的 runnerFor()：只在真的命中兜底分支时才注入）。
  const hookNodeBin = nodeBinForHook()

  // 要不要装 PreToolUse hook，由 adapter 自己声明用哪种审批机制决定——不是拿
  // capabilities.approval.length>0 当"装 Claude 的 hook"的开关（2026-08-14 全分支评审
  // I6 第 2 点：那把"能不能逐次审批"和"用不用 Claude 的 hook 机制"混成了一个布尔。
  // 以后 Codex app-server 落地会声明 approval:['exec']，但它的审批握手走自己的协议，
  // 不该被这个判据误当成"要装 Claude 的 hook"）。装不上不阻断会话启动，但必须让用户
  // 看见"这次没有保护"——fail open 不能是静默的，见 installApprovalHook 文件头。
  if (adapter.approvalHook === 'claude-pretooluse') {
    if (opts.skipApprovalHook) {
      // 用户明确表达过"这个会话不要这条 hook"，不是装不上——但对他来说结果是一样的：
      // "这次会话没有审批保护"，所以复用装不上时的同一条事件路径通知他，不新造机制
      // （Ruling 14"告知而非阻断"同样适用：哪怕是他自己选的，也不能因此就默不作声，
      // notice 该出现的地方还是要出现）。
      //
      // 措辞要同时对得上两条来路，别再写死"你选择了这次不安装"：
      //   ① 起会话时在询问卡片上点了「这次不装，直接开始」（Ruling 15 划给 B 的那条）；
      //   ② 会话中途点了工具栏的「卸载」——2026-08-17 最终评审 I1 之后，卸载会把该 cwd
      //      下的活会话一并置为 skipApprovalHook，于是也会走到这里。
      // 末句也不再承诺"随时可以在工具栏重新开启"：工具栏在未安装状态下并没有开启入口，
      // 那是一句用户照做不了的话（这条 hook 的安装入口目前只有节点第一条消息的询问卡片）。
      // **不推 notice。** 2026-08-17：审批保护改成设置里的一个开关、默认关闭，
      // 于是 skipApprovalHook 从「用户明确拒绝过」变成了「这个功能本来就没开」——
      // 那是默认状态，不是需要每次会话都通报一次的事件。原来这里会推一条
      // 「本次会话未开启审批保护」，默认关之后每起一次会话就冒一条，正是用户
      // 要求「不要出现在对话框中」的那类噪音。开关本身在设置面板里写明了含义。
      //
      // **下面那条 notice 保留**，两者语义完全不同：这里是"没开这个功能"，
      // 下面是"你开了、但没装上"——后者是"你以为受保护、其实没有"，
      // 必须让人看见（Ruling 14「告知而非阻断」针对的正是那种情况）。
    } else {
      const hook = installApprovalHook(live.rec.cwd, hookNodeBin)
      if (!hook.ok) {
        handleEvent(live, {
          k: 'error',
          fatal: false,
          message: `本次会话未能开启审批保护：工具调用将不再等待你的确认、按默认权限直接执行（${hook.reason ?? '未知原因'}）`
        })
      }
    }
  }

  // MCP 配置**在这里现算**，不进 SessionRecord：它不是「这个会话选的」，
  // 是「这台机器此刻装没装、用户关没关」。restart 也走这一句，所以用户在
  // 「扩展能力」里关掉 MCP 之后，下一条消息触发的 restart 就跟着不带工具了。
  const built = adapter.buildArgs({ ...opts, mcpConfigPath: agentMcpConfigPath() ?? undefined })
  // stdin:'ignore' 的 CLI（目前是 Codex）没有活跃的 stdin 通道，prompt 只能是位置参数，
  // 追加在 buildArgs() 已经拼好的 args 末尾——见文件头说明，这是能力位驱动而非 CLI 分支。
  const args = built.stdin === 'ignore' ? [...built.args, message] : built.args

  let proc: ChildProcess
  try {
    proc = spawn(built.bin, args, {
      cwd: opts.cwd,
      env: {
        // **PROBE_ENV 而不是 process.env。** 从 Dock 启动的 Electron，PATH 是
        // launchd 给的精简版、不含 /opt/homebrew/bin —— `spawn('claude')` 直接
        // ENOENT。用户报的原话就是「spawn claude ENOENT」。
        //
        // 这是同一个 PATH 事实的第三处消费点：agent.ts 探模型档位、
        // adapters/detect.ts 判装没装、这里真的把进程拉起来。前两处今天刚统一到
        // probeEnv.ts，**这处漏了** —— 表现最阴险：探测说「装着」，UI 让你选，
        // 一点就 ENOENT。
        ...PROBE_ENV,
        // 团队派生的会话把角色名带进环境，让 MCP 那侧能**准确**判出「调用方是成员」，
        // 不用再靠 cwd 反推（那个猜测会误伤主 agent，见 mcpBridge 的 mcpEnv 注释）
        ...mcpEnv({ project: opts.cwd, teamRole: live.rec.owner === 'team' ? live.rec.role : undefined }),
        // 这个会话专属的标记——resources/agent-hooks/eas-pretooluse.mjs 靠它判断"这次工具
        // 调用是不是 agent-chat 起的这个会话"，不是用户在 Eas-Term 终端里自己敲的 claude、
        // 也不是 app 外面跑的 claude（两者都会继承上面 mcpEnv() 注入的 EAS_TERM_PORT/
        // TOKEN，但不会有这个变量——不能拿那两个当标记，PTY 也注入同样的值，复用就等于
        // 没隔离）。同时也是审批路由"点名"找会话的依据，见下面 onApprovalRequest
        // （2026-08-14 全分支评审 C1 ①）。
        EAS_AGENT_CHAT_SESSION: live.rec.id,
        // 只有真的命中兜底分支才注入——见上面 hookNodeBin 的注释（I3）。
        ...(hookNodeBin === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      },
      stdio: [built.stdin, 'pipe', 'pipe']
    })
  } catch (e) {
    handleEvent(live, { k: 'error', message: e instanceof Error ? e.message : String(e), fatal: true })
    return
  }

  live.proc = proc
  live.stdoutBuf = ''
  live.rec = {
    ...live.rec,
    model: opts.model,
    effort: opts.effort,
    sandbox: opts.sandbox,
    pending: undefined, // 待生效参数这一刻已经生效，清掉——不清的话 UI 的「下条起生效」标注永远摘不掉
    alive: true,
    lastActiveAt: Date.now()
  }

  // 生命周期的另一端。**有生才看得懂死** —— 只记结束的话，
  // 日志里全是「进程结束」，看不出它活了多久、这是第几次起
  logSession(
    `进程启动 ${live.rec.role ?? live.rec.id}（cli=${live.rec.cli}` +
      `${live.rec.resumeId ? ' resume' : ''}${live.rec.owner === 'team' ? ' team' : ''}）`
  )
  wireProc(live, proc)

  // stdin:'pipe' 的 CLI（目前是 Claude）：进程起来后把这条消息按它的 wire format 写进去。
  // 'ignore' 的已经在上面把消息塞进了位置参数，这里不用再写。
  if (built.stdin === 'pipe') writeStdin(live, message)
}

/** 送一条消息该怎么送，全部问 planSend——这里只负责照做。
 *  唯一的自主判断是「action 是 send，但进程当下其实没有可写的 stdin」这种不可能通过
 *  纯函数判出来的运行时状态（比如 Codex 的上一轮还没退出、stdin 本来就是 ignore），
 *  这不是业务判定，是"我有没有能力执行这个动作"的机械检查，答不了就如实报错，
 *  不能假装写成功了却悄悄把消息丢了。 */
function deliverMessage(live: Live, message: string): AgentChatSendResult {
  // **用户开口，静默期立刻结束。** slash 回执的静默是按 turn 计数的，万一某条
  // slash 没引出 turn.done，计数会残留；那时如果不在这里清掉，用户接下来问的
  // 那句话的回答就被吞了 —— 比多显示一条回执严重得多。
  live.silence = endSilence()
  const plan = planSend(live.rec, Date.now())
  if (plan.action === 'send') {
    if (!live.proc?.stdin) {
      return { ok: false, error: '当前会话正在处理上一条消息，请稍候再发送' }
    }
    writeStdin(live, message)
    live.rec = { ...live.rec, lastActiveAt: Date.now() }
    // 消息已经进了 CLI 的 stdin —— 这一轮开始了。**CLI 自己不报这件事**（它只在
    // 说话时才出声），而「发出去了、还没回音」实测有 4 秒多，界面正是在那段时间
    // 最需要表态。不推这个事件的话，渲染层只能自己记一个标志，于是同一件事记在
    // 两个地方，必然漏掉某条路径（见 shared/agentChat.ts 里 turn.start 的说明）。
    handleEvent(live, { k: 'turn.start' })
    return { ok: true }
  }
  // restart 这条路同样是「消息已经在投递路上」。放在 restartAndDeliver 之前推：
  // 那里面要 spawn 进程、装 hook，耗时更长，界面更不该在这段时间里显示成空闲。
  // spawn 失败会推 { k:'error', fatal:true }，归约器收到它会结束这一轮。
  handleEvent(live, { k: 'turn.start' })
  restartAndDeliver(live, plan.opts, message) // 失败会经 error ChatEvent 异步通知，这里不等
  return { ok: true }
}

/** 清掉 CLI 探测缓存的钩子。真正的实现在 registerAgentChatHandlers 里赋值 ——
 *  缓存本身是那个闭包的局部变量，不该提到模块级让别人随手改。 */
let invalidateCliCache: () => void = () => {}

/** 装完 / 卸完 CLI 之后调它，下一次 listClis 会重新探测（不用等 60 秒 TTL）。 */
export function refreshCliCache(): void {
  invalidateCliCache()
}

// ── 自动恢复：被网络抖断的团队 agent 自己接着干 ───────────────────────────────
//
// 用户的要求：「我希望子 agent 不打扰用户，可以通过中断了的机制让主 agent
// 重新唤醒他继续任务」。判据、退避和上限都在 sessionState.planRecovery 里
// （纯函数、有单测），这里只负责按它说的做。

/** 唤醒它时说的话。**要点是让它知道「不是你干完了」** —— 带着 resumeId 重启的会话
 *  记得之前的对话，但它并不知道刚才发生过一次中断，很容易以为自己已经收尾了。 */
function resumeBrief(role?: string): string {
  const where = role ? `.plans/${role}/findings.md` : '你的 findings.md'
  return [
    '（系统自动恢复）你和模型的连接刚才被中断了 —— **不是你把活干完了**。',
    '',
    `带着原来的上下文接着做：先看一眼 ${where} 已经写到哪，从那里往下继续。`,
    '已经做完的部分不要重做；如果上一轮的结论只写了一半，先把它补完整。',
    '这次中断本身不用汇报，也不用问我要不要继续 —— 直接干。'
  ].join('\n')
}

/** 扫一遍看有没有该唤醒的。**独立的短周期定时器** —— 空闲回收是 60 秒一轮，
 *  而最短退避只有 20 秒，挂在那上面等于把第一次重试拖到一分钟后。 */
function recoverInterrupted(): void {
  const now = Date.now()
  for (const live of sessions.values()) {
    const plan = planRecovery(live.rec, now)
    if (!plan || plan.act === 'give-up') continue
    if (plan.act === 'wait') {
      // **第一次算出的时刻要记下来**，否则每扫一次就按「现在 + 退避」重算一遍，
      // 那个时刻永远往后跑，重试永远不会发生。
      if (live.rec.retryAt === undefined) live.rec = { ...live.rec, retryAt: plan.at }
      continue
    }
    live.rec = { ...live.rec, retries: plan.attempt, retryAt: undefined }
    // planSend 在 alive === false 时给的就是 restart 那套 opts（带 resumeId）
    const { opts } = planSend(live.rec, now)
    logSession(`自动恢复 ${live.rec.role ?? live.rec.id}（第 ${plan.attempt} 次）`)
    restartAndDeliver(live, opts, resumeBrief(live.rec.role))
  }
}

// ── 定时回收：判据来自 shouldReap，这里只负责杀进程与标记 ─────────────────────────

/** 会话生命周期日志 —— **写文件，不只是 console.log**。
 *
 *  打包版里 console 是看不见的（除非从终端起 app），而「进程怎么没的」这类问题
 *  恰恰只在用户的正式环境里发生。2026-08-20 用户报「三次派发，三次死在同一处」，
 *  查的时候手里一条证据都没有 —— 那次之后加的这个。
 *
 *  只记生命周期事件（起、结束、回收、恢复），不记对话内容：
 *  一是隐私，二是量 —— 对话内容会让这个文件几分钟就涨到不可读。
 *  超过 1MB 从头写：这是给「刚才发生了什么」用的，不是审计日志。 */
function logSession(msg: string): void {
  try {
    const f = path.join(app.getPath('userData'), 'agent-sessions.log')
    let flag: 'a' | 'w' = 'a'
    try {
      if (fs.statSync(f).size > 1_000_000) flag = 'w'
    } catch {
      /* 文件还不存在，追加即可 */
    }
    fs.writeFileSync(f, `${new Date().toISOString()} ${msg}\n`, { flag })
  } catch {
    /* 日志写不出来绝不能影响会话本身 */
  }
  console.log(`[agentChat] ${msg}`)
}

/** 这个团队 agent **交活了没有** —— 读 `.plans/<role>/findings.md` 的大小。
 *
 *  隔离的 agent cwd 指向 `<项目>/.worktrees/…`，而 findings 落在**项目根**的
 *  `.plans/` 下，所以要先还原回项目根。
 *
 *  小于 THIN_BYTES（120 字节）算没交 —— 那种只写了个标题的，跟没写一样
 *  （判据与 shared/teamFindings.ts 的 deliveredOf 对齐，是同一条线）。 */
function hasDelivered(rec: SessionRecord): boolean {
  if (rec.owner !== 'team' || !rec.role) return false
  try {
    const i = rec.cwd.indexOf(`/${WORKTREE_DIR}/`)
    const root = i >= 0 ? rec.cwd.slice(0, i) : rec.cwd
    return fs.statSync(path.join(root, '.plans', rec.role, 'findings.md')).size >= THIN_BYTES
  } catch {
    return false // 文件不存在 = 没交活
  }
}

/** 「派出去在后台跑」的工具。判据是工具名本身 —— claudeEvents 的 toLabel
 *  对这几个不做加工，原样透出来。 */
const BG_TOOLS = new Set(['Workflow', 'Task', 'Agent'])

function reapIdleSessions(): void {
  const now = Date.now()
  // 「这个 cwd 底下还有活着的团队 agent 吗」——**派活的那一方不能在子 agent
  //  还在跑的时候被回收掉**。主 agent 调完 team_spawn 那一轮就结束了（busy 落回
  //  false），自己一句话都不再输出，15 分钟后正好撞上回收；等子 agent 干完，
  //  已经没有人接得住它们的产出了（用户 2026-08-20 反馈）。
  //
  //  判据用会话表而不是猜：owner==='team' 且 alive，是主进程手里的事实。
  //  worktree 隔离的 agent cwd 在 `<项目>/.worktrees/...` 底下，所以按前缀算。
  const teamAliveUnder = (cwd: string): boolean => {
    if (!cwd) return false
    for (const other of sessions.values()) {
      if (other.rec.owner !== 'team' || !other.rec.alive) continue
      const c = other.rec.cwd
      if (c === cwd || c.startsWith(`${cwd}/`) || c.startsWith(`${cwd}\\`)) return true
    }
    return false
  }
  for (const live of sessions.values()) {
    const delivered = hasDelivered(live.rec)
    if (!shouldReap(live.rec, now, delivered)) continue
    // 自己就是团队成员的照常回收 —— 这条保护是给**派活的人**的，
    // 不然一批 agent 会互相把对方续命。
    if (live.rec.owner !== 'team' && teamAliveUnder(live.rec.cwd)) continue
    // **回收要留痕。** 这条路径原本一句日志都没有 —— 用户 2026-08-20 报
    // 「三次派发，三次死在同一处」时，主进程日志里完全查不到进程是怎么没的。
    const idleSec = Math.round((now - live.rec.lastActiveAt) / 1000)
    logSession(
      `空闲回收 ${live.rec.role ?? live.rec.id}` +
        `（${idleSec}s 没动静，busy=${String(live.rec.busy)}，交活=${delivered ? '是' : '否'}）`
    )
    live.killing = true // 空闲回收是预期内的，别让它触发自动恢复
    live.proc?.kill()
    live.proc = undefined
    live.rec = { ...live.rec, alive: false } // resumeId 保留，下次发送时接上
  }
}

/** 当前所有会话的只读快照，给团队面板用。
 *
 *  **按 webContents 过滤**：只报这个页面自己创建的会话，跟事件推送
 *  （`live.wc.send`）保持同一个可见范围。不过滤的话，多窗口时 A 窗口的面板
 *  会列出 B 窗口的 agent，而它既点不进去也停不掉。 */
export function listSessionBriefs(wcId: number): SessionBrief[] {
  const out: SessionBrief[] = []
  for (const live of sessions.values()) {
    if (live.wcId !== wcId) continue
    const r = live.rec
    out.push({
      id: r.id,
      cli: r.cli,
      cwd: r.cwd,
      alive: r.alive,
      lastActiveAt: r.lastActiveAt,
      startedAt: r.startedAt,
      model: r.model,
      owner: r.owner,
      role: r.role,
      busy: r.busy,
      ended: r.ended,
      bgTask: r.bgTask,
      // 「还会不会自己爬起来」由主进程算，渲染层不复制退避规则
      recovering: (() => {
        const p = planRecovery(r, Date.now())
        return !!p && p.act !== 'give-up'
      })(),
      retries: r.retries,
      tally: r.tally
    })
  }
  return out
}

/** app 退出时收掉全部会话进程，避免留下孤儿（和 pty.ts 的 killAllPtys 同一个道理）。
 *  hard=true 用 SIGKILL，配合 index.ts 里"先软杀、300ms 后硬杀"的两拍节奏。 */
export function killAllAgentChatSessions(hard = false): void {
  for (const live of sessions.values()) {
    live.proc?.kill(hard ? 'SIGKILL' : 'SIGTERM')
  }
}

/** 页面被换掉（重载/导航）或窗口关闭时，回收这个 webContents 名下的全部会话——
 *  对称于 pty.ts 的 killPtysForWebContents（2026-08-17 全分支最终评审 I6：
 *  index.ts 上只有 PTY 的这两个钩子，agentChat 一个都没有）。
 *
 *  为什么非有不可：这个 app 自带崩溃自愈（render-process-gone → reloadWindowThrottled）。
 *  重载后的新页面对旧 sessionId 一无所知（agent 节点本来也不跨重载持久化），旧的
 *  claude/codex 子进程就此无人看管地继续跑；emitEvent 因为 wc.isDestroyed() 静默丢弃，
 *  再没有任何代码会调 stop。兜底只有 15 分钟空闲回收，而 lastActiveAt **每收到一块
 *  stdout 就续期**——一个还在跑的长任务可以远超 15 分钟不被回收，真花 token。
 *
 *  软杀之后补一拍硬杀：这条路径上没有人再盯着这些进程了（不像 app 退出时 index.ts
 *  会走完两拍），赖着不退的进程就是永久孤儿。 */
export function killAgentChatSessionsForWebContents(wcId: number): void {
  for (const [id, live] of sessions) {
    if (live.wcId !== wcId) continue
    sessions.delete(id)
    const proc = live.proc
    live.proc = undefined
    if (!proc) continue
    proc.kill('SIGTERM')
    setTimeout(() => {
      // killed 已经为真说明信号送达过；仍在跑的（exitCode/signalCode 都是 null）再补一刀
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }, 300).unref?.()
  }
}

export function registerAgentChatHandlers(): void {
  setInterval(reapIdleSessions, 60_000)
  // 恢复要跟得上退避节奏（最短 20 秒），不能挂在上面那个 60 秒的轮子上
  setInterval(recoverInterrupted, 10_000)

  // 全局唯一订阅：hook 脚本送来的每一条待审批请求都会广播到这里。按 hook 脚本附带的
  // eas_session_id（= EAS_AGENT_CHAT_SESSION，spawn 时注入，见 restartAndDeliver）直接
  // 点名找到我们自己的会话——不再靠 Claude 原生 session_id 反查 resumeId
  // （2026-08-14 全分支评审 C1 ①：那条路径在 session.ready 事件把 resumeId 落进
  // SessionRecord 之前会找不到会话，存在一个时间窗口；点名法从第一次工具调用起就成立）。
  // 找不到匹配会话就丢弃——理论上不该发生（hook 脚本读不到 EAS_AGENT_CHAT_SESSION 时
  // 会直接无声退出，根本不会发起这个请求），hook 那边自己的 5 分钟超时会兜底 deny，
  // 不会静默放行。
  onApprovalRequest((payload) => {
    const live = sessions.get(payload.eas_session_id ?? '')
    if (!live) return
    for (const e of live.approvals.fromHook(payload)) emitEvent(live, e)
  })

  // 全局唯一订阅：某个审批被真正敲定时（渲染层点了允许/拒绝，或者等到超时兜底 deny）
  // 广播到这里——approval.resolved 事件只能由这里驱动，不能由 IPC 返回路径自己造
  // （2026-08-14 全分支评审 I1：修复前 agentChat:resolveApproval 直接拿渲染层"想要"的
  // decision 发事件，但如果 resolveApprovalGlobal 因为超时已经先一步返回 false——hook
  // 脚本其实已经拿到 deny 退出——事件流会断言"已批准"，事实却是"已拒绝"，正面违反
  // "执行结果只信事件"）。approvalId（tool_use_id）在同一时刻只可能是某一个会话的
  // registry 认识，其余会话的 resolve() 对不认识的 id 是安全的空操作，所以不用先定位
  // 是哪个会话，逐个试一遍即可——会话数量通常只有几个，成本可忽略。
  onApprovalSettled((approvalId, decision) => {
    for (const live of sessions.values()) {
      for (const e of live.approvals.resolve(approvalId, decision)) emitEvent(live, e)
    }
  })

  // 有哪些 CLI 可用、各自会什么——渲染层的 CLI 选择器和工具栏（模型/effort/沙箱选项）
  // 唯一的数据源（Task 0 简报：A 暴露的 8 个 IPC 里没有一个能力查询接口，listAdapters()/
  // getAdapter() 此前只活在主进程）。探测（adapter.detect()）是这一层唯一的 IO，纯合成
  // 逻辑在 buildCliList——可测的就是那一层，这里只做薄薄一层调用。单个 adapter 的探测
  // 失败不该拖垮整个列表，所以逐个 catch 成 false，而不是让 Promise.all 整体 reject。
  // 团队面板的数据源。**只读** —— 拿不到任何能改状态的东西，
  // 面板要停某个会话仍然走既有的 agentChat:stop。
  ipcMain.handle('agentChat:listSessions', (e): SessionBrief[] =>
    listSessionBriefs(e.sender.id)
  )

  // **探测结果要缓存，而且并发要合流。**
  //
  // detect 是 `execFile('which', [bin])` —— 每次都 spawn 一个子进程。
  // 而每个 AI 对话节点挂载时都会调一次 listClis：画布上放 6 个节点，
  // 开机那一瞬间就是十几个子进程同时起来，用户的原话是「瞬间占用大量系统资源，
  // 有可能造成系统卡顿」（2026-08-20 实测确认：干净启动 30 秒后 agentChat 会话数
  // 和 CLI 子进程数都是 0，也就是说卡顿不来自会话本身，就来自这里）。
  //
  // 两件事一起做才有用：
  // · **缓存**（60 秒）—— 挡住后续的重复探测
  // · **in-flight 合流** —— 挡住「六个节点同时挂载、缓存还没建立」那一下，
  //   只有它能把开机瞬间的十几个进程压成一次
  //
  // 60 秒不是随便取的：装完 CLI 的人会去点「安装」按钮那条路（agentInstall 会
  // 主动清缓存），这里的 TTL 只是兜底给「在别处装完、回来等一会儿」的情况。
  let cliCache: { at: number; data: CliInfo[] } | null = null
  let cliInflight: Promise<CliInfo[]> | null = null
  const CLI_CACHE_MS = 60_000
  /** 装了/卸了 CLI 之后调它，下一次 listClis 会重新探测 */
  invalidateCliCache = (): void => {
    cliCache = null
  }

  ipcMain.handle('agentChat:listClis', async (): Promise<CliInfo[]> => {
    if (cliCache && Date.now() - cliCache.at < CLI_CACHE_MS) return cliCache.data
    if (cliInflight) return cliInflight
    cliInflight = probeClis()
      .then((r) => {
        cliCache = { at: Date.now(), data: r }
        return r
      })
      .finally(() => {
        cliInflight = null
      })
    return cliInflight
  })

  async function probeClis(): Promise<CliInfo[]> {
    const adapters = listAdapters()
    // 仅终端可用的 CLI 也要探测 —— 它同样要显示「装了没有」
    // 目前一个都没有。DeepSeek Harness 曾经在这里（headless 只打印最终消息、
    // 没有流式和工具事件，写不出 adapter），0.4.31 整个移除。**机制留着** ——
    // 下一个「装了也只能在终端里用」的 CLI 直接往这个数组里加一条就行。
    const terminalOnly: TerminalOnlyCli[] = []
    const availability: Record<string, boolean> = {}
    await Promise.all([
      ...adapters.map(async (a) => {
        availability[a.id] = await a.detect().catch(() => false)
      }),
      ...terminalOnly.map(async (t) => {
        availability[t.id] = await detectByWhich(t.id)().catch(() => false)
      })
    ])
    // 安装命令从 agentInstall 的方案里取第一条（那边已经按平台挑过最合适的），
    // **不在这里另写一份** —— 同一个事实写两处，迟早一处过期
    const plan = installPlan()
    const installCmds: Record<string, string> = {}
    for (const k of ['claude', 'codex'] as const) {
      const c = plan[k]?.options?.[0]?.cmd
      if (c) installCmds[k] = c
    }
    return buildCliList(adapters, availability, installCmds, terminalOnly)
  }

  ipcMain.handle('agentChat:start', (e, params: unknown): AgentChatStartResult => {
    const p = params as Partial<AgentChatStartParams> | null
    if (!p || typeof p.cli !== 'string' || typeof p.cwd !== 'string' || typeof p.message !== 'string' || !p.message) {
      return { ok: false, error: '缺少必需参数（cli / cwd / message）' }
    }
    const adapter = getAdapter(p.cli)
    if (!adapter) return { ok: false, error: `未知 CLI：${p.cli}` }

    const id = `ac-${nextId++}`
    const rec: SessionRecord = {
      id,
      cli: p.cli,
      cwd: p.cwd,
      alive: false,
      lastActiveAt: Date.now(),
      startedAt: Date.now(),
      // 身份只认严格字面量：params 来自 unknown，别的值一律当没给。
      // 猜错的代价是把用户自己开的会话误判成团队成员，「全部叫停」会连它一起杀。
      owner: p.owner === 'team' ? 'team' : undefined,
      role: typeof p.role === 'string' && p.role ? p.role : undefined,
      model: typeof p.model === 'string' ? p.model : undefined,
      effort: typeof p.effort === 'string' ? p.effort : undefined,
      sandbox: typeof p.sandbox === 'string' ? p.sandbox : undefined,
      resumeId: typeof p.resumeId === 'string' ? p.resumeId : undefined,
      // === true 而不是 Boolean(p.skipApprovalHook)：params 来自 unknown，任何非严格
      // 布尔值（字符串 'true'、1……）一律当没给，照旧装 hook，不猜用户意图。
      skipApprovalHook: p.skipApprovalHook === true,
      // 伪无头审批：不装 hook、不阻塞，靠系统提示让模型先问（见 ASK_FIRST_PROMPT）
      askFirst: p.askFirst === true
    }
    const live: Live = {
      rec,
      wc: e.sender,
      wcId: e.sender.id,
      silence: NO_SILENCE,
      // translator 由 adapter 自己声明创建（2026-08-14 全分支评审 I6 第 1 点：Ruling 10
      // 给 stdin 立的原则逐字适用于这里——adapter 知道自己怎么工作，不靠下游按 id 分支去
      // 记每个 CLI 的怪癖。改之前这里写的是 `adapter.id === 'codex' ? ... : ...`，加第三个
      // CLI 会静默拿到 Claude 的翻译器，产出垃圾或什么都不产出，没有任何报错）。
      translator: adapter.createTranslator(),
      approvals: createApprovalRegistry(),
      stdoutBuf: ''
    }
    sessions.set(id, live)
    deliverMessage(live, p.message) // 首次投递等价于「进程不活 → restart」，spawn 失败经 error 事件异步通知
    return { ok: true, sessionId: id }
  })

  ipcMain.handle('agentChat:send', (_e, sessionId: unknown, message: unknown): AgentChatSendResult => {
    const live = sessions.get(typeof sessionId === 'string' ? sessionId : '')
    if (!live) return { ok: false, error: '会话不存在（可能已被关闭）' }
    if (typeof message !== 'string' || !message) return { ok: false, error: '消息不能为空' }
    return deliverMessage(live, message)
  })

  // 中途改模型/effort：只记为待生效，不打断当前任务（决定 3）。下一次 send 触发的
  // planSend 会因为 pending 存在而走 restart，effectiveOpts 会把这里 patch 的值带上。
  ipcMain.handle('agentChat:setParams', (_e, sessionId: unknown, patch: unknown): { ok: boolean; error?: string } => {
    const live = sessions.get(typeof sessionId === 'string' ? sessionId : '')
    if (!live) return { ok: false, error: '会话不存在' }
    const p = (patch ?? {}) as { model?: unknown; effort?: unknown }
    const clean: { model?: string; effort?: string } = {}
    if (typeof p.model === 'string') clean.model = p.model
    if (typeof p.effort === 'string') clean.effort = p.effort

    // 会话内命令那条路：CLI 声明了 paramChange:'slash' 且进程还活着时，直接往 stdin
    // 写 /model、/effort —— **不重启进程、不丢上下文**（重启要冷启动数秒，还得靠
    // resume 把上下文接回来）。2026-08-17 实测确认 headless 下同样生效。
    //
    // **两件事都要做，缺一不可**：
    //   ① 发命令 —— 让它在当前这个进程里立刻换过去；
    //   ② 更新 rec.model/effort（当前值，不是 pending）—— 会话空闲回收后 restart
    //      要靠它带上 --model/--effort，否则悄悄退回旧模型，而界面上还显示着新的。
    //
    // 判据是能力声明不是 CLI 名字。进程不在（已被空闲回收）时退回老路：记 pending，
    // 下次 restart 带启动参数——两条路殊途同归。
    const adapter = getAdapter(live.rec.cli)
    if (adapter?.paramChange === 'slash' && live.proc?.stdin) {
      // 每条 slash 会引出一个带回执的 turn，逐个吞掉（理由见 isSilenced）
      let sent = 0
      if (clean.model) {
        writeStdin(live, `/model ${clean.model}`)
        sent++
      }
      if (clean.effort) {
        writeStdin(live, `/effort ${clean.effort}`)
        sent++
      }
      live.silence = silenceAfterSlash(live.silence, sent, Date.now())
      live.rec = {
        ...live.rec,
        model: clean.model ?? live.rec.model,
        effort: clean.effort ?? live.rec.effort
      }
      return { ok: true }
    }
    live.rec = applyParamChange(live.rec, clean)
    return { ok: true }
  })

  // 审批决定回传：只负责把渲染层的决定写回 hook 那一路（resolveApprovalGlobal，按
  // approvalId 单独一张表，见 approvalRoute.ts）。**不在这里发 approval.resolved 事件**
  // ——事件由上面的 onApprovalSettled 统一驱动（2026-08-14 全分支评审 I1）：这里的
  // decision 只是渲染层"想要"的结果，resolveApprovalGlobal 完全有可能因为这个 approvalId
  // 已经超时而返回 false（hook 脚本其实已经拿到 deny 退出）——修复前的实现会无视这个
  // false、照样把渲染层想要的 decision 当真相发出去，事件流断言"已批准"，事实却是
  // "已拒绝"。sessionId 不再需要，保留参数位只是不改 IPC 调用签名（renderer 侧不用跟着改）。
  ipcMain.handle(
    'agentChat:resolveApproval',
    (_e, _sessionId: unknown, approvalId: unknown, decision: unknown): { ok: boolean } => {
      const d: 'allow' | 'deny' = decision === 'allow' ? 'allow' : 'deny'
      const aid = typeof approvalId === 'string' ? approvalId : ''
      return { ok: resolveApprovalGlobal(aid, d, '') }
    }
  )

  // 「AI 会话审批」hook 的状态展示与一键卸载——对齐既有 hook:status / hook:uninstall
  // 的形状（2026-08-14 全分支评审 C1 ③）。按 cwd 查/卸，不是全局唯一一份：这条 hook
  // 是按项目装进 <cwd>/.claude/settings.json 的。
  ipcMain.handle('agentChat:hookStatus', (_e, cwd: unknown): AgentApprovalHookStatus => {
    if (typeof cwd !== 'string' || !cwd) return { installed: false, outdated: false, configPath: '' }
    return approvalHookStatus(cwd)
  })

  ipcMain.handle('agentChat:hookUninstall', (_e, cwd: unknown): { ok: boolean; error?: string } => {
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'cwd 必填' }
    const r = uninstallApprovalHook(cwd)
    if (!r.ok) return { ok: false, error: r.reason }
    // 卸载成功之后，把这个项目下所有活会话标成「这次不装」——否则下一次 restart
    // （空闲回收后再发消息、或改 model/effort；Codex 更是每条消息都 restart）会读到
    // skipApprovalHook=false，无条件把 hook 重新写回用户自己的仓库，没有询问、没有提示
    // （2026-08-17 全分支最终评审 I1，用户原话会是"我明明卸载了，它自己回来了"）。
    // spec §B.4「第一次要在某个项目里装这个 hook 时先问用户」——手动卸载之后再装，
    // 实质就是又一次"要装"，而 handleSend 里的询问只在节点的第一条消息触发一次。
    //
    // 范围是「同一个 cwd 下的所有活会话」而不是「发起这次调用的那个会话」：hook 是按
    // 项目装在 <cwd>/.claude/settings.json 的一份文件，同项目里任何一个会话 restart
    // 都会把它装回来，只标记调用者等于没修。
    // 走 path.resolve 再比，避免尾斜杠/相对写法这类无关差异造成漏标。
    // 就地改 live.rec，不要 sessions.set(id, {...live}) 换一个新的 Live 对象——
    // wireProc 里那些 stdout/exit 回调闭包捕获的是**原来那个** Live 引用，换对象会让
    // 进程侧继续写老对象、查询侧读新对象，两份状态从此分叉（全文件都是就地改 live.rec
    // 的写法，这里保持一致）。
    const target = path.resolve(cwd)
    for (const live of sessions.values()) {
      if (path.resolve(live.rec.cwd) !== target) continue
      live.rec = { ...live.rec, skipApprovalHook: true }
    }
    return { ok: true }
  })

  /** **打断这一轮，但把会话留着。**
   *
   *  终端里按 ESC 就能停下正在跑的回答，AI 对话窗口以前只能干等 ——
   *  一次答偏了得等它说完，长任务里尤其难受（.plans/cli-gap 里排第一的缺口）。
   *
   *  做法是 kill 当前进程但**不删会话记录**：resumeId 还在，用户下一条消息
   *  会走 planSend 的 restart 分支带 `--resume` 接回上下文。这不是新机制，
   *  是既有的 restart 路径少发一条消息而已。
   *
   *  两个必须设对的标记：
   *  · `killing = true` —— 是我们动的手，别让它被记成「被打断」
   *  · `ended = 'ok'` —— **否则自动恢复会把用户刚停下的东西又拉起来**
   *
   *  代价：正在流的那一轮，CLI 那边可能没写进会话文件，恢复后模型不记得它。
   *  用户按下「停」本来就是不想要那一轮，这个代价是他要的。 */
  ipcMain.on('agentChat:interrupt', (_e, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId : ''
    const live = sessions.get(id)
    if (!live?.proc) return
    live.killing = true
    live.proc.kill()
    live.proc = undefined
    // **必须推 turn.done，光推一条提醒是不够的。**
    //
    // 渲染层的 busy 有三支判据（reduce.ts）：turnActive、
    // sawExecStartSinceTurnDone、以及「execs 里还有没有 running 的」。
    // 能一次放倒三支的只有 turn.done —— `error` 就算 fatal 也只放倒 turnActive。
    // 原来这里只推了一条 fatal:false 的提醒，三支一支都没复位：
    // 界面上「正在处理」不消失、发送键一直停在「停下这一轮」。
    //
    // usage 给零：这不是一轮真的跑完，没有新用量要记。costUsd 留空 ——
    // teamCost.tally 里 `costUsd ?? prev.costUsd` 会保持原值，不会把花费清成 0。
    handleEvent(live, { k: 'turn.done', usage: { inputTokens: 0, outputTokens: 0 } })
    live.rec = { ...live.rec, alive: false, busy: false, ended: 'ok' }
    handleEvent(live, {
      k: 'error',
      fatal: false,
      message: '已停下这一轮。上下文还在，接着说就行。'
    })
  })

  ipcMain.on('agentChat:stop', (_e, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId : ''
    const live = sessions.get(id)
    if (!live) return
    sessions.delete(id)
    live.killing = true // 用户点了「停」——他要它停，不许自己爬起来
    live.proc?.kill()
  })
}
