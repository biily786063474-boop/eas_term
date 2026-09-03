// 这些测试钉的是「走错了不会报错、只会静默出事」的那几处：
// 平台目录名写成 darwin-arm64（打包期只 warn）、PI_CONFIG_DIR 算成空串（写进真 ~/.omp）、
// 拿不到路径时回落到 PATH（跑用户自己那个 omp）、工具白名单里混进不存在的名字
// （每次 session/new 都失败）。覆盖率不是目的。

import type { HostPaths } from '../../../shared/agentChat.ts'
import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { OMP_BUILTIN_TOOLS, OMP_PINNED_VERSION, OMP_RESOURCE_DIR, OMP_TOOLS, OMP_USERDATA_DIR, ompAcpArgs, ompAgentDir, ompBaseEnv, ompBinFileName, ompBinPath, ompBinPathOrNull, ompConfigDirRelative, ompConfigRoot, ompResourceDirName, parseOmpVersion } from './paths.ts'

const MAC = { platform: 'darwin', arch: 'arm64' }
const WIN = { platform: 'win32', arch: 'x64' }

const host = (over: Partial<HostPaths>): HostPaths => ({
  isPackaged: false,
  resourcesPath: '',
  appPath: '/repo',
  userData: '/Users/u/Library/Application Support/Eas-Term',
  home: '/Users/u',
  ...over
})

test('--tools 白名单里的每个名字都真的是 omp 的内建工具（写错了每次 session/new 都会被 validateToolNames 抛）', () => {
  for (const t of OMP_TOOLS) {
    assert.ok(OMP_BUILTIN_TOOLS.includes(t as never), `${t} 不在 omp 的 BUILTIN_TOOL_NAMES 里`)
  }
})

test('白名单里没有 ls —— 它不是 omp 的工具名，列目录归 glob', () => {
  assert.ok(!OMP_TOOLS.includes('ls'))
  assert.ok(!OMP_BUILTIN_TOOLS.includes('ls' as never))
})

test('白名单不含生图 / 浏览器 / 电脑控制这三个（红线 + 默认开着的 browser）', () => {
  for (const forbidden of ['browser', 'computer', 'generate_image']) {
    assert.ok(!OMP_TOOLS.includes(forbidden), `${forbidden} 不该在白名单里`)
  }
})

test('平台目录名用 electron-builder 的 ${os} 取值（mac / win），不是 Node 的 darwin / win32', () => {
  assert.equal(ompResourceDirName(MAC), 'mac-arm64')
  assert.equal(ompResourceDirName({ platform: 'darwin', arch: 'x64' }), 'mac-x64')
  assert.equal(ompResourceDirName(WIN), 'win-x64')
  // 反过来钉一遍：出现 darwin/win32 就是错的，而这个错在打包期只是一条 warn
  assert.ok(!ompResourceDirName(MAC).startsWith('darwin'))
  assert.ok(!ompResourceDirName(WIN).startsWith('win32'))
})

test('Windows 上二进制叫 omp.exe', () => {
  assert.equal(ompBinFileName(MAC), 'omp')
  assert.equal(ompBinFileName(WIN), 'omp.exe')
})

test('packaged 下二进制在 <Resources>/omp/ 里，没有 <os>-<arch> 那一层（打包时被宏挑走压平了）', () => {
  const h = host({ isPackaged: true, resourcesPath: '/App.app/Contents/Resources' })
  assert.equal(ompBinPath(h, MAC), '/App.app/Contents/Resources/omp/omp')
})

test('dev 下走仓库的 resources/omp/<os>-<arch>/，比 packaged 多一层', () => {
  assert.equal(ompBinPath(host({}), MAC), '/repo/resources/omp/mac-arm64/omp')
  assert.equal(
    ompBinPathOrNull(host({ appPath: 'C:\\repo' }), WIN),
    'C:\\repo\\resources\\omp\\win-x64\\omp.exe'
  )
})

test('resourcesPath 在 node --test 下是 undefined —— 判空的那个函数不许抛，要回 null', () => {
  const h = host({ isPackaged: true, resourcesPath: undefined as unknown as string })
  assert.doesNotThrow(() => ompBinPathOrNull(h, MAC))
  assert.equal(ompBinPathOrNull(h, MAC), null)
  // detect() 会被 adapters.test.ts 无参调用，这条路也不许抛
  assert.doesNotThrow(() => ompBinPathOrNull(undefined, MAC))
  assert.equal(ompBinPathOrNull(undefined, MAC), null)
})

