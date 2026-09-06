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
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hookResponseBody } from './responseBody.mjs'

// ── 按命令模式识别是否含写操作 ──────────────────────────────────────────
//
// 整体策略：先在**整条命令**上找有没有「非豁免的重定向」（`>` / `>>`，`shell` 层面的
// 重定向符不会被 `|`/`;`/`&&`/换行/单个 `&` 拆开，所以不需要先切段）；再把命令按
// `;`、`&&`、`||`、`|`、换行、单个 `&`（后台执行）切成若干段，逐段判断段首（或段内
// 任意 token，视规则而定）是不是写命令——这样 `ls && rm x` 里 `rm` 排在第二段也能
// 拦住，`ls | tee out` 里 `tee` 排在管道右边也一样。
//
// 这不是 shell 解析（没有引号配对、没有变量展开），是**够用的字符串模式匹配**——
// 命令词的判定一律用「切出来的整段 token 严格相等」而不是子串包含，天然带着词边界
// （`rmdir` 不会被 `rm` 误伤，`chmoda` 不会被 `chmod` 误伤）。

// ⚠️ 2026-09-06 评审 Critical：这条正则原来不切换行，`cd /tmp\nrm -rf x`、
// `ls\nmkdir foo` 整段被当成一段来判——段首是 `cd`/`ls`，第二条写命令排在换行
// 之后，`commandWord()` 只看得到第一段的第一个 token，于是整条被放行。Claude
// 的 Bash 调用日常就是多行脚本，这不是边角情形。**长的交替必须排在前面**
// （`\|\|` 在 `\|` 之前、`&&` 在 `&` 之前）——JS 正则的交替是「从左到右第一个
// 匹配上的」而不是「最长匹配优先」，顺序反了会把 `&&` 拆成两个孤立的 `&`。
const SHELL_OPERATOR_RE = /\|\||&&|\||;|[\n\r]|&/

/** 按 `;` `&&` `||` `|`、换行、单个 `&` 切分成若干段。**不处理引号内的这些字符**
 *  （那需要真正的 shell 解析），是本方案已知的粗糙之处。 */
function splitSegments(cmd) {
  return cmd.split(SHELL_OPERATOR_RE)
}

// ⚠️ 2026-09-06 评审 Important：包装词绕过。`sudo rm -rf x`、`env FOO=1 rm x`、
// `nohup rm x`、`xargs rm < list`、`(rm x)`、`bash -c "rm x"` 这些写法，段首 token
// 是包装词或括号而不是真正在跑的命令，原来的 commandWord()/secondWord() 只看
// 「第一个 token」，全部被放行。修法：先剥掉段首成对出现的这层包装，再取「真正
// 命令词」——`env` 后面还可能跟多个 `K=V` 形式的赋值（`env FOO=1 BAR=2 rm x`），
// 一并跳过。这不是穷举所有包装手法（比如 `nice -n 10 rm x` 里 `nice` 后面那个
// `-n 10` 参数没有特殊处理，会被误当成命令词），只处理简报点名的这几个。
const WRAPPER_WORDS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'xargs', 'nice'])
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

/** 把一段命令切成 token 数组，**去掉段首的 `(`**（`(rm x)` 这种子 shell 分组写法，
 *  `(` 会粘在第一个 token 前面，不剥掉的话 commandWord 会拿到 `(rm` 而不是 `rm`）。
 *  只处理开头这一层，不处理结尾的 `)`——那个粘在最后一个 token 上不影响判断。 */
