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
// shell 解析（不追变量展开、不追函数/别名、不追 `source` 进别的脚本）。
//
// **已知漏网清单**（如实记录，不是遗漏；与 `docs/architecture/03-agent角色边界.md`、
// spec 十四·附四**逐字同口径**，改一处要三处一起改）：
//   · 写操作藏在**外部脚本文件**里（`bash foo.sh`、`python3 script.py`）——这里只看得到
//     调用它的那一行命令，看不到脚本内容；
//   · `cat <<EOF > file` 这类 heredoc 之外的花样组合，或者用变量拼出来的重定向目标；
//   · **heredoc 喂解释器 stdin**（`python3 - <<EOF`）——要写的内容在后面几行里，
//     命令行这一行看不出写意图；
//   · 任何用引号/转义把写意图藏起来、让字符串匹配失焦的命令；
//   · **引号里的 awk/perl 重定向**（`awk '{print > "out"}' f`）——判重定向前先剥掉成对
//     引号里的内容（为的是不误拦 `grep -c ">" f`），真的重定向被一起剥掉了；
//   · **间接/远端执行**：`ssh host rm x`、`docker run … rm`、`osascript`、`defaults write`
//     ——真正落盘的不是本机这一条命令，命令词是 ssh/docker/osascript；
//   · **`apt-get install` / `npx create-*`**：装包与脚手架会落一堆文件，不在
//     `npm|pnpm|yarn|bun|pip|brew|cargo` 那份安装子命令清单里；
//   · `rmdir`、`git branch <name>`（创建/列出分支，不含 `-d`/`-D`）等不在简报列出的写
//     命令词清单里，按简报字面执行，不额外扩大匹配范围；
//   · `sh|bash|zsh -c "…"` / `eval "…"` 的递归判断只剥一层「整段被一对引号包住」的最外层
//     引号，嵌套引号或转义（`bash -c "echo \"x\" > f"`）按字面切，取出来的可能不是原本
//     想递归判断的那条命令；
//   · 包装词的选项表（`WRAPPER_OPTS_WITH_ARG`）只列到常用的那几个，遇到没列进去的
//     「吃一个独立参数」的冷门选项会在参数上停错位置，那一条仍会放行；
//   · **hook 起不来 = 静默放行**：node 兜底路径找不到可执行文件、脚本自己抛异常、
//     Windows 上的兜底路径——Claude Code 的 PreToolUse hook 只有明确输出 deny 才拦，
//     跑不起来 / 报错 / 没输出一律当「本 hook 无意见」放行，且没有任何用户可见的信号
//     （**Windows 未实测**）。
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

// ⚠️ 2026-09-06 评审 Critical：分段逻辑原来是一条正则（`/\|\||&&|\||;|[\n\r]|&/`）直接
// `cmd.split()`，而且不切换行——`cd /tmp\nrm -rf x`、`ls\nmkdir foo` 整段被当成一段来判，
// 段首是 `cd`/`ls`，第二条写命令排在换行之后，`commandWord()` 只看得到第一段的第一个
// token，于是整条被放行。Claude 的 Bash 调用日常就是多行脚本，这不是边角情形。那次的
// 修法是往正则里补换行与单个 `&`，并留下一条纪律：**长的交替必须排在前面**（`\|\|` 在
// `\|` 之前、`&&` 在 `&` 之前）——JS 正则的交替是「从左到右第一个匹配上的」而不是
// 「最长匹配优先」，顺序反了会把 `&&` 拆成两个孤立的 `&`。
//
// ⚠️ 2026-09-06 最终评审 Critical 2：那条正则**不认引号**，两头都错：
//   · `bash -c "rm x; ls"`、`bash -c "rm x && ls"` 被从引号中间劈开，`-c` 后面只剩半截
//     `"rm x`，`extractDashCArg` 取到的不是一条完整命令、递归判断失焦——**两条都放行**
//     （台账里写「`&&` 形式被抓住」是错的，复审实测两条都放行）；
//   · 反过来，`echo "a;rm b"`、`grep -E "x|rm x" f` 里**引号内**的 `;`/`|` 被当成分隔符，
//     切出一段假的 `rm b`/`rm x`，只读命令被误拦。
// 改成引号感知的扫描器：跟踪 `'`/`"` 状态，只在引号外切。上面那条「长的交替排在前面」
// 的纪律仍在，只是换了形状——碰到 `|`/`&` 先看下一个字符是不是同一个，是就一起吃掉，
// 否则 `&&` 会被切成两个分隔符、中间夹一段空的。这仍不是 shell 解析（不认转义 `\"`、
// 不认引号不成对的畸形输入），但「引号内外」这一层分清楚了，上面两类错一起消失。

