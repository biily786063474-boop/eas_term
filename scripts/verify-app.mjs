#!/usr/bin/env node
// 起一个**隔离的**开发实例并挂上 CDP，用来做真机功能验证 —— 不打包、不升版本号。
//
// 为什么需要它：UI 与 IPC 这一层，单测证明不了。而 `npm run dist` 要几分钟、还得升一个
// 版本号，改一行验一次的成本高到让人干脆不验 —— 2026-08-19 那天就这么滚出了九个版本。
//
// **绝不能用 `npm run dev` 代替**：electron-vite 的 CLI 自己解析参数，`--user-data-dir`
// 传不进去（会报 Unknown option），而 dev 模式的 userData 走 `app.getName()` 读的是
// package.json 的 productName —— 跟正式版**是同一个目录**，密钥柜就在那儿。
// 所以这里跑的是构建产物 + 显式隔离目录。
//
//   node scripts/verify-app.mjs            # 起实例，留着给你连（Ctrl-C 结束）
//   node scripts/verify-app.mjs --seed     # 顺带把真实环境的「安全部分」复制进去
//   node scripts/verify-app.mjs --port 9444
//
// 连上之后跑 JS：见文件末尾的 evalInApp 用法。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const includes = (f) => process.argv.includes(f)
const PORT = includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 9333

/** 从真实 userData 复制进隔离目录的白名单。
 *
 *  **secrets.json 和 mcp-endpoint.json 绝不在列** —— 一个是密钥柜，一个是本地服务的
 *  访问令牌。验证环境不需要它们，复制进去只是在多一个地方留副本。
 *  用白名单不用黑名单：以后 userData 里多出什么文件，默认是不复制，
 *  而不是「忘了加进黑名单就泄漏」。 */
const SEED_WHITELIST = [
  'projects.json',   // 项目列表 —— 没有它画布是空的，验不了任何跟 Frame 有关的东西
  'canvas.json',     // 画布布局：Frame、节点、teamMode 开关
  'prefs.json',
  'skill-prefs.json',
  'gantt.json',
  'board.json',
  'wiki.json',
  'quota.json',   // 额度条：没有它 QuotaBar 直接 return null（没数据不占位），验不了 hover
  // ↓ 2026-09-04 补：验收时「开发版的呈现要等于正式版」，缺了这几个对不上
  'skills.json',        // skill 面板的内容
  'mcp-optout.json',
  'cli-contracts.json'
]

/** 同样走白名单的**目录**。`agent-history` 在下面单独处理（只挑 .json）。 */
const SEED_DIRS = ['role-prompts']

// ⚠️ **下面这些永远不进白名单，别"顺手"加**：
//   secrets.json / secrets.json.bak*  —— 密钥柜
//   mcp-endpoint.json / mcp-config.json / agent-mcp.json —— 本地服务的访问令牌
//   phone-identity.json               —— 手机配对的私钥
//   omp/                              —— omp 自己的凭证存放处
//   Cookies / cli-auth.log            —— 登录态与登录日志
// 隔离实例是用来看界面的，不需要能真的调用谁。多一处副本就多一处泄漏面。

const realUserData = path.join(os.homedir(), 'Library', 'Application Support', 'Eas-Term')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-verify-'))

if (includes('--seed')) {
  let n = 0
  for (const f of SEED_WHITELIST) {
    try {
      fs.copyFileSync(path.join(realUserData, f), path.join(dir, f))
      n++
    } catch { /* 没有就跳过 */ }
  }
  for (const d of SEED_DIRS) {
    try {
      const src = path.join(realUserData, d)
      const dst = path.join(dir, d)
      fs.mkdirSync(dst, { recursive: true })
      for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f))
      n++
    } catch { /* 没有就跳过 */ }
  }
  // 聊天记录目录：**跨重启恢复那条路必须靠它才验得了**（「上次聊到这里」、
  // contextLost 的判断、resumeId 对不对得上，全在这些文件里）。
  // 单独处理是因为它是目录不是文件；同样走白名单精神 —— 只复制这一个已知目录。
  // 实例用完即删（cleanup 里 rmSync），不会留副本。
  try {
    const src = path.join(realUserData, 'agent-history')
    const dst = path.join(dir, 'agent-history')
    fs.mkdirSync(dst, { recursive: true })
    let m = 0
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith('.json')) continue
      fs.copyFileSync(path.join(src, f), path.join(dst, f))
      m++
    }
    if (m) console.log(`已复制 ${m} 份聊天记录（agent-history）`)
  } catch { /* 没有就跳过 */ }
  console.log(`已从真实环境复制 ${n} 个文件（白名单，不含 secrets.json / mcp-endpoint.json）`)
} else {
  // 至少给一个项目，否则连画布都进不去
  fs.writeFileSync(
    path.join(dir, 'projects.json'),
    JSON.stringify([{ id: 'p-verify', name: path.basename(process.cwd()), path: process.cwd(), addedAt: 1 }])
  )
}

console.log(`隔离数据目录: ${dir}`)
const child = spawn(
  path.join(process.cwd(), 'node_modules', '.bin', 'electron'),
  ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`],
  // EAS_VERIFY 让渲染层把 store 挂到 window.__store 上（正式构建默认不挂）。
  // **只在这个隔离实例里有** —— electron-builder 打的包不会带这个环境变量，
  // 用户拿到的版本照旧没有任何全局状态入口。
  // 没有它就只能靠查 DOM 反推状态，「节点挂没挂在 Frame 上」这类判断绕得很远。
  { stdio: 'inherit', env: { ...process.env, EAS_VERIFY: '1' } }
)

const cleanup = () => {
  try { child.kill() } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(0) })
child.on('exit', (code) => { cleanup(); process.exit(code ?? 0) })

// 等窗口起来再报地址，省得人对着一个还没监听的端口试
setTimeout(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const pages = await r.json()
    const main = pages.find((p) => p.type === 'page' && p.url.includes('out/renderer') && !p.url.includes('island'))
    console.log(main ? `\n✅ CDP 就绪: http://127.0.0.1:${PORT}  （主窗口已找到）\n` : `\n⚠️ 端口通了但没找到主窗口，现有 target：${pages.map((p) => p.type).join(', ')}\n`)
  } catch {
    console.log(`\n⚠️ ${PORT} 还没通，窗口可能还在起\n`)
  }
}, 5000)
