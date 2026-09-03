// omp 的「东西在哪」：随包二进制的落点、受管配置目录的落点，以及钉死的版本与工具白名单。
//
// **零 electron import，纯函数**。理由有两条，缺一不可：
// ① `transport.ts` 要在 `node --test` 下直接跑（package.json 的 test 是 `node --test 'src/**/*.test.ts'`），
//    它会 import 本文件；import electron 的模块在 node 下 require 不到，整条测试链当场炸。
// ② 打包脚本（`scripts/check-omp-bundle.mjs`）也要读这里的常量做打包前硬拦，
//    那是个纯 node 进程，更没有 electron。
// 所以本文件只接受调用方算好的 `HostPaths`，自己不去问 `app`，也不做任何 IO
// （不 existsSync、不 stat）——存在性由 `check-omp-bundle.mjs` 在打包期保证，
// 运行期真缺文件的信号是 spawn 的 ENOENT，比这里再探一次更准。
//
// 与用户自装 omp 的隔离承诺（spec §2.4）在本文件里落成两条硬规矩：
// - `ompBinPath()` 拿不到路径就**抛**，绝不返回字面量 'omp'。退回 PATH 就是去跑用户
//   自己装的那个 omp，配置目录、版本、工具白名单全部失控，隔离承诺直接作废。
// - `ompConfigDirRelative()` 算出空串就**抛**。omp 那边是
//   `process.env.PI_CONFIG_DIR || CONFIG_DIR_NAME`（`utils/src/dirs.ts:281-283`），
//   空串会被 `||` 吃掉回落成 `.omp` —— 于是我们的受管配置直接写进用户真实的 `~/.omp`。
//   这是本文件最不显眼、后果最重的一条边界。

import path from 'node:path'

import { PROBE_ENV } from '../../probeEnv.ts'
import type { HostPaths } from '../../../shared/agentChat.ts'

/** 钉死的上游版本。↔ `resources/omp/manifest.json` 的 `version`，由
 *  `scripts/check-omp-bundle.mjs` 硬比对；首次 spawn 前 `omp --version` 再比一次。
 *  2026-09-02 实测该二进制 `--version` 输出 `omp/18.1.2`。 */
export const OMP_PINNED_VERSION = '18.1.2'

/** electron-builder `extraResources` 的 `to`，即打包后 `<Resources>/omp/`。
 *  `check-omp-bundle.mjs` 断言 package.json 里的 `to` 与这个常量相等。 */
export const OMP_RESOURCE_DIR = 'omp'

/** 受管配置在 `userData` 下的目录名，即 omp 眼里的 configRoot（`~/.omp` 的替身）。
 *
 *  **故意与 `OMP_RESOURCE_DIR` 分开定义，尽管两者当前同为 'omp'**：一个是安装包里
 *  只读的二进制目录，一个是用户机器上可写的配置目录，语义无关。合成一个常量的话，
 *  将来改任何一边都会静默把另一边也改了（而 `check-omp-bundle.mjs` 只盯前者）。 */
export const OMP_USERDATA_DIR = 'omp'

/** omp 全部内建工具名。**逐字抄自上游**
 *  `packages/coding-agent/src/tools/builtin-names.ts` 的 `BUILTIN_TOOL_NAMES`
 *  （2026-09-02 对 18.1.2 源码核对，29 个，顺序照原样）。
 *  **它只是一道粗筛，不是判据。** 2026-09-02 实测：`ask` 在这份清单里、
 *  却不被 ACP 模式的 `--tools` 接受 —— 「是不是内建工具」和「当前模式注册了没有」
 *  是两个问题，这份清单只答得了前一个。真判据是二进制自己跑一次 ACP 握手。 */
import { safeApprovalMode } from './config.ts'
import { readOmpSetup } from './store.ts'

export const OMP_BUILTIN_TOOLS = [
  'read', 'bash', 'edit', 'ast_grep', 'ast_edit', 'ask', 'debug', 'eval',
  'github', 'glob', 'grep', 'lsp', 'inspect_image', 'browser', 'computer',
  'checkpoint', 'rewind', 'security_scan', 'task', 'hub', 'todo', 'web_search',
  'write', 'memory_edit', 'retain', 'recall', 'reflect', 'learn', 'manage_skill'
] as const