/** 按 `;` `&&` `||` `|`、换行、单个 `&` 切分成若干段。**引号内的这些字符不切。** */
function splitSegments(cmd) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) {
      if (ch === quote) quote = null
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '|' || ch === ';' || ch === '&' || ch === '\n' || ch === '\r') {
      // `||` / `&&` 是**一个**分隔符不是两个：多吃一个字符，否则中间会切出一段空的
      if ((ch === '|' && cmd[i + 1] === '|') || (ch === '&' && cmd[i + 1] === '&')) i++
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

// ⚠️ 2026-09-06 评审 Important：包装词绕过。`sudo rm -rf x`、`env FOO=1 rm x`、
// `nohup rm x`、`xargs rm < list`、`(rm x)`、`bash -c "rm x"` 这些写法，段首 token
// 是包装词或括号而不是真正在跑的命令，原来的 commandWord()/secondWord() 只看
// 「第一个 token」，全部被放行。修法：先剥掉段首成对出现的这层包装，再取「真正
// 命令词」——`env` 后面还可能跟多个 `K=V` 形式的赋值（`env FOO=1 BAR=2 rm x`），
// 一并跳过。
//
// ⚠️ 2026-09-06 最终评审 Critical 1：上一轮只跳「包装词这个词本身」，**不处理它自己
// 带的选项**——`sudo -u x rm y`、`nice -n 10 rm x`、`env -i rm x`、`time -p rm x`、
// `xargs -0 rm < list`、`xargs -n 1 rm`、`timeout 5 rm x` 全部放行（选项被误当成
// 「真正的命令词」，它不在任何写命令清单里，整条就过了）。这不是边角写法，`sudo -u`
// 和 `timeout` 在真实脚本里天天出现。修法见 realCommandIndex：吃掉包装词之后先跳
// `-` 开头的选项，其中「吃一个独立参数」的那些再多跳一个 token；认 `--`（显式的
// 选项终止符）；`timeout` 的时长是个不带 `-` 的位置参数，单独跳；外层是 while 而不是
// if，允许连着套好几层（`sudo -u x env FOO=1 rm y`）。`timeout` 这次一并进包装词表。
const WRAPPER_WORDS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'xargs', 'nice', 'timeout'])
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

/** 各包装词里「后面还要跟一个独立参数」的选项。**只有这些要多跳一个 token**——
 *  其余 `-` 开头的选项都是纯开关，跳它自己就够。写不全不会漏判成「没有包装词」，
 *  只会在那个具体选项上停错位置，所以这里按简报点名 + 各命令最常用的那几个来，
 *  不追求穷举 man page（`--opt=value` 这种带等号的形态本来就不占第二个 token）。 */