test('拿不到路径时 ompBinPath 抛错，绝不返回字面量 omp（回落到 PATH 就跑了用户自己装的那个）', () => {
  assert.throws(() => ompBinPath(undefined, MAC), /omp/)
  assert.throws(() => ompBinPath(host({ isPackaged: true, resourcesPath: '' }), MAC))
  // 反面钉死：任何一条路都不许产出裸的 'omp' / 'omp.exe'
  for (const h of [host({}), host({ isPackaged: true, resourcesPath: '/R' })]) {
    for (const p of [MAC, WIN]) {
      const got = ompBinPathOrNull(h, p)
      assert.ok(got && got !== 'omp' && got !== 'omp.exe', `${got} 是裸命令名`)
    }
  }
})

test('agentDir 是绝对路径 <userData>/omp/agent（PI_CODING_AGENT_DIR 要绝对的）', () => {
  const ud = '/Users/u/Library/Application Support/Eas-Term'
  assert.equal(ompConfigRoot(ud, MAC), `${ud}/omp`)
  assert.equal(ompAgentDir(ud, MAC), `${ud}/omp/agent`)
  assert.ok(path.posix.isAbsolute(ompAgentDir(ud, MAC)))
})

test('PI_CONFIG_DIR 是相对 HOME 的，且 omp 侧 join 回来必须还原成原路径', () => {
  const home = '/Users/u'
  const ud = '/Users/u/Library/Application Support/Eas-Term'
  const rel = ompConfigDirRelative(home, ud, MAC)
  assert.equal(rel, 'Library/Application Support/Eas-Term/omp')
  // 这一步就是 omp 的 dirs.ts:110-112 干的事
  assert.equal(path.posix.join(home, rel), ompConfigRoot(ud, MAC))
})

test('隔离实例的 tmpdir 不在 home 底下，靠 .. 表达；path.join 会规范化掉，不必另开分支', () => {
  const home = '/Users/u'
  const ud = '/private/tmp/eas-verify-1/userdata'
  const rel = ompConfigDirRelative(home, ud, MAC)
  assert.ok(rel.startsWith('..'), '预期用 .. 回退——这是正常情况，不是错误')
  assert.equal(path.posix.join(home, rel), '/private/tmp/eas-verify-1/userdata/omp')
})

test('算成空串要抛 —— omp 的 `PI_CONFIG_DIR || ".omp"` 会把空串吃掉，静默写进用户真实的 ~/.omp', () => {
  // home 本身就是 configRoot 的那种病态配置：relative() 回空串
  assert.throws(() => ompConfigDirRelative('/Users/u/omp', '/Users/u', MAC), /空串|~\/\.omp/)
})

test('Windows 跨盘符按「盘根不同」判，不按「以 .. 开头」判（posix 的 .. 是正常的）', () => {
  // 同盘：正常
  assert.equal(
    ompConfigDirRelative('C:\\Users\\u', 'C:\\Users\\u\\AppData\\Roaming\\Eas-Term', WIN),
    'AppData\\Roaming\\Eas-Term\\omp'
  )
  // 跨盘：path.relative 返回的是绝对路径 D:\data\omp，omp 再 join 上 home 会变成废路径
  assert.equal(path.win32.relative('C:\\Users\\u', 'D:\\data\\omp'), 'D:\\data\\omp')
  assert.throws(() => ompConfigDirRelative('C:\\Users\\u', 'D:\\data', WIN), /盘/)
  // 盘符大小写不同不算跨盘
  assert.doesNotThrow(() => ompConfigDirRelative('c:\\Users\\u', 'C:\\Users\\u\\x', WIN))
})

test('版本号解析对得上钉死的 18.1.2（实测 `omp --version` 输出 `omp/18.1.2`）', () => {
  assert.equal(parseOmpVersion('omp/18.1.2\n'), OMP_PINNED_VERSION)
  assert.equal(parseOmpVersion('omp/18.1.2-canary.1'), '18.1.2-canary.1')
  assert.equal(parseOmpVersion('command not found'), null)
})

test('打包常量与配置目录常量是两个东西，别合并（一个只读、一个可写，语义无关）', () => {
  assert.equal(OMP_RESOURCE_DIR, 'omp')
  assert.equal(OMP_USERDATA_DIR, 'omp')
  assert.equal(OMP_PINNED_VERSION, '18.1.2')
})