function segmentTokens(segment) {
  return segment
    .trim()
    .replace(/^\(+/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/** 跳过包装词（以及 `env` 后面挂着的 `K=V` 赋值），找到「真正在跑的命令」在 token
 *  数组里的下标。没有包装词时下标就是 0，行为与改动前完全一致。 */
function realCommandIndex(tokens) {
  let i = 0
  while (i < tokens.length && WRAPPER_WORDS.has(tokens[i].toLowerCase())) {
    i++
    if (tokens[i - 1].toLowerCase() === 'env') {
      while (i < tokens.length && ENV_ASSIGNMENT_RE.test(tokens[i])) i++
    }
  }
  return i
}

/** 拨开包装词之后，第一个真正的命令词，去掉路径前缀、转小写——
 *  `/usr/bin/rm` 与 `rm` 同等对待，`sudo rm` 与 `rm` 同等对待。 */
function commandWord(segment) {
  const tokens = segmentTokens(segment)
  const raw = tokens[realCommandIndex(tokens)]
  if (!raw) return ''
  const base = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  return base.toLowerCase()
}

/** 真正命令词后面那个 token（子命令位，如 `git commit` 的 `commit`）——
 *  同样拨开包装词，`sudo git commit` 也能正确取到 `commit`。 */
function secondWord(segment) {
  const tokens = segmentTokens(segment)
  const i = realCommandIndex(tokens)
  return (tokens[i + 1] ?? '').toLowerCase()
}

/** 这一段里有没有严格等于 `token` 的独立词。 */
function hasToken(segment, token) {
  return segment
    .trim()
    .split(/\s+/)
    .some((p) => p === token)
}

/** 去掉命令里成对引号包起来的内容，避免引号内的 `>` 被误判成重定向
 *  （`grep -c ">" f`、`awk '$1 > 5'` 这两条都在引号里放了个跟重定向无关的 `>`）。
 *  2026-09-06 评审 Minor：不处理引号转义（`\"`）或引号不成对的畸形输入——那已经
 *  超出「够用的字符串匹配」要处理的范围，真遇到就是已知漏网，不为了这个引入
 *  真正的 shell 词法分析器。 */
function stripQuoted(cmd) {
  return cmd.replace(/"[^"]*"|'[^']*'/g, '')
}

/** 重定向：`>` / `>>`，但 `> /dev/null`、`2>&1`、`2>/dev/null` 这类不改文件内容的
 *  不算。逐个找完整条命令里所有 `>`/`>>`，只要有一处目标不是这几种豁免形态就判写。
 *
 *  正则里 `(\d*)` 吃掉紧贴在 `>` 前面的 fd 号（`2>`），`\s*` 允许 `>` 和目标之间有空格
 *  （`> /dev/null` 与 `>/dev/null` 都要认得），目标本身用 `&\d+`（`&1` 这种拷贝到另一个
 *  fd）或者「一串非空白/非 `&|;` 字符」两选一去匹配。**先剥掉引号内的内容再扫**——
 *  见 stripQuoted。 */
function hasWriteRedirect(cmd) {
  const scrubbed = stripQuoted(cmd)
  const re = /\d*(>{1,2})\s*(&\d+|[^\s&|;]*)/g
  let m
  while ((m = re.exec(scrubbed))) {
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

// `sh`/`bash`/`zsh` 2026-09-06 评审 Important 时加入：`bash -c "rm x"` 这类壳层
// 包一层再跑，原来的清单里没有这三个，`commandWord` 是 `bash`，不落在
// WRITE_COMMAND_WORDS/GIT/包管理器任何一类里，整条被放行。
const SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'sh', 'bash', 'zsh'])
const SHELL_WRAPPER_INTERPRETERS = new Set(['sh', 'bash', 'zsh'])
const INLINE_FLAG_RE = /(^|\s)(-c|-e)(\s|$)/
const DASH_C_RE = /(^|\s)-c(\s|$)/

/** 取 `-c` 后面那一段参数文本，剥掉最外层包一整圈的引号（不做真正的 shell 引号
 *  语法解析，只处理「整段被一对引号包住」这种最常见的形态）。取不到就返回空串。 */
function extractDashCArg(segment) {
  const m = segment.match(/(^|\s)-c\s+(.+)$/)
  if (!m) return ''
  let arg = m[2].trim()
  if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
    arg = arg.slice(1, -1)
  }
  return arg
}

/** `python|python3|node|ruby|perl` 用 `-c`/`-e` 内联跑一段脚本、含明显的写文件调用
 *  （`open(` 搭配 `'w'`、`writeFile`、`fs.write`）；`sh|bash|zsh -c "..."` 则不按
 *  脚本语言的写法猜，直接把 `-c` 后面那段文本当一条新命令**递归**丢回
 *  `isWriteCommand`——`bash -c "rm x"` 里真正要判断的就是 `rm x` 这条命令本身，
 *  跟外层 sed/python 那套子串匹配是两回事，判据也更准。
 *
 *  **只挡得住内联脚本**——写进外部 `.py`/`.sh`/`.js` 文件里再跑（`python3 foo.py`、
 *  `bash foo.sh`）这里看不到脚本内容，拦不住，文件头已经写明这是已知漏网。 */
function isInlineScriptWrite(segment) {
  const cw = commandWord(segment)
  if (!SCRIPT_INTERPRETERS.has(cw)) return false
  if (SHELL_WRAPPER_INTERPRETERS.has(cw)) {
    if (!DASH_C_RE.test(segment)) return false
    const inner = extractDashCArg(segment)
    return inner ? isWriteCommand(inner) : false
  }
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
  // 显式设编码：默认是 Buffer chunk，多字节字符（中文 deny 理由、命令里的中文路径……）
  // 可能被切在字符中间的字节边界上，跨 chunk 拼接后单个 chunk 是合法 UTF-8 但整条
  // 拼出来的 raw 在切点上就是半个字符——JSON.parse 大概率直接失败。设成 'utf8' 之后
  // Node 会在内部缓冲不完整的多字节序列、等下一个 chunk 补齐了再产出字符串，
  // 不会把半个字符递给我们（2026-09-06 评审 Minor）。
  process.stdin.setEncoding('utf8')
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    // 解析不出来就当没有——不是我们认识的形状，无声放行交还 Claude Code 正常流程。
    //
    // **这里 fail-open，`eas-pretooluse.mjs` 解析失败 fail-closed（deny）——两边故意
    // 反着来**：那份审批 hook 拒绝的代价，是让「已经确认过是 agent-chat 会话」的这次
    // 工具调用等不到人、按超时收场，用户自己在这台机器上的其它会话不受影响（那道闸
    // 一开始就先判过 EAS_AGENT_CHAT_SESSION，不是这个会话直接放行）。而这份写守卫是
    // 用 `--settings` **按进程附加**的（见 session.ts ensureWriteGuardSettings 文件头）：
    // 只有这一次 Claude 进程认它，解析失败时放行，代价仅限于「这次调用没拦上」，
    // 不会波及用户自己敲的、没有走 --settings 的任何别的 Claude 会话——两边的
    // fail 方向都是「代价最小的那一侧」，不是随意选的。
    process.exitCode = 0
    return
  }

  if (payload?.tool_name === 'Bash' && isWriteCommand(payload?.tool_input?.command)) {
    process.stdout.write(
      hookResponseBody('deny', '这个角色不许改文件：命令里看起来有写操作，已被 Eas-Term 拦下。只读的命令可以照常跑。')
    )
  }
  // 其余情况**无输出**——PreToolUse hook 的约定是「无输出 = 本 hook 无意见」，
  // 交还给 Claude Code 正常的权限流程，不阻塞也不拒绝。
  process.exitCode = 0
}

// 只有「作为脚本被直接运行」才跑主逻辑——被 import 时 `process.argv[1]` 是调用方
// （比如测试文件）自己的路径，不等于这份文件自己的 URL，下面这行恒为 false，
// 测试才 import 得到 `isWriteCommand` 而不会卡在读一个永远不会来的 stdin 上。
//
// ⚠️ 2026-09-06 评审 Important：直接比较 `process.argv[1] === fileURLToPath(...)`
// 在经软链调用时不成立——软链路径与真实文件路径是两个不同的字符串，即便指向
// 同一份文件，严格相等也会判假，导致守卫被「作为脚本运行」却走进 import 分支、
// 静默不跑 main()、hook 空转（比无输出更隐蔽：不会报错，只是永远不 deny）。
// 改成两边都 `fs.realpathSync` 解析成真实路径再比——取不到（文件被删、权限问题）
// 时按「直接运行」处理：宁可多跑一次主逻辑（读 stdin、可能多余的一次 deny 判断），
// 也不要因为解析失败让守卫整个失效。
function isRunAsScript() {
  const scriptPath = fileURLToPath(import.meta.url)
  const argvPath = process.argv[1] ?? ''
  try {
    return fs.realpathSync(scriptPath) === fs.realpathSync(argvPath)
  } catch {
    return true
  }
}

if (isRunAsScript()) {
  await main()
}
