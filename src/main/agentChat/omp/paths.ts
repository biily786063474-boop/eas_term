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
 *  抄一份的唯一用途是让 `check-omp-bundle.mjs` 与本目录的测试能在**打包前**
 *  拦下写错的工具名——运行期写错的代价是每次 `session/new` 都被
 *  `validateToolNames` 抛掉，而那是个只有真起会话才看得见的失败。 */
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
 *  **每一次 `session/new` 都失败**。上面这 8 个 2026-09-02 已逐个在
 *  `BUILTIN_TOOL_NAMES` 里核对到（同文件的测试会再钉一遍）。
 *
 *  没放进来的高危项另有第二道锁（见 spec §P.4 的 `tools.approval` deny 与
 *  `browser.enabled: false`）——白名单不是唯一防线，因为 `sdk.ts` 推 tts 时不看 `--tools`。 */
export const OMP_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'glob', 'todo', 'ask']

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