const WRAPPER_OPTS_WITH_ARG = {
  sudo: new Set(['-u', '-g', '-p', '-C', '-h', '-r', '-t', '-U']),
  // `command -v rm` / `command -V rm` 是「这个命令存不存在」的标准问法，**不跑** rm。
  // 把 `-v`/`-V` 算成「吃一个参数」，下标就会越过 `rm` 落到空位上——不这么写的话，
  // 这次给包装词补选项跳过反而会把这条只读的探测命令误拦（改动前它是靠「`-v` 被当成
  // 命令词、不在写清单里」歪打正着放行的）。
  command: new Set(['-v', '-V']),
  nice: new Set(['-n']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S']),
  xargs: new Set(['-n', '-P', '-I', '-i', '-d', '-E', '-L', '-s', '-a']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after'])
}
const NO_OPTS = new Set()

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

/** 跳过包装词（连同它自己的选项、`env` 挂的 `K=V`、`timeout` 的时长），找到「真正在
 *  跑的命令」在 token 数组里的下标。没有包装词时下标就是 0，行为与改动前完全一致。 */
function realCommandIndex(tokens) {
  let i = 0
  while (i < tokens.length) {
    // 2026-09-06 最终评审 Important 1：段首**裸**的 `K=V`（`VAR=1 rm x`）——shell 把它当
    // 「给这条命令临时加个环境变量」，真正在跑的仍是后面那个词。不跳过的话 commandWord
    // 拿到的是 `VAR=1`，整条放行。放在循环开头，`sudo FOO=1 rm x` 这种混着来的也兜得住。
    while (i < tokens.length && ENV_ASSIGNMENT_RE.test(tokens[i])) i++
    if (i >= tokens.length) break
    const w = tokens[i].toLowerCase()
    if (!WRAPPER_WORDS.has(w)) break
    i++
    const argOpts = WRAPPER_OPTS_WITH_ARG[w] ?? NO_OPTS
    while (i < tokens.length && tokens[i].startsWith('-') && tokens[i] !== '--') {
      const opt = tokens[i]
      i++
      if (argOpts.has(opt) && i < tokens.length) i++
    }
    // `--`：显式的「选项到此为止」，它后面第一个词就是命令（`sudo -- rm x`）
    if (i < tokens.length && tokens[i] === '--') i++
    // `env FOO=1 BAR=2 rm x`：env 后面可以挂任意多个赋值（循环开头那段也兜得住，
    // 留在这里是让 env 这条路径自己读得通）
    if (w === 'env') {
      while (i < tokens.length && ENV_ASSIGNMENT_RE.test(tokens[i])) i++
    }
    // `timeout 5 rm x` / `timeout 1.5m rm x`：时长是个不带 `-` 的位置参数，跳掉它
    if (w === 'timeout') {
      while (i < tokens.length && /^[0-9]/.test(tokens[i])) i++
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

/** 真正命令词后面的全部 token（参数位）。判「某个选项在不在」时用它而不是整段
 *  split——包装词自己的选项（`sudo -u x rm y` 里的 `-u`）不该被算成 rm 的参数。 */
function commandArgs(segment) {
  const tokens = segmentTokens(segment)
  return tokens.slice(realCommandIndex(tokens) + 1)
}

/** 这一段里有没有严格等于 `token` 的独立词。 */
function hasToken(segment, token) {
  return segment
    .trim()
    .split(/\s+/)
    .some((p) => p === token)
}

/** `-xzf` 这种把多个单字母短选项挤成一簇的 token 里含不含某个字母。只认「单个 `-`
 *  开头 + 纯字母数字」的形状——`--in-place` 这类长选项、`-i.bak` 这类带后缀的，
 *  各自单独判，不走这里（否则 `--include` 里的 `i` 会被当成 `sed -i`）。 */
function hasShortFlagLetter(token, letters) {
  if (!/^-[A-Za-z0-9]+$/.test(token)) return false
  return [...token.slice(1)].some((c) => letters.includes(c))
}

/** 剥掉「整段被一对引号包住」的最外层引号。不做真正的 shell 引号语法解析——
 *  嵌套引号、转义引号按字面留着，是已知漏网（见文件头）。 */
function stripOuterQuotes(s) {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/** 去掉命令里成对引号包起来的内容，避免引号内的 `>` 被误判成重定向
 *  （`grep -c ">" f`、`awk '$1 > 5'` 这两条都在引号里放了个跟重定向无关的 `>`）。
 *  2026-09-06 评审 Minor：不处理引号转义（`\"`）或引号不成对的畸形输入——那已经
 *  超出「够用的字符串匹配」要处理的范围，真遇到就是已知漏网，不为了这个引入
 *  真正的 shell 词法分析器。**反方向也是已知漏网**：引号里真有重定向的
 *  （`awk '{print > "out"}' f`）会跟着一起被抹掉，判不出来——见文件头漏网清单。 */
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

/** `sed -i` / `perl -i`（含 `-i.bak` 这种把备份后缀粘在同一个 token 上的写法）。
 *  2026-09-06 最终评审 Minor 3 补：`sed --in-place`（含 `--in-place=.bak`）与
 *  `perl -pi -e`（`i` 挤在短选项簇里）也是原地改文件的常规写法，一起认。
 *  调用点已经先判过命令词是 sed/perl，所以这里认 `i` 不会误伤别人的 `-i`。 */
function hasInPlaceFlag(segment) {
  return commandArgs(segment).some(
    (p) => p === '-i' || p.startsWith('-i.') || p.startsWith('--in-place') || hasShortFlagLetter(p, 'i')
  )
}

const IN_PLACE_EDIT_COMMANDS = new Set(['sed', 'perl'])

/** 直接改文件/目录的命令词——不含 shell 内建的重定向，这些本身就是"改"。
 *  `tee` 2026-09-06 最终评审 Minor 1 从「整段里出现过这个词」挪到这里：原来用
 *  `hasToken(seg,'tee')` 判，`grep tee src`、`man tee`、`which tee` 这类只是**提到**
 *  tee 的只读命令全被误拦；放进命令词清单后，`ls | tee out` 照样拦得住（分段之后
 *  `tee` 就是第二段的命令词），误拦一起消失。 */
const WRITE_COMMAND_WORDS = new Set([
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'truncate', 'dd', 'install', 'rsync', 'tee'
])

/** git 的写子命令。`branch` 单独处理——只有带 `-d`/`-D`（删分支）才算写，
 *  单纯 `git branch` 或 `git branch <name>`（列出/创建）不在这份简报要拦的范围内。
 *  2026-09-06 最终评审 Important 2 补：`clone`/`pull`/`init`/`worktree`/`config`/
 *  `submodule`/`lfs`/`update-index`/`gc`/`fetch` ——前几个明摆着往工作区落文件，
 *  `config`/`update-index`/`gc`/`fetch` 写的是 `.git` 里的东西，**也是改文件**
 *  （`git fetch` 会写 `.git/objects` 与远端引用）。`log`/`status`/`diff`/`show`
 *  这些纯读的仍然放行。 */
const GIT_WRITE_SUBCOMMANDS = new Set([
  'add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'apply', 'am',
  'rebase', 'merge', 'push', 'rm', 'mv', 'clean', 'cherry-pick', 'revert', 'tag',
  'clone', 'pull', 'init', 'worktree', 'config', 'submodule', 'lfs', 'update-index', 'gc', 'fetch'
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

/** `find` 的写动作（2026-09-06 最终评审 Important 4）：`-delete` 直接删，`-exec`/
 *  `-execdir`/`-ok` 是拿匹配到的文件去跑另一条命令——那条命令这里看不见（它被
 *  拆成 `{}` `\;` 这些碎片），所以不猜它是什么，**只要出现这几个动作就算写**。
 *  `find . -name x` 这类纯查询照旧放行。 */
const FIND_WRITE_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok'])

function isFindWrite(segment) {
  if (commandWord(segment) !== 'find') return false
  return commandArgs(segment).some((t) => FIND_WRITE_ACTIONS.has(t))
}

/** 会把东西落成文件的网络/归档命令（2026-09-06 最终评审 Important 3）。这类命令
 *  的命令词本身不在 WRITE_COMMAND_WORDS 里（`curl url` 只是打印到 stdout），
 *  要看选项才知道它会不会写盘：
 *  - `curl`：带 `-o`/`-O`/`--output`/`--remote-name`（含挤在簇里的 `o`/`O`，
 *    `curl -sLo f url` 是常见写法）才算写；不带就是打印，放行；
 *  - `wget`：**默认就是存文件**，反过来判——只有显式让它吐到 stdout（`-O -`、
 *    `-qO-`）才放行；
 *  - `tar`：带 `-x`/`--extract`（含 `-xf`/`-xzf` 这类簇）才算写；tar 的经典写法还
 *    可以整个不带 `-`（`tar xzf a.tgz`），所以紧跟其后的第一个裸 token 也当簇看一次；
 *  - `unzip`/`zip`/`gunzip`/`bsdtar`：按简报口径整个算写，不再看选项——代价是
 *    `unzip -l`、`bsdtar -tf` 这类只列内容的也会被拦，这是**故意往严的一侧偏**
 *    （守卫的错判成本：误拦是用户改条命令，漏拦是文件真被改了）。 */
const ARCHIVE_WRITE_COMMANDS = new Set(['unzip', 'zip', 'gunzip', 'bsdtar'])
const CURL_OUTPUT_OPTS = new Set(['-o', '-O', '--output', '--remote-name'])

function isDownloadOrExtractWrite(segment) {
  const cw = commandWord(segment)
  if (cw !== 'curl' && cw !== 'wget' && cw !== 'tar' && !ARCHIVE_WRITE_COMMANDS.has(cw)) return false
  const args = commandArgs(segment)
  if (cw === 'curl') {
    return args.some((t) => CURL_OUTPUT_OPTS.has(t) || t.startsWith('--output=') || hasShortFlagLetter(t, 'oO'))
  }
  if (cw === 'wget') {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-O' && args[i + 1] === '-') return false
      if (/^-[A-Za-z]*O-$/.test(args[i])) return false
    }
    return true
  }
  if (cw === 'tar') {
    if (args.some((t) => t === '--extract' || hasShortFlagLetter(t, 'x'))) return true
    return !!args[0] && /^[A-Za-z0-9]+$/.test(args[0]) && args[0].includes('x')
  }
  return true
}

// `sh`/`bash`/`zsh` 2026-09-06 评审 Important 时加入：`bash -c "rm x"` 这类壳层
// 包一层再跑，原来的清单里没有这三个，`commandWord` 是 `bash`，不落在
// WRITE_COMMAND_WORDS/GIT/包管理器任何一类里，整条被放行。
const SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'sh', 'bash', 'zsh'])
const SHELL_WRAPPER_INTERPRETERS = new Set(['sh', 'bash', 'zsh'])
const INLINE_FLAG_RE = /(^|\s)(-c|-e)(\s|$)/
// 2026-09-06 最终评审 Important 5：`-c` 常常挤在短选项簇的末尾（`bash -lc "…"`、
// `sh -lc "…"`——登录 shell 跑一条命令的标准写法），只认光秃秃的 `-c` 会整条放行。
// `c` 必须在簇的**末尾**：它后面跟的是命令字符串，不可能再有别的字母。
const DASH_C_RE = /(^|\s)-[A-Za-z]*c(\s|$)/

/** 取 `-c`（或 `-lc` 这类簇）后面那一段参数文本，剥掉最外层包一整圈的引号
 *  （不做真正的 shell 引号语法解析）。取不到就返回空串。 */
function extractDashCArg(segment) {
  const m = segment.match(/(^|\s)-[A-Za-z]*c\s+(.+)$/)
  if (!m) return ''
  return stripOuterQuotes(m[2])
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

/** `eval "rm x"`（2026-09-06 最终评审 Important 5）：eval 把后面那段字符串当一条新
 *  命令跑，判据跟 `bash -c "…"` 完全一样——取出后面那段、剥掉最外层引号，**递归**
 *  丢回 `isWriteCommand`。递归一定收敛：每层都至少吃掉 `eval` 这个 token，字符串
 *  严格变短。 */
function isEvalWrite(segment) {
  if (commandWord(segment) !== 'eval') return false
  const rest = commandArgs(segment).join(' ').trim()
  return rest ? isWriteCommand(stripOuterQuotes(rest)) : false
}

/** 命令里是不是含写操作。**导出给测试用，也是 main() 判断要不要 deny 的唯一依据。** */
export function isWriteCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return false
  if (hasWriteRedirect(cmd)) return true
  return splitSegments(cmd).some((seg) => {
    if (!seg.trim()) return false
    if (IN_PLACE_EDIT_COMMANDS.has(commandWord(seg)) && hasInPlaceFlag(seg)) return true
    if (WRITE_COMMAND_WORDS.has(commandWord(seg))) return true
    if (isGitWrite(seg)) return true
    if (isPackageManagerWrite(seg)) return true
    if (isFindWrite(seg)) return true
    if (isDownloadOrExtractWrite(seg)) return true
    if (isInlineScriptWrite(seg)) return true
    if (isEvalWrite(seg)) return true
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