/** 传给 `--tools` 的白名单。
 *
 *  **没有 `ls`** —— 直觉上「列目录」该有个 `ls`，omp 里没有这个工具名（列目录归 `glob`）。
 *  写进去的后果不是「多一个没人用的名字」，是 `validateToolNames` 直接抛、
 *  **每一次 `session/new` 都失败**。
 *
 *  **也没有 `ask`。** 它确实在 `BUILTIN_TOOL_NAMES` 里，所以「逐个核对内建清单」
 *  这个办法放它过去了 —— 但 `--tools` 校验的不是「是不是内建工具」，是
 *  「**在当前模式下注册了没有**」：`ask` 是交互式 TUI 的工具，ACP 无头模式没有它。
 *  2026-09-02 真机代价：用户以为是订阅登录的问题（看到的是 provider 的 401），
 *  实际上每一次 `session/new` 都死在这一行，凭证从头到尾都是好的。
 *
 *  **所以手抄的清单不是靠得住的判据**（见下面 `OMP_BUILTIN_TOOLS` 的说明），
 *  真判据是让二进制自己跑一次 ACP 握手 —— `scripts/check-omp-bundle.mjs` 打包前做。
 *
 *  没放进来的高危项另有第二道锁（见 spec §P.4 的 `tools.approval` deny 与
 *  `browser.enabled: false`）——白名单不是唯一防线，因为 `sdk.ts` 推 tts 时不看 `--tools`。 */
export const OMP_TOOLS = [
  'read', 'bash', 'edit', 'write', 'grep', 'glob', 'todo',
  // ── 2026-09-02 补进来的四个。每一个都跑过真 ACP 握手才敢写（下同上）───────
  //
  // `web_search`  ⚠️ **这个不是零代价的**：它给模型开了**自主出站** ——
  //               不是用户点了什么才联网，是模型自己决定去搜。而审批默认 `yolo`，
  //               所以没有那道确认。已按图纸 01 红线 4 登记在「网络出站清单」里。
  //               **要撤就删这一行**，同时回去改图纸那一行。
  // `lsp`         本机语言服务器（`lsp.enabled` 上游默认 true）。不出站，
  //               但会**起额外进程** —— 记在长跑资源那本账上（每会话一份固定成本）。
  // `ast_edit`    结构化改代码，纯本机。与已经在名单里的 `edit` 同一风险档，
  //               真·零新增代价。
  // `inspect_image` 看图。缺 `modelRoles.vision` 时**不会瘫**：实现里是
  //               `@vision ?? @default ?? 当前模型`，vision-capable 的模型直接就用。
  //
  // 没进来的那批不是漏了，是 **ACP 无头模式压根不注册**（实测逐个被
  // `Unknown tool in --tools` 拒掉）：ast_grep · checkpoint · rewind · memory_edit ·
  // retain · recall · reflect · learn · manage_skill · github · security_scan。
  // 其中 checkpoint / rewind（会话回滚）最可惜，它们依赖 TUI 的会话模型。
  //
  // `task`（起子 agent）和 `eval`（执行任意代码）**能注册但故意没放**：
  // 前者 token 成本成倍且子 agent 权限是另一套，后者与 `bash` 同档危险 ——
  // 这两个要放得单独议，不该混在「顺手加几个」里。
  'web_search', 'lsp', 'ast_edit', 'inspect_image'
]

/** 调用方（`session.ts`）算 `HostPaths` 时用的是真的 `process.platform`；
 *  测试要能在 mac 上验 Windows 的分支，所以把平台做成可注入的参数。 */
export interface PlatformId {
  platform: string
  arch: string
}

const HERE: PlatformId = { platform: process.platform, arch: process.arch }

/** 按平台挑 path 的方言。默认导出的 `path` 在 win32 上就是 `path.win32`、
 *  其余平台就是 `path.posix`，所以这么挑等价于直接用 `path`——**但可以被测试注入**，
 *  否则「跨盘符」那条分支只有在真的 Windows 上才跑得到，也就等于没测。 */
function flavor(p: PlatformId): typeof path.posix {
  return p.platform === 'win32' ? path.win32 : path.posix
}

