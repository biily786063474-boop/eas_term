#!/usr/bin/env node
// Claude Code 的 PreToolUse hook：角色 `caps.write=false` 在 Claude 上的**第二道闸**。
//
// 第一道闸是 `--disallowedTools Write Edit NotebookEdit`（session.ts / claude.ts 拼的启动
// 参数）——它挡住了模型的内置写工具，但挡不住 Bash：只要 `caps.shell` 没有一起禁掉，
// 模型仍能开一个终端跑 `echo x > file`、`sed -i`、`rm` 之类的命令改文件，逃生口全在
// 「工具边界管不到 shell 里发生的事」这句话上。这份脚本就是补这个逃生口的第二道闸：
// 附成 `--settings` 里的一条 PreToolUse hook（matcher `Bash`），命令一看像是在写文件
// 就直接 deny，不等模型自己守规矩。
//
// ⚠️ **这道闸的硬度和 Codex 的 OS 沙箱不是一回事**：Codex 的 `-s read-only` 是内核层面
// 拦写系统调用，命令怎么拼都躲不掉；这里是**按命令的字符串模式识别**，不做真正的
// shell 解析（不追变量展开、不追函数/别名、不追 `source` 进别的脚本）。已知会漏过的：
//   · 写操作藏在**外部脚本文件**里（`bash foo.sh`、`node script.js`——脚本文件内部
//     不管做什么，这里只看得到调用它的这一行命令，拦不住）；
//   · `cat <<EOF > file` 这类 heredoc 之外的花样组合，或者拿变量拼出来的重定向目标；
//   · 任何用引号/转义把写意图藏起来、让字符串匹配失焦的命令。
// 也就是说，这道闸能挡住「模型老老实实在 Bash 里敲一条写命令」的最常见情形，
// 挡不住「模型刻意绕」的情形——报告与文档里都要如实写这句话，不能让人误以为
// 这跟 Codex 的沙箱一样硬。
//
// **主逻辑只在「作为脚本被 node 直接运行」时执行**（`process.argv[1]` 判断，见文件尾）：
// 被 import（测试文件 `writeGuard.test.ts` 只要 `isWriteCommand`）时，不读 stdin、
// 不产出任何输出、也不会挂起等一个永远不会来的 stdin——单测才 import 得动。
//
// hook 响应体的形状、`process.exitCode = 0` 而不是 `process.exit()` 的理由，与同目录
// `eas-pretooluse.mjs` 逐字相同（那边的文件头已经写过一遍，不重复贴）：
// `process.exit()` 会截断还没 flush 完的 stdout 管道写入，而这里的写入正是最不能被
// 截断成半截 JSON 的「兜底拒绝」路径。
import { fileURLToPath } from 'node:url'
import { hookResponseBody } from './responseBody.mjs'

// ── 按命令模式识别是否含写操作 ──────────────────────────────────────────
//
// 整体策略：先在**整条命令**上找有没有「非豁免的重定向」（`>` / `>>`，`shell` 层面的
// 重定向符不会被 `|`/`;`/`&&` 拆开，所以不需要先切段）；再把命令按 `;`、`&&`、`||`、
// `|` 切成若干段，逐段判断段首（或段内任意 token，视规则而定）是不是写命令——这样
// `ls && rm x` 里 `rm` 排在第二段也能拦住，`ls | tee out` 里 `tee` 排在管道右边也一样。
//
// 这不是 shell 解析（没有引号配对、没有变量展开），是**够用的字符串模式匹配**——
// 命令词的判定一律用「切出来的整段 token 严格相等」而不是子串包含，天然带着词边界
// （`rmdir` 不会被 `rm` 误伤，`chmoda` 不会被 `chmod` 误伤）。

const SHELL_OPERATOR_RE = /\|\||&&|\||;/

/** 按 `;` `&&` `||` `|` 切分成若干段。**不处理引号内的这些字符**（那需要真正的
 *  shell 解析），是本方案已知的粗糙之处。 */
function splitSegments(cmd) {
  return cmd.split(SHELL_OPERATOR_RE)
}

/** 一段命令里的第一个 token，去掉路径前缀、转小写——`/usr/bin/rm` 与 `rm` 同等对待。 */
function commandWord(segment) {
  const m = segment.trim().match(/^(\S+)/)
  if (!m) return ''
  const raw = m[1]
  const base = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  return base.toLowerCase()
}

/** 第二个 token（子命令位，如 `git commit` 的 `commit`）。 */
function secondWord(segment) {
  const parts = segment.trim().split(/\s+/)
  return (parts[1] ?? '').toLowerCase()
}

/** 这一段里有没有严格等于 `token` 的独立词。 */
function hasToken(segment, token) {
  return segment
    .trim()
    .split(/\s+/)
    .some((p) => p === token)
}

/** 重定向：`>` / `>>`，但 `> /dev/null`、`2>&1`、`2>/dev/null` 这类不改文件内容的
 *  不算。逐个找完整条命令里所有 `>`/`>>`，只要有一处目标不是这几种豁免形态就判写。
 *
 *  正则里 `(\d*)` 吃掉紧贴在 `>` 前面的 fd 号（`2>`），`\s*` 允许 `>` 和目标之间有空格
 *  （`> /dev/null` 与 `>/dev/null` 都要认得），目标本身用 `&\d+`（`&1` 这种拷贝到另一个
 *  fd）或者「一串非空白/非 `&|;` 字符」两选一去匹配。 */