// ── 2026-09-02 真机事故：`ask` 让每一次 session/new 都失败 ──────────────────
//
// 用户报的是「登录后发信息展示 401 …(1004)」。查到最后跟凭证毫无关系 ——
// 拿 app 一模一样的参数跑 ACP，`session/new` 当场回：
//
//   Unknown tool in --tools: ask.
//   Valid tools: read, bash, edit, write, grep, glob, todo, ast_edit,
//                goal, init_experiment, run_experiment, log_experiment, update_notes.
//
// 把 `ask` 去掉，同一条命令立刻走通：omp 自己选中 `minimax-code-cn/MiniMax-M3`，
// 用 broker 里那条订阅凭证正常回话。
//
// **为什么上面那条「每个名字都是内建工具」的测试没拦住？**
// 因为它对的是我们手抄的 `OMP_BUILTIN_TOOLS`（29 个），而 `ask` 确实在那份里。
// 但 `--tools` 校验的不是「是不是内建工具」，是「**在当前模式下注册了没有**」——
// `ask` 是交互式 TUI 的工具，ACP 无头模式压根没有它。
// 手抄的清单答不了这个问题，所以真正的判据只能是**让二进制自己跑一遍**
// （`scripts/check-omp-bundle.mjs` 打包前做这件事）。

test('**白名单里没有 ask** —— 它是 TUI 的工具，ACP 模式下不注册，写进去每次 session/new 都失败', () => {
  assert.ok(!OMP_TOOLS.includes('ask'), 'ask 回到白名单里了 —— 那会让 omp 完全起不来')
})

// ⚠️ **这里曾经放着一张手抄的「ACP 能接受的工具」白名单，它是错的。**
// 那张名单抄自二进制报错里的 "Valid tools: …" 那一句 —— 而那句是**上下文相关**的：
// `--tools=read,__nope__` 报的是 "read, write, goal, init_experiment, …"，
// 它列的是**当前这次请求已注册的**，不是完整目录。照它抄，
// 就会把 `web_search` / `lsp` / `inspect_image` 这些真能用的判成「不被接受」。
//
// **正向名单这一层根本证明不了**（要起真进程），所以这里只做两件做得到的事：
// ① 钉住那批**实测被拒**的名字（负向断言，可靠）；② 指到真判据去。
// 真判据是 `scripts/check-omp-bundle.mjs` 打包前那次真 ACP 握手。

/** ACP 无头模式**不注册**的工具（2026-09-02 对 18.1.2 逐个真握手实测）。
 *  它们都在上游 `BUILTIN_TOOL_NAMES` 里 —— 所以「是不是内建工具」答不了这个问题。
 *  写进 `--tools` 的后果是 **每一次 `session/new` 都失败**。 */
const REJECTED_IN_ACP = [
  'ask', 'ast_grep', 'checkpoint', 'rewind', 'memory_edit',
  'retain', 'recall', 'reflect', 'learn', 'manage_skill', 'github', 'security_scan'
]

test('白名单里不许出现 ACP 模式拒收的工具 —— 沾一个 session/new 就全废', () => {
  for (const t of OMP_TOOLS) {
    assert.ok(!REJECTED_IN_ACP.includes(t), `${t} 在 ACP 无头模式下不注册 —— session/new 会整个失败`)
  }
})

test('`task` 与 `eval` 能注册，但**故意不放** —— 放它们要单独议', () => {
  // 都实测能通过握手，不放是成本与风险的决定，不是技术限制：
  // `task` 起子 agent（token 成倍、子 agent 权限另一套），
  // `eval` 执行任意代码（与 `bash` 同档）。哪天要放，连同审批档位一起想。
  assert.ok(!OMP_TOOLS.includes('task'))
  assert.ok(!OMP_TOOLS.includes('eval'))
})

test('白名单不许有重复项 —— 重复不报错，只是让人读不准到底开了什么', () => {
  assert.equal(new Set(OMP_TOOLS).size, OMP_TOOLS.length)
})

// ── 2026-09-03：命令行的审批档位必须跟着设置走 ─────────────────────────────
//
// **这里修的是一个静默失败**：`launch.ts` 原来硬写 `--approval-mode=always-ask`，
// 而 2026-09-02 把档位做成了 `config.yml` 里的设置。**命令行压过配置文件** ——
// 于是那个开关落了盘、界面显示也对，起会话却照样每一步都问。
// 「配置写对了但不生效」这类问题没有任何报错，只能靠断言钉住。

test('**`--approval-mode` 用设置里的值，不是写死的 always-ask**', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompargs-'))
  fs.writeFileSync(path.join(dir, 'omp-setup.json'), JSON.stringify({ approvalMode: 'yolo' }))
  const args = ompAcpArgs({ userData: dir } as never)
  assert.ok(args.includes('--approval-mode=yolo'), `拿到的是 ${args.join(' ')}`)
  assert.ok(!args.some((a) => a.includes('always-ask')), '还残留着写死的 always-ask')
})

test('设置里开了审批 → 命令行也跟着变严', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompargs-'))
  fs.writeFileSync(path.join(dir, 'omp-setup.json'), JSON.stringify({ approvalMode: 'always-ask' }))
  assert.ok(ompAcpArgs({ userData: dir } as never).includes('--approval-mode=always-ask'))
})