/** `resources/omp/` 下的子目录名。
 *
 *  **`${os}` 是 electron-builder 的宏，取值 `mac` / `win` / `linux`，不是 Node 的
 *  `darwin` / `win32`**（`app-builder-lib/out/core.js:46-48` 的 `buildConfigurationKey`）。
 *  按 `process.platform` 取名会得到 `darwin-arm64`，而 extraResources 的 `from`
 *  展开成 `mac-arm64` —— 目录不存在时 electron-builder 只
 *  `log.warn("file source doesn't exist")`（`fileMatcher.js:271-274`）**不报错**，
 *  包照样打出来，装上去才发现没有二进制。这就是这个映射单独成函数、单独有测试的原因。 */
export function ompResourceDirName(p: PlatformId = HERE): string {
  const os = p.platform === 'darwin' ? 'mac' : p.platform === 'win32' ? 'win' : String(p.platform)
  return `${os}-${p.arch}`
}

/** 二进制文件名。↔ `manifest.json` 里每个 target 的 `file`。 */
export function ompBinFileName(p: PlatformId = HERE): string {
  return p.platform === 'win32' ? 'omp.exe' : 'omp'
}

/** 随包二进制的绝对路径；**拿不到就返回 null，绝不抛**。
 *
 *  两个调用场景要的是相反的东西，所以拆成两个函数：
 *  - `adapters/omp.ts` 的 `detect(host)` 要能安全判空（`adapters.test.ts` 会**无参**
 *    调用 `detect()`，spec §P.3 要求这时返回 false 而不是抛）——用这一个。
 *  - 真要 spawn 时拿不到路径是致命的——用下面会抛的 `ompBinPath()`。
 *
 *  `host.resourcesPath` 在 dev（含 `node --test`）下是 `undefined`，类型上却写着
 *  `string`（见 `shared/agentChat.ts` 的 `HostPaths` 注释）。这里**按真值判**而不是
 *  按类型信，否则 `path.join(undefined, …)` 抛的是 TypeError —— 一个既不该抛、
 *  抛出来还看不懂的错。 */
export function ompBinPathOrNull(host: HostPaths | null | undefined, p: PlatformId = HERE): string | null {
  if (!host) return null
  const f = flavor(p)
  const bin = ompBinFileName(p)
  if (host.isPackaged) {
    // 打包后 extraResources 落在 `<Resources>/omp/`，二进制直接在其下（没有 <os>-<arch> 那层）
    if (!host.resourcesPath) return null
    return f.join(host.resourcesPath, OMP_RESOURCE_DIR, bin)
  }
  // dev 走仓库里的 `resources/omp/<os>-<arch>/`。**比 packaged 多一层**：
  // 仓库里三个平台的二进制并存，打包时才由 `${os}-${arch}` 宏挑走一份、压平成 `omp/`。
  // 照 session.ts:168-172 的 hookScriptPath 样板，只是它两边都不带这层。
  if (!host.appPath) return null
  return f.join(host.appPath, 'resources', OMP_RESOURCE_DIR, ompResourceDirName(p), bin)
}

/** 随包二进制的绝对路径；**拿不到就抛**。
 *
 *  抛而不是回落到字面量 `'omp'`：回落等于去 PATH 上找用户自己装的那个 omp，
 *  它读的是用户真实的 `~/.omp`、版本未知、工具白名单未知 —— spec §2.4 第一条
 *  明写「`buildArgs` 拿不到路径时抛错，绝不退回字面量 'omp'」。
 *  一个能启动但跑错二进制的会话，比一个起不来的会话难查得多。 */
export function ompBinPath(host: HostPaths | null | undefined, p: PlatformId = HERE): string {
  const bin = ompBinPathOrNull(host, p)
  if (!bin) {
    throw new Error(
      `omp 二进制路径算不出来（isPackaged=${host?.isPackaged ?? 'n/a'}、` +
        `resourcesPath=${host?.resourcesPath || '空'}、appPath=${host?.appPath || '空'}）。` +
        '不回落到 PATH 上的 omp：那会跑用户自己装的那个，配置目录与版本都不受我们控制。'
    )
  }
  return bin
}