function hasWriteRedirect(cmd) {
  const re = /\d*(>{1,2})\s*(&\d+|[^\s&|;]*)/g
  let m
  while ((m = re.exec(cmd))) {
    const target = (m[2] ?? '').trim()
    if (target === '/dev/null') continue
    if (/^&\d+$/.test(target)) continue
    return true
  }
  return false
}

/** `sed -i` / `perl -i`（含 `-i.bak` 这种把备份后缀粘在同一个 token 上的写法）。 */
function hasInPlaceFlag(segment) {
  return segment
    .trim()
    .split(/\s+/)
    .some((p) => p === '-i' || p.startsWith('-i.'))
}

const IN_PLACE_EDIT_COMMANDS = new Set(['sed', 'perl'])

/** 直接改文件/目录的命令词——不含 shell 内建的重定向，这些本身就是"改"。 */
const WRITE_COMMAND_WORDS = new Set([
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'truncate', 'dd', 'install', 'rsync'
])

/** git 的写子命令。`branch` 单独处理——只有带 `-d`/`-D`（删分支）才算写，
 *  单纯 `git branch` 或 `git branch <name>`（列出/创建）不在这份简报要拦的范围内。 */
const GIT_WRITE_SUBCOMMANDS = new Set([
  'add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'apply', 'am',
  'rebase', 'merge', 'push', 'rm', 'mv', 'clean', 'cherry-pick', 'revert', 'tag'
])

function isGitWrite(segment) {
  if (commandWord(segment) !== 'git') return false
  const sub = secondWord(segment)
  if (GIT_WRITE_SUBCOMMANDS.has(sub)) return true
  if (sub === 'branch') return hasToken(segment, '-d') || hasToken(segment, '-D')
  return false
}

const NODE_PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const NODE_PKG_WRITE_SUBCOMMANDS = new Set(['i', 'install', 'ci', 'add', 'remove', 'uninstall', 'link'])

function isPackageManagerWrite(segment) {
  const cw = commandWord(segment)
  const sub = secondWord(segment)
  if (NODE_PKG_MANAGERS.has(cw) && NODE_PKG_WRITE_SUBCOMMANDS.has(sub)) return true
  if ((cw === 'pip' || cw === 'pip3') && sub === 'install') return true
  if (cw === 'brew' && sub === 'install') return true
  if (cw === 'cargo' && sub === 'install') return true
  return false
}

const SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl'])
const INLINE_FLAG_RE = /(^|\s)(-c|-e)(\s|$)/

/** `python|python3|node|ruby|perl` 起头、用 `-c`/`-e` 内联跑一段脚本，脚本里含
 *  明显的写文件调用（`open(` 搭配 `'w'`、`writeFile`、`fs.write`）。
 *
 *  **只挡得住内联脚本**——写进外部 `.py`/`.js` 文件里再跑（`python3 foo.py`）
 *  这里看不到脚本内容，拦不住，文件头已经写明这是已知漏网。 */
function isInlineScriptWrite(segment) {
  if (!SCRIPT_INTERPRETERS.has(commandWord(segment))) return false
  if (!INLINE_FLAG_RE.test(segment)) return false
  const hasOpenWrite = segment.includes('open(') && segment.includes("'w'")
  return hasOpenWrite || segment.includes('writeFile') || segment.includes('fs.write')
}

/** 命令里是不是含写操作。**导出给测试用，也是 main() 判断要不要 deny 的唯一依据。** */
export function isWriteCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return false
  if (hasWriteRedirect(cmd)) return true
  return splitSegments(cmd).some((seg) => {
    if (!seg.trim()) return false
    if (hasToken(seg, 'tee')) return true
    if (IN_PLACE_EDIT_COMMANDS.has(commandWord(seg)) && hasInPlaceFlag(seg)) return true
    if (WRITE_COMMAND_WORDS.has(commandWord(seg))) return true
    if (isGitWrite(seg)) return true
    if (isPackageManagerWrite(seg)) return true
    if (isInlineScriptWrite(seg)) return true
    return false
  })
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    // 解析不出来就当没有——不是我们认识的形状，无声放行交还 Claude Code 正常流程。
    process.exitCode = 0
    return
  }

  if (payload?.tool_name === 'Bash' && isWriteCommand(payload?.tool_input?.command)) {
    process.stdout.write(
      hookResponseBody('deny', '这个角色不许改文件：命令里有写操作，已被 Eas-Term 拦下。只读的命令可以照常跑。')
    )
  }
  // 其余情况**无输出**——PreToolUse hook 的约定是「无输出 = 本 hook 无意见」，
  // 交还给 Claude Code 正常的权限流程，不阻塞也不拒绝。
  process.exitCode = 0
}

// 只有「作为脚本被直接运行」才跑主逻辑——被 import 时 `process.argv[1]` 是调用方
// （比如测试文件）自己的路径，不等于这份文件自己的 URL，下面这行恒为 false，
// 测试才 import 得到 `isWriteCommand` 而不会卡在读一个永远不会来的 stdin 上。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
