#!/usr/bin/env node
/**
 * 图纸守门 —— Claude Code PreToolUse 钩子脚本
 *
 * 职责：agent 要跑 `git commit` 时，检查这次改动是不是碰了「图纸描述的那些事实」，
 *       碰了却没一起改 `docs/architecture/` 就**挡下来**（exit 2），
 *       并指名道姓说该更新哪一份、为什么。
 *
 * 为什么要它：CLAUDE.md 早就写着「改了代码要顺手更新对应图纸，同一个 commit 提交」，
 *       但那是一句自律。图纸脱节不会报错、不会红、没人当场发现 ——
 *       只会在半年后让某个 agent 照着错图纸动手（`docs/architecture/03` 3B 节
 *       整节都在收拾这类事故）。所以把这句自律变成一道会拦人的闸。
 *
 * **零 token、零网络、纯本地字符串活**，和 scan-commit.mjs 一样。
 * 除了「明确判定该改图纸」这一种情况，任何异常都 exit 0 放行 ——
 * 守门坏了不该把人锁在门外。
 *
 * 逃生门：commit message 里写 `[skip-arch]`。真的不需要动图纸时用它，
 *       但**它会留在 git log 里**，事后能查谁跳过了、跳过了什么。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARCH_DIR = join(ROOT, 'docs', 'architecture')

/** 图纸里提到、但盘上确实没有的路径。**都不是脱节**，逐条写明理由 ——
 *  没有理由的豁免会慢慢把这道检查掏空。 */
const KNOWN_ABSENT = new Map([
  ['docs/prototype/', '03 里描述 prototyper 角色「要写」的目录，用到时才建'],
  ['build/Release', '14 里正在讲「这份安装里根本没有这个目录」这个坑，它不存在才是对的']
])

const git = (args) => {
  try {
    // **`core.quotePath=false` 不是可选项。** git 默认把非 ASCII 路径转义成
    // `"docs/architecture/03-agent\350\247\222…"` —— 带引号、带八进制。
    // 而这个仓库的图纸文件名全是中文，于是下面那句 `startsWith('docs/architecture/')`
    // 永远为假 —— 闸门**永远拦、图纸改了也放不行**，等于彻底不可用。
    // 2026-09-01 写完当场被自己的测试抓到（测试 3 本该放行却仍被拦）。
    return execFileSync('git', ['-C', ROOT, '-c', 'core.quotePath=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024
    })
  } catch {
    return ''
  }
}

/**
 * 高信号规则：命中就说明「图纸上写着的某个事实」变了。
 *
 * **宁可少报也不能烦人** —— 一道天天误拦的闸活不过一周，
 * 第一次被无端拦住的人就会去把它关掉。所以这里只放
 * 「变了几乎必然要动图纸」的那几条，改注释、改样式、加测试一律不碰。
 */
