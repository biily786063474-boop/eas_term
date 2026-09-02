#!/usr/bin/env node
// 打包**之前**拦下 omp 相关的配置漂移。任一条不过 = 不许打包。
//
// ── 为什么要在打包前拦，而不是打完再看 ──────────────────────────────────────
// 这一类错误的共同点是**装出来的包静默失效**：dev 全绿、`npm run check` 全绿、
// `node --test` 全绿，只有真的装出来那份找不到二进制、或者跑的是另一个版本。
// 而打完再发现，mac 是白等 20 分钟公证，Windows 是白跑一轮 CI。
//
// 现有机制盖不住这一类：`cliContract` 的 shouldWarn 只对「探针少了」出声，
// 版本变了但探针都在**不出声**；`verify-agent-chat.mjs` 只钉 agent-hooks 那一条，
// 而且它不在 check / dist 链里。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'resources', 'omp')

const problems = []
const fail = (m) => problems.push(m)
const read = (p) => fs.readFileSync(p, 'utf8')

const manifest = JSON.parse(read(path.join(DIR, 'manifest.json')))
const paths = read(path.join(ROOT, 'src/main/agentChat/omp/paths.ts'))
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))

// ── C1 钉死的版本，代码与清单必须是同一个 ─────────────────────────────────
// 对不上的症状：包里放的是 A 版，代码按 B 版的假设做事（会话格式、CLI 形状都可能变），
// 而 `--version` 自检要等到用户起第一个会话才跑。
{
  const m = paths.match(/OMP_PINNED_VERSION\s*=\s*'([^']+)'/)
  if (!m) fail('paths.ts 里找不到 OMP_PINNED_VERSION')
  else if (m[1] !== manifest.version) {
    fail(`版本对不上：manifest ${manifest.version} ≠ paths.ts ${m[1]}`)
  }
}

// ── C2 extraResources 的 `to` 与代码里那个字面量必须逐字相同 ────────────────
// 这是 10-模块领地图点名的那种失效：dev 走 appPath 分支永远是绿的，
// **只有装出来的包静默找不到文件**，功能整块死掉且不报错。
{
  const m = paths.match(/OMP_RESOURCE_DIR\s*=\s*'([^']+)'/)
  const dirName = m?.[1]
  if (!dirName) fail('paths.ts 里找不到 OMP_RESOURCE_DIR')
  const list = pkg.build?.extraResources ?? []
  const binEntry = list.find((e) => typeof e?.from === 'string' && e.from.includes('resources/omp/'))
  if (!binEntry) fail('package.json 的 build.extraResources 里没有 omp 那条')
  else if (binEntry.to !== dirName) {
    fail(`extraResources 的 to='${binEntry.to}' 与 OMP_RESOURCE_DIR='${dirName}' 对不上`)
  }
  // `${os}` 展开成 mac/win（不是 darwin/win32），`${arch}` 每个架构各展开一次。
  // 写错的话目录不存在，而 electron-builder 只 log.warn **不报错**，包照样打出来、里面没有 omp。
  if (binEntry && !/\$\{os\}-\$\{arch\}/.test(binEntry.from)) {
    fail(`extraResources 的 from='${binEntry.from}' 少了 \${os}-\${arch} 宏，打出来会缺二进制而且不报错`)
  }
  if (!list.some((e) => typeof e?.from === 'string' && e.from.includes('THIRD-PARTY-NOTICES'))) {
    fail('extraResources 里没有 THIRD-PARTY-NOTICES.txt（MIT 要求随分发附带）')
  }
}

// ── C3 --tools 白名单里的每个名字都得是 omp 真有的工具 ─────────────────────
// 一个错名字会让 `validateToolNames` 抛（上游 `cli/args.ts:336-344`），
// 于是**每一次 session/new 都失败**，用户点开 omp 会话永远只看到一条握手错误。
{
  const pickList = (name) => {
    const m = paths.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`))
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  }
  const tools = pickList('OMP_TOOLS')
  const builtin = pickList('OMP_BUILTIN_TOOLS')
  if (!tools || !builtin) fail('paths.ts 里找不到 OMP_TOOLS / OMP_BUILTIN_TOOLS')
  else {
    const unknown = tools.filter((t) => !builtin.includes(t))
    if (unknown.length) fail(`--tools 白名单里有 omp 不认识的工具：${unknown.join(', ')}`)
  }
}

// ── C4 这次构建要用的二进制：在、非空、SHA 对、posix 上有可执行位 ──────────
{
  const need =
    process.platform === 'darwin' ? ['mac-arm64', 'mac-x64'] : process.platform === 'win32' ? ['win-x64'] : []
  for (const t of need) {
    const a = manifest.assets[t]
    const p = path.join(DIR, t, a.file)
    if (!fs.existsSync(p)) {
      fail(`缺 ${path.relative(ROOT, p)} —— 先跑 npm run omp:fetch`)
      continue
    }
    const st = fs.statSync(p)
    if (st.size === 0) fail(`${t} 的二进制是空文件`)
    const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    if (got !== a.sha256) fail(`${t} 的 SHA256 与 manifest 对不上（下坏了或版本混了）`)
    // 漏 x 位的症状是 spawn EACCES，**且只在打包版上出现**
    if (process.platform !== 'win32' && !(st.mode & 0o100)) fail(`${t} 的二进制没有可执行位`)
  }
  const notices = path.join(DIR, manifest.notices.file)
  if (!fs.existsSync(notices) || fs.statSync(notices).size === 0) {
    fail('缺 THIRD-PARTY-NOTICES.txt —— 先跑 npm run omp:fetch')
  }
}

if (problems.length) {
  console.error('[check-omp-bundle] 不能打包：')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`[check-omp-bundle] ✓ omp ${manifest.version}`)