test('角色契约进 `--append-system-prompt`；没有角色就不加这个参数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompargs-'))
  const withRole = ompAcpArgs({ userData: dir } as never, '你是工匠')
  assert.ok(withRole.includes('--append-system-prompt=你是工匠'))
  assert.ok(!ompAcpArgs({ userData: dir } as never, '   ').some((a) => a.startsWith('--append-system-prompt')))
})

// ── D4 · omp 的工具边界：**白名单减 deny**，不是塞黑名单 ────────────────────
//
// omp 的 `--tools` 是白名单，而角色给的是黑名单，两者语义相反。
// 直接把 deny 名单塞进 `--tools` 是语义反转 —— 那等于「只允许被禁的那些」。
// 而且算错的后果不是「限制没生效」，是**每一次 session/new 都失败**
// （白名单里出现 omp 不认识的名字，validateToolNames 直接抛）。

test('**deny 从白名单里减掉**，不是加进去', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompd-'))
  const args = ompAcpArgs({ userData: dir } as never, undefined, { deny: ['bash', 'write'] })
  const tools = (args.find((a) => a.startsWith('--tools=')) ?? '').slice('--tools='.length).split(',')
  assert.ok(!tools.includes('bash'), 'bash 还在白名单里')
  assert.ok(!tools.includes('write'), 'write 还在白名单里')
  assert.ok(tools.includes('read'), '把不该减的也减掉了')
})

test('**减到空也要留至少一个** —— 空的 --tools 会让 session/new 失败', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompd-'))
  const args = ompAcpArgs({ userData: dir } as never, undefined, { deny: [...OMP_TOOLS] })
  const v = args.find((a) => a.startsWith('--tools='))
  assert.ok(v && v !== '--tools=', `减成了 ${v}`)
})

test('deny 里有 omp 根本没有的工具名 → 忽略，不许污染白名单', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompd-'))
  const args = ompAcpArgs({ userData: dir } as never, undefined, { deny: ['不存在的工具'] })
  const tools = (args.find((a) => a.startsWith('--tools=')) ?? '').slice('--tools='.length).split(',')
  assert.deepEqual(tools, [...OMP_TOOLS], '白名单被动了')
})

test('没有角色工具时 --tools 与今天逐字相同', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompd-'))
  assert.equal(
    ompAcpArgs({ userData: dir } as never, undefined, {}).find((a) => a.startsWith('--tools=')),
    ompAcpArgs({ userData: dir } as never).find((a) => a.startsWith('--tools='))
  )
})

describe('ompBaseEnv · 不许把本机 Eas-Term 的凭证漏给 omp', () => {
  const host: HostPaths = {
    isPackaged: false,
    resourcesPath: '',
    appPath: '/app',
    userData: '/ud',
    home: '/home'
  }
  /** 这几个是 Eas-Term 发给**自己的子进程**的凭证。
   *
   *  omp 是我们 spawn 的子进程，会继承主进程的 env —— 而主进程在
   *  「从另一个 Eas-Term 的终端里启动」时**自己就带着外层那套**
   *  （2026-09-03 实测：隔离实例的主进程里就有 EAS_TERM_TOKEN）。
   *  漏过去的后果是这个会话能调外层那个 app 的 MCP 桥，含 `/secret-env` 路由。
   *  `planOmpLaunch` 里那条「不传 mcpEnv 就不注入」的保证，
   *  必须靠这里先擦干净才成立 —— 否则它只是没**再**给一份，而不是没给。 */
  const LEAKY = [
    'EAS_TERM_PORT',
    'EAS_TERM_TOKEN',
    'EAS_SECRET_TOKEN',
    'EAS_PTY_ID',
    'EAS_PROJECT',
    'EAS_TEAM_ROLE'
  ]

  it('环境里有这些时一个都不带进去', () => {
    const saved: Record<string, string | undefined> = {}
    for (const k of LEAKY) {
      saved[k] = process.env[k]
      process.env[k] = 'leaked-' + k
    }
    try {
      const env = ompBaseEnv(host)
      for (const k of LEAKY) {
        assert.equal(env[k], undefined, `${k} 漏进了 omp 的环境`)
      }
    } finally {
      for (const k of LEAKY) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  })

  it('**擦掉不影响显式注入** —— planOmpLaunch 把 mcpEnv 铺在它后面', () => {
    const env = { ...ompBaseEnv(host), EAS_TERM_PORT: '5', EAS_TERM_TOKEN: 't' }
    assert.equal(env.EAS_TERM_PORT, '5')
    assert.equal(env.EAS_TERM_TOKEN, 't')
  })
})