const RULES = [
  {
    id: 'ipc-register',
    test: ({ diffOf }) => /^\+.*register\w*Handlers\s*\(/m.test(diffOf('src/main/index.ts')),
    say: '新增了 register*Handlers() 调用',
    doc: '02-分层架构.md 的「启动顺序硬依赖」 + 10-模块领地图.md 的主进程表'
  },
  {
    id: 'mcp-tool',
    test: ({ diffOf }) => /^\+\s*name:\s*['"]/m.test(diffOf('mcp/eas-mcp.mjs')),
    say: 'mcp/eas-mcp.mjs 里新增了工具定义',
    doc: '11-MCP工具网络.md 的工具清单（13-所有权矩阵.md 的同步清单也点名了这条）'
  },
  {
    id: 'preload-api',
    test: ({ diffOf }) => /^\+\s{2}\w+:\s*\{/m.test(diffOf('src/preload/index.ts')),
    say: 'preload 暴露了新的 API 分组（等于开了新的 IPC 面）',
    doc: '13-所有权矩阵.md 的「新增 IPC 写通道」那条（边界怎么划写在那里）'
  },
  {
    id: 'new-module',
    test: ({ added, deleted }) => [...added, ...deleted].some(isModuleFile),
    say: (s) => {
      const hit = [...s.added, ...s.deleted].filter(isModuleFile).slice(0, 6)
      return `新增/删除了源码模块：${hit.join('、')}`
    },
    doc: '10-模块领地图.md 的领地明细表（新目录还要进那张 mermaid 图）'
  }
]

/**
 * 这条 Bash 命令是不是**真的在跑提交**。
 *
 * **判据必须是「命令位置」，不能是「文本里出现过」** —— 后者会把任何
 * *提到* 提交的命令一起拦下：grep 日志、echo 一段 JSON、写文档。
 * 写完当场就撞上了：测试用的 `echo '{"command":"git com…"}' | node …`
 * 被自己拦住，而那条命令根本没在提交。
 * 所以要求它前面是行首或命令分隔符（`&&` `||` `;` `|` 换行）。
 *
 * 结尾用 `(?![\w-])` 而不是 `\b`：`\b` 在 `git commit-graph` 的 `commit` 后面
 * 也成立（`-` 是非单词字符），于是 `git commit-graph verify` 被当成提交拦下。
 */
export function isCommitCommand(cmd) {
  return /(^|&&|\|\||;|\||\n)\s*(sudo\s+)?git\s+(-C\s+(?:"[^"]*"|\S+)\s+)?commit(?![\w-])/.test(
    String(cmd ?? '')
  )
}

/** 算「模块」的文件：源码树里的非测试文件。测试、样式、类型声明不算。 */
export function isModuleFile(f) {
  if (!/^(src|mcp|scripts|resources\/agent-hooks|hooks)\//.test(f)) return false
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) return false
  if (/\.(css|scss|json|md|d\.ts)$/.test(f)) return false
  return /\.[cm]?[jt]sx?$/.test(f)
}

/** 图纸里指着的路径还在不在。脱节最常见的形式就是文件改了名，图纸还指着旧的。 */
function staleRefs() {
  const out = []
  let files
  try {
    files = readdirSync(ARCH_DIR).filter((f) => f.endsWith('.md'))
  } catch {
    return out
  }
  const seen = new Set()
  for (const f of files) {
    let text
    try {
      text = readFileSync(join(ARCH_DIR, f), 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const p = m[1].trim()
      // 只认「看着像仓库内路径」的：有前缀、没通配符、没占位尖括号、没空格
      if (!/^(src|mcp|scripts|resources|hooks|deploy|site|build|docs|\.github)\//.test(p)) continue
      if (/[*<>| ]/.test(p)) continue
      if (KNOWN_ABSENT.has(p)) continue
      const key = `${f}|${p}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!existsSync(join(ROOT, p.replace(/\/$/, '')))) out.push({ doc: f, path: p })
    }
  }
  return out
}

function main() {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return 0
  }
  if (payload.tool_name !== 'Bash') return 0
  const cmd = String(payload.tool_input?.command ?? '')
  if (!isCommitCommand(cmd)) return 0
  if (cmd.includes('[skip-arch]')) return 0

  const status = git(['diff', '--cached', '--name-status'])
  if (!status.trim()) return 0 // 没有暂存内容（可能是 --amend 或空提交），不掺和

  const added = []
  const deleted = []
  const all = []
  for (const line of status.split('\n')) {
    const [st, ...rest] = line.split('\t')
    // 路径里有空格时 git 照样会加引号（quotePath 只管非 ASCII），去掉外层引号
    const f = rest[rest.length - 1]?.replace(/^"(.*)"$/, '$1')
    if (!st || !f) continue
    all.push(f)
    if (st.startsWith('A')) added.push(f)
    if (st.startsWith('D')) deleted.push(f)
  }

  const archTouched = all.some((f) => f.startsWith('docs/architecture/'))
  const diffCache = new Map()
  const diffOf = (f) => {
    if (!all.includes(f)) return ''
    if (!diffCache.has(f)) diffCache.set(f, git(['diff', '--cached', '--', f]))
    return diffCache.get(f)
  }

  const state = { added, deleted, all, diffOf }
  const hits = RULES.filter((r) => {
    try {
      return r.test(state)
    } catch {
      return false
    }
  })
  const stale = staleRefs()

  // 图纸已经一起改了 → 放行。**不去判断「改得对不对」** ——
  // 那是人的判断，闸门只负责保证「有人想过这件事」。
  if (archTouched || hits.length === 0) {
    if (stale.length) {
      // 不阻塞，只把事实递给模型：这是既有债，不该由一次无关提交来还
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext:
              '图纸里有失效的路径引用（不阻塞本次提交，顺手修掉更好）：\n' +
              stale.map((s) => `  · ${s.doc} 指着 ${s.path}，盘上没有`).join('\n')
          }
        })
      )
    }
    return 0
  }

  const lines = hits.map((r) => {
    const say = typeof r.say === 'function' ? r.say(state) : r.say
    return `  · ${say}\n    → 该更新：${r.doc}`
  })
  process.stderr.write(
    '【图纸守门】这次提交动了图纸描述的事实，但 docs/architecture/ 一个字没改：\n\n' +
      lines.join('\n') +
      '\n\n先更新对应图纸并一起 git add（CLAUDE.md：「改了代码要顺手更新对应图纸，同一个 commit 提交」）。\n' +
      '确实不需要动图纸的话，在 commit message 里写 [skip-arch] —— 它会留在 git log 里，事后查得到。\n' +
      (stale.length
        ? '\n另外，图纸里这些路径已经指不到东西了：\n' +
          stale.map((s) => `  · ${s.doc} → ${s.path}`).join('\n') +
          '\n'
        : '')
  )
  return 2
}

// 被 import 时（测试）只取上面那些纯函数，不跑主流程
if (import.meta.main) {
  let code = 0
  try {
    code = main()
  } catch {
    code = 0 // 守门自己坏了，不能把人锁在门外
  }
  process.exit(code)
}
