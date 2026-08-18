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
import { shouldReap, planSend, applyParamChange, type SessionRecord } from './sessionState.ts'
import { buildCliList } from './cliList.ts'
import { guardPath } from '../fsGuard.ts'
import { mcpEnv } from '../mcpBridge.ts'
import { AGENT_CHAT_EVENT_CHANNEL } from '../../shared/agentChat.ts'
import type {
  ChatEvent,
  StartOpts,
  AgentChatStartParams,
  AgentChatStartResult,
  AgentChatSendResult,
  AgentApprovalHookStatus,
  AgentChatEventEnvelope,
  CliInfo
} from '../../shared/agentChat.ts'

interface Live {
  rec: SessionRecord
  proc?: ChildProcess
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
    live.rec = { ...live.rec, alive: false }
    handleEvent(live, { k: 'error', message: err.message, fatal: true })
  })
  proc.on('exit', (code) => {
    live.proc = undefined
    live.rec = { ...live.rec, alive: false }
    // code === 0 或 null（被我们自己 kill）都不算错——Codex 的 exec 正常跑完一轮后
    // 本来就会退出，那是预期行为，不是故障。
    if (code !== 0 && code !== null) {
      handleEvent(live, { k: 'error', message: `CLI 进程退出（code ${code}）`, fatal: true })
    }
  })
}

/** restart 分支：无条件先 kill 再 spawn（Ruling 8）。planSend 是纯函数、杀不了进程；
 *  若 alive 因系统休眠等原因滞后，不先 kill 就 spawn 会造成两个进程同时存活、
 *  stdout 都灌进同一个 translator。kill 是幂等的（已经死的进程再 kill 一次没有副作用），
 *  无脑调即可。 */
function restartAndDeliver(live: Live, opts: StartOpts, message: string): void {
  live.proc?.kill()
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

  const built = adapter.buildArgs(opts)
  // stdin:'ignore' 的 CLI（目前是 Codex）没有活跃的 stdin 通道，prompt 只能是位置参数，
  // 追加在 buildArgs() 已经拼好的 args 末尾——见文件头说明，这是能力位驱动而非 CLI 分支。
  const args = built.stdin === 'ignore' ? [...built.args, message] : built.args

  let proc: ChildProcess
  try {
    proc = spawn(built.bin, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...mcpEnv({ project: opts.cwd }),
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

// ── 定时回收：判据来自 shouldReap，这里只负责杀进程与标记 ─────────────────────────

function reapIdleSessions(): void {
  const now = Date.now()
  for (const live of sessions.values()) {
    if (!shouldReap(live.rec, now)) continue
    live.proc?.kill()
    live.proc = undefined
    live.rec = { ...live.rec, alive: false } // resumeId 保留，下次发送时接上
  }
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
  ipcMain.handle('agentChat:listClis', async (): Promise<CliInfo[]> => {
    const adapters = listAdapters()
    const availability: Record<string, boolean> = {}
    await Promise.all(
      adapters.map(async (a) => {
        availability[a.id] = await a.detect().catch(() => false)
      })
    )
    return buildCliList(adapters, availability)
  })

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

  ipcMain.on('agentChat:stop', (_e, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId : ''
    const live = sessions.get(id)
    if (!live) return
    sessions.delete(id)
    live.proc?.kill()
  })
}