/** 受管配置根目录（omp 眼里的 configRoot，替代 `~/.omp`）。绝对路径。 */
export function ompConfigRoot(userData: string, p: PlatformId = HERE): string {
  if (!userData) throw new Error('ompConfigRoot: userData 为空')
  return flavor(p).join(userData, OMP_USERDATA_DIR)
}

/** `PI_CODING_AGENT_DIR` 的值：**绝对**路径，`<userData>/omp/agent`。
 *
 *  **签名比 spec §P.3 少一个 `home` 参数**（spec 写的是 `ompAgentDir(home, userData)`）。
 *  agentDir 是绝对路径，跟 home 没有任何关系，收一个用不到的参数只会制造
 *  「两个同类型字符串参数传反了也不报错」的坑。故意偏离，理由记在这里。
 *
 *  omp 侧：`dirs.ts:320` `this.agentDir = agentDirOverride ? path.resolve(...) : defaultAgent`，
 *  且 override 非默认值时 `isDefault` 为假 → `dirs.ts:338-361` 那段 XDG 分支整个关掉。
 *  这就是为什么设了它之后 `XDG_DATA_HOME` 之类再也改不动 agent 目录
 *  （但 configRoot 还归 `PI_CONFIG_DIR` 管，两个都要设）。 */
export function ompAgentDir(userData: string, p: PlatformId = HERE): string {
  return flavor(p).join(ompConfigRoot(userData, p), 'agent')
}

/** `PI_CONFIG_DIR` 的值：**相对 `home`** 的路径。
 *
 *  为什么是相对的：omp 那边是 `path.join(os.homedir(), getConfigDirName())`
 *  （`utils/src/dirs.ts:110-112` + `:281-283`），它把这个环境变量当成目录**名**往 home 上拼。
 *
 *  为什么相对路径能表达 tmpdir 里的隔离实例：`path.join` 做的是词法规范化，
 *  `join('/Users/x', '../../private/tmp/i/omp')` 就是 `/private/tmp/i/omp`，
 *  不需要目标在 home 底下。所以 `verify-app.mjs` 的临时 `--user-data-dir` 直接能用，
 *  **不必为它另开一条分支**（已核实 dirs.ts:110-112）。
 *
 *  两处会抛：
 *  - **算出空串**：`home` 与 configRoot 同一个目录。omp 侧 `env.PI_CONFIG_DIR || '.omp'`
 *    会把空串吃掉、回落成 `.omp` —— 受管配置写进用户真实的 `~/.omp`，隔离当场破功。
 *    这是「静默走错目录」而不是「报错」，所以必须在这里拦。
 *  - **跨盘符**（Windows）：`path.relative('C:\\Users\\x', 'D:\\data')` 返回的是**绝对**
 *    路径 `D:\data`，再被 omp `join` 到 home 上会变成 `C:\Users\x\D:\data` 这种废路径。
 *    判据按「盘根不同」而不是「以 `..` 开头」——posix 下 tmpdir 的结果正是以 `..` 开头
 *    且完全正常，用那个判据会把好路径当成错的。 */
export function ompConfigDirRelative(home: string, userData: string, p: PlatformId = HERE): string {
  if (!home) throw new Error('ompConfigDirRelative: home 为空')
  const f = flavor(p)
  const root = ompConfigRoot(userData, p)
  if (!f.isAbsolute(home) || !f.isAbsolute(root)) {
    throw new Error(`ompConfigDirRelative: home 与 userData 必须是绝对路径（home=${home} root=${root}）`)
  }
  const sameRoot =
    p.platform === 'win32'
      ? f.parse(home).root.toLowerCase() === f.parse(root).root.toLowerCase()
      : f.parse(home).root === f.parse(root).root
  if (!sameRoot) {
    throw new Error(
      `omp 配置目录 ${root} 与 HOME ${home} 不在同一个盘/根上，无法表达成 PI_CONFIG_DIR 要的相对路径。`
    )
  }
  const rel = f.relative(home, root)
  if (!rel) {
    throw new Error(
      `omp 配置目录算成了空串（home 与 ${root} 同一个目录）。空串会被 omp 的 ` +
        '`PI_CONFIG_DIR || ".omp"` 吃掉、回落进用户真实的 ~/.omp。'
    )
  }
  return rel
}

