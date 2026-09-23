// P0/P3 评审闸门：全仓启动原语清单（2026-09-13 接手时建立）。
//
// **这不是覆盖证明，是评审触发器。** 静态搜索抓的是"哪里会起进程/线程/窗口"，
// 抓不到"起了之后归谁管、怎么停"。它的作用只有一个：任何新增或消失的启动点
// 都让这条测试变红，逼着改动者在 MANIFEST 里写清状态（托管 / 有界探测 / 缺口…），
// 并同步 docs/architecture/17-运行资源与服务所有权.md 的覆盖矩阵。
//
// 计数按「文件 × 原语」而不是按行号：行号随编辑漂移会误报；按文件计数又会漏掉
// 同一文件里悄悄多出的第二个 spawn。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SCAN_DIRS = ['src/main', 'src/preload', 'mcp', 'resources/plugins', 'resources/agent-hooks', 'hooks']
const EXT = new Set(['.ts', '.mjs', '.js', '.cjs'])

/** 与 grep 同一套原语；`.exec(` 是 RegExp，不算。 */
const PRIMITIVES: [RegExp, string][] = [
  [/\bpty\.spawn\(/, 'pty.spawn'],
  [/\bspawnSync\(/, 'spawnSync'],
  [/(?<![\w.])spawn\(/, 'spawn'],
  [/(?<![\w.])fork\(/, 'fork'],
  [/\butilityProcess\.fork\b/, 'utilityProcess.fork'],
  [/\bpromisify\(execFile\)/, 'promisify(execFile)'],
  [/\bexecFileSync\(/, 'execFileSync'],
  [/\bexecFile\(/, 'execFile'],
  [/\bexecSync\(/, 'execSync'],
  [/(?<![\w.])exec\(/, 'exec'],
  [/\bnew Worker\(/, 'new Worker'],
  [/\bnew BrowserWindow\(/, 'new BrowserWindow'],
  [/\bnew (BrowserView|WebContentsView)\(/, 'new WebContentsView'],
  [/\bwebContents\.create\b/, 'webContents.create'],
  [/\?nodeWorker'/, 'import ?nodeWorker'] // electron-vite 的 Worker 工厂，没有 new Worker 字面量
]

type Status = 'managed' | 'registered' | 'bounded-probe' | 'launcher-child' | 'external-app' | 'window' | 'dev-hook' | 'gap'
interface Entry { status: Status; counts: Record<string, number>; note: string }

/** 清单：文件 → 状态、各原语计数、一句话说明（归属 / 停止 / 未闭环）。 */
const MANIFEST: Record<string, Entry> = {
  // ── 托管：经 startManagedSession / runManagedTask / managedX 准入，真实 exit 才释放预算 ──
  'src/main/pty.ts': { status: 'managed', counts: { 'pty.spawn': 1, execFile: 4, execFileSync: 3 }, note: 'pty:create 排队后 spawn（sessionStartup），ownedSessions 登记；execFile/execFileSync 是 ps/taskkill 进程树归属与关闭探测，有 timeout，不排队' },
  'src/main/agentChat/session.ts': { status: 'managed', counts: { spawn: 1 }, note: 'Claude/Codex 直连进程：restartAndDeliver 经 startManagedSession，close 才释放；agent:<session>:<gen> 服务登记' },
  'src/main/agentChat/omp/launch.ts': { status: 'managed', counts: { spawn: 1, execFile: 1 }, note: 'ACP 进程经 openAsync→startManagedSession；execFile 是 omp usage --json 额度读取，8s timeout 的有界探测' },
  'src/main/lspClient.ts': { status: 'managed', counts: { spawn: 1 }, note: '语言服务器经 lspProvider startManagedSession（共享窗口引用），completed 只认 close' },
  'src/main/stt.ts': { status: 'managed', counts: { 'new Worker': 2 }, note: '流式预览 Worker 由 voicePreviewPool 常驻（2026-09-14：不经准入，openManagedPreview 只登记 ownedSessions；闲置 10 分钟释放）；ASR 共享模型 Worker 经 managedAsr，预算随 exit 释放。实时听写解码（flushSentence / stop 收尾）走 interactive=acquireForced：跳过 80/50 阈值、不排队（用户「语音不要等待队列」），成本仍登记；文件转录 transcribeChunk 是批量活，保持排队' },
  'src/main/voiceVad.ts': { status: 'managed', counts: { 'new Worker': 1 }, note: 'VAD Worker 经 managedVad 直接起（2026-09-14：不经准入，登记 ownedSessions）；stop 不等于 exit，completed 只认 exit' },
  'src/main/wiki/scanHost.ts': { status: 'managed', counts: { 'import ?nodeWorker': 1 }, note: '知识库全库扫描 Worker 工厂；wiki:graph / wiki:lint 经 scanNotesManaged→runOneShotWorker→runManagedTask（窗口归属，projectId null），取消 terminate，预算随 exit 释放（2026-09-13）' },
  'src/main/tsSymbolsHost.ts': { status: 'managed', counts: { 'import ?nodeWorker': 1 }, note: '符号索引 Worker 工厂；codeGraph:symbols 经 analyzeSymbolsManaged→runManagedTask（窗口归属、项目归属），取消 terminate，预算随 exit 释放（2026-09-13）' },
  // ── 有界探测：一次性系统/CLI 查询，带 timeout，不产生驻留，不排队 ──
  'src/main/runtime/readPlatformMetrics.ts': { status: 'bounded-probe', counts: { 'promisify(execFile)': 1, exec: 3 }, note: '采样器自身：vm_stat/sysctl 各 1s 上限、单 capture 在途；它是准入的输入，不能被准入' },
  'src/main/agent.ts': { status: 'bounded-probe', counts: { 'promisify(execFile)': 1 }, note: 'CLI --version 探测，带 timeout；结果有缓存' },
  'src/main/cliContractRun.ts': { status: 'bounded-probe', counts: { 'promisify(execFile)': 1 }, note: 'CLI 契约探测（--help 等），带 timeout' },
  'src/main/agentChat/adapters/detect.ts': { status: 'bounded-probe', counts: { execFile: 1 }, note: 'which <bin>，PROBE_ENV' },
  'src/main/agentChat/codexModels.ts': { status: 'bounded-probe', counts: { spawn: 1 }, note: 'codex app-server 模型清单探测，超时杀进程（有回归测试）' },
  'src/main/agentChat/omp/setup.ts': { status: 'bounded-probe', counts: { execFile: 2 }, note: 'omp models ls / auth-broker list，12s timeout' },
  'src/main/cliAuth/index.ts': { status: 'registered', counts: { spawn: 2 }, note: '第 1 处是登录状态探测（有界）；第 2 处交互式登录进程：不排队（用户交互），spawn 后经 registerOwnedCliProcess 登记为 cli-login: 自有服务，运行中心可见、一次确认可停，真实 close 才消失（2026-09-13）' },
  'src/main/git.ts': { status: 'bounded-probe', counts: { execFile: 2 }, note: 'git 只读查询与写操作，按调用区分；未合并查询、未接任务层' },
  'src/main/gitExec.ts': { status: 'bounded-probe', counts: { execFile: 1 }, note: 'git 执行包装，带 timeout' },
  'src/main/wiki/git.ts': { status: 'bounded-probe', counts: { execFileSync: 1 }, note: '知识库 git 同步调用，会阻塞主线程；未接任务层' },
  'src/main/quotaApi.ts': { status: 'bounded-probe', counts: { execFile: 1 }, note: 'security find-generic-password 取 token，5s timeout，结果不进日志' },
  'src/main/probeEnv.ts': { status: 'bounded-probe', counts: { spawn: 1 }, note: '登录 shell 取 PATH（一次性），有 timeout' },
  'src/main/island.ts': { status: 'window', counts: { 'new BrowserWindow': 1, execFile: 2 }, note: '灵动岛窗口（系统保护）；两处 osascript 前台判定约 50ms，有界' },
  'src/main/index.ts': { status: 'window', counts: { 'new BrowserWindow': 1 }, note: '主窗口，系统保护，运行中心不得关闭' },
  // ── 外部应用：只发起，不取得所有权，不得自动关闭 ──
  'src/main/fs.ts': { status: 'external-app', counts: { execFile: 1 }, note: 'open -R 在 Finder 显示，瞬时' },
  'src/main/bizone.ts': { status: 'external-app', counts: { execFile: 1 }, note: 'open -R，瞬时' },
  'src/main/bizoneRuntime.ts': { status: 'external-app', counts: { spawn: 1 }, note: '拉起笔纵画板 detached+unref；启动请求不等于所有权' },
  'mcp/bizone-mcp.mjs': { status: 'external-app', counts: { spawn: 1 }, note: 'open -g -a 笔纵，detached' },
  // ── 进程外 launcher：归属继承自主进程那次 spawn（pty/agent/MCP），不在主进程再计一次 ──
  'mcp/eas-pty-launcher.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: '终端里 CLI 的中间 launcher；随 PTY 会话关闭' },
  'mcp/eas-codex-launcher.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: 'Codex 配置合并 launcher；owned-launcher-control 显式所有，IPC cancel/disconnect 等真实 exit' },
  'mcp/codex-capability-config.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: 'app-server 配置探测，10s timeout，abort 杀探测' },
  'mcp/eas-selected-mcp-launcher.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: 'CLI 侧选中 MCP 的 launcher，随 CLI 退出' },
  'mcp/eas-secret.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: '密钥注入包装，spawn 用户指定子命令；只记脱敏类别' },
  'resources/agent-hooks/eas-statusline.mjs': { status: 'launcher-child', counts: { spawn: 1 }, note: 'CLI 状态栏 hook 起用户 shell，是 CLI 后代，不在主进程登记' },
  'resources/plugins/computer/server.mjs': { status: 'launcher-child', counts: { execFileSync: 2, execFile: 1 }, note: '自带 Computer 插件的原生 helper，带 timeout；插件宿主登记不等于其原生后代全覆盖（computer-use-lifecycle 未解决）' },
  // ── 开发期钩子：不在运行时 ──
  'hooks/arch-guard.mjs': { status: 'dev-hook', counts: { execFileSync: 1 }, note: 'git hook 用 git 查询，开发期' },
  'hooks/scan-commit.mjs': { status: 'dev-hook', counts: { execFileSync: 1 }, note: 'git hook 用 git 查询，开发期' },
  // ── 缺口：会占资源或长时间驻留，尚未接准入/登记 ──
  'src/main/mcpClient.ts': { status: 'managed', counts: { spawn: 1 }, note: '两条路共用这一处 spawn，都保留预算记账（插件不排队）：插件宿主 pluginHost.acquire 经应用级 startManagedSession；builtin-bizone 连接器 bizoneConnector.clientFor 经 deps.admit（bizoneHosted 注入应用级 startManagedSession，**immediate:true** —— 同插件 server/终端，用户触发的一次性共享启动立即起、不排队，成本照登记）。预算都随 McpClient.exited 释放。笔纵客户端进程在运行中心只见排队任务、不作为服务投影（builtin 宿主不在 observedPluginServices 里）' },
  'src/main/cliAuth/install.ts': { status: 'registered', counts: { spawn: 2 }, note: 'CLI 安装脚本经 shellForInstall 选择 shell（官方 curl 管道启用 bash pipefail）+ Windows taskkill 定向终止当前 pid 的子树（短生命周期停止助手，无 shell / 不创建安装任务）：按方案不排队、不自动中断；spawn 后登记为 cli-install: 自有服务，运行中心可见、一次确认可停（走既有 cancelInstall），真实 close 才消失（2026-09-22）' },
  'src/main/cliUpdates/packages.ts': { status: 'managed', counts: { 'promisify(execFile)': 1, execFileSync: 2 }, note: '下载/解包/校验整段经 managedStage→runAppTask（应用级任务，全窗口可见不可取消）；stage 路径校验已异步。仅存的两处 execFileSync 是 boot()/rollback() 激活前校验：那时窗口与资源管理器都还没有，保留同步' }
}

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__fixtures__') continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (EXT.has(path.extname(name)) && !/\.test\.(ts|mjs)$/.test(name)) yield full
  }
}

export function scanLaunchPrimitives(root = ROOT): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir)
    if (!fs.existsSync(abs)) continue
    for (const file of walk(abs)) {
      const rel = path.relative(root, file).split(path.sep).join('/')
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      for (const raw of lines) {
        const line = raw.trim()
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
        for (const [re, callee] of PRIMITIVES) {
          if (!re.test(line)) continue
          out[rel] ??= {}
          out[rel][callee] = (out[rel][callee] ?? 0) + 1
          break // 一行只记一个原语（pty.spawn 不再另算 spawn）
        }
      }
    }
  }
  return out
}

test('每个启动原语都在清单里，清单里没有已经消失的条目', () => {
  const found = scanLaunchPrimitives()
  const problems: string[] = []
  for (const [file, counts] of Object.entries(found)) {
    const entry = MANIFEST[file]
    if (!entry) { problems.push(`未登记的文件：${file} ${JSON.stringify(counts)}`); continue }
    for (const [callee, n] of Object.entries(counts)) {
      if (entry.counts[callee] !== n) problems.push(`${file} 的 ${callee} 计数 ${n}，清单写的是 ${entry.counts[callee] ?? 0}`)
    }
    for (const callee of Object.keys(entry.counts)) {
      if (!(callee in counts)) problems.push(`${file} 清单里的 ${callee} 已不存在`)
    }
  }
  for (const file of Object.keys(MANIFEST)) if (!found[file]) problems.push(`清单条目已无命中（文件删了或原语没了）：${file}`)
  assert.equal(problems.length, 0, '启动点清单与源码不一致，先评审再改清单：\n' + problems.join('\n'))
})

test('缺口条目必须写明未闭环的原因', () => {
  for (const [file, e] of Object.entries(MANIFEST)) {
    if (e.status === 'gap') assert.ok(/未|待|不/.test(e.note), file + ' 的 gap 说明要写清什么没闭环')
    assert.ok(e.note.length >= 8, file + ' 的说明太短')
  }
})