/** 从 `omp --version` 的输出里取版本号。2026-09-02 实测输出是 `omp/18.1.2`。
 *  取不到返回 null 交给调用方决定怎么办 —— 版本比对失败是「要不要拦」的产品判断，
 *  不是这个模块该替人做的决定。 */
export function parseOmpVersion(stdout: string): string | null {
  const m = /omp\/(\d+\.\d+\.\d+[^\s]*)/.exec(stdout)
  return m ? m[1] : null
}

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

/** 起 omp 子进程时的那份环境。**四个调用点（起会话 / 冒烟 / 订阅登录 / 查额度）
 *  必须用同一份** —— 少设一个变量就会登进用户自己的 `~/.omp`，
 *  而我们的会话读的是隔离目录，症状是「登录成功了，一发消息说没配」。
 *
 *  **它住在 paths.ts 而不是 launch.ts**：这几个变量管的就是「omp 的配置目录指到哪」，
 *  跟这份文件里其它东西是同一件事。更实际的理由是 `launch.ts` 拖着 electron
 *  （密钥柜、MCP 桥），而订阅登录那条路只要这份环境 —— 放在那边会让
 *  `login.ts` 整条依赖链都进不了单测。2026-09-02 写 `login.test.ts` 时撞到。
 * 所有 omp 子进程共用的那半环境：**把它关进我们自己的配置目录**。
 *
 *  会话、冒烟、`omp usage`、`omp models` 四处都要用同一份 —— 少设一处的症状是
 *  那条命令读的是用户**真实的 `~/.omp`**（凭证、会话记录、额度全是别人的那套），
 *  而且不报错。所以抽出来，四个调用点都从这里拿。 */
export function ompBaseEnv(host: HostPaths): Record<string, string> {
  const env: Record<string, string> = {
    ...(PROBE_ENV as Record<string, string>),
    // **HOME 必须与算相对路径用的那个同源**。`agentRules.ts:41-43` 记着一次实测事故：
    // `os.homedir()` 跟随 `$HOME`、`app.getPath('home')` 不跟随，两者分叉过。
    // omp 那边用的是 `os.homedir()`，所以显式把 HOME 钉成我们算路径时用的那一个，
    // 否则会出现「配置写进 A、omp 读的是 B」，而界面显示「已配置」。
    HOME: host.home,
    PI_CONFIG_DIR: ompConfigDirRelative(host.home, host.userData),
    // 绝对路径版。同时设两个是有意的：它优先级最高、且**把 XDG 分支整个关掉**
    // （`dirs.ts:316-320` 一旦有 override，`isDefault` 为假）——
    // 于是 agentDir 不再依赖「相对 HOME」这条假设，Windows 跨盘符那种情形也稳。
    PI_CODING_AGENT_DIR: ompAgentDir(host.userData),
    // 跳过 omp 的交互式初始化向导（上游 `modes/setup-wizard/index.ts:49`）。
    // 不设的话首次起会话会挂在等输入，界面上看到的是「超时」而看不出原因。
    OMP_SKIP_SETUP: '1'
  }
  for (const k of SCRUB_KEYS) delete env[k]
  return env
}

/** `omp acp` 的参数。
 *
 *  ⚠️ **审批档位必须从设置读，不能硬写。** 这里原来写死
 *  `--approval-mode=always-ask`，而 2026-09-02 把档位做成了 `config.yml` 里的设置
 *  （用户：「approvalMode 默认应该是 yolo，审批要用户去点设置」）——
 *  **命令行参数压过配置文件**，于是那个开关落了盘却不生效：
 *  设置里关掉审批，起会话照样每一步都问。
 *  两处必须给同一个值，判据只有一个（`safeApprovalMode(readOmpSetup(...))`）。
 *
 *  角色契约走 `--append-system-prompt`（2026-09-03 实测 `omp acp` 收这个参数）。 */
export function ompAcpArgs(host: HostPaths, roleContract?: string): string[] {
  const mode = safeApprovalMode(readOmpSetup(host.userData).approvalMode)
  const args = ['acp', `--approval-mode=${mode}`, `--tools=${OMP_TOOLS.join(',')}`]
  const contract = roleContract?.trim()
  if (contract) args.push(`--append-system-prompt=${contract}`)
  return args
}
