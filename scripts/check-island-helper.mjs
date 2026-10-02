#!/usr/bin/env node
// 发版前确认原生灵动岛宿主（IslandHost.app）和它的页面资源真的在、且是通用二进制、能起来。
//
// 为什么缺了要**阻断**发版（电脑视野助手缺了只降级）：正式版 macOS 的灵动岛默认走这个宿主，
// 缺了运行时只能退回旧的 Electron 面板 —— 那条路点一下就会把整个 app 抢到前台、
// 点任务后主窗口拿不到键盘焦点（2026-10-01 实测根因），等于把修好的问题原样发出去。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = path.join(root, 'resources/island-native/bin/IslandHost.app')
const bin = path.join(app, 'Contents/MacOS/IslandHost')
const assets = path.join(root, 'out/island-native-assets')

if (process.platform !== 'darwin') {
  console.log('[check-island] 不是 macOS，跳过')
  process.exit(0)
}
const fail = (msg) => {
  console.error('[check-island] ✗ ' + msg)
  console.error('  跑 node scripts/build-island-helper.mjs（需要 Xcode 命令行工具，且先 electron-vite build）')
  process.exit(1)
}
if (!fs.existsSync(bin)) fail('宿主不存在：' + bin)
const info = execFileSync('lipo', ['-info', bin]).toString()
for (const arch of ['arm64', 'x86_64']) if (!info.includes(arch)) fail(`宿主缺 ${arch}：${info.trim()}`)
for (const f of ['Contents/Info.plist', 'Contents/Resources/bridge.js']) if (!fs.existsSync(path.join(app, f))) fail('宿主缺 ' + f)
let list
try {
  list = JSON.parse(fs.readFileSync(path.join(assets, 'island-assets.json'), 'utf8'))
} catch {
  fail('页面资源清单不存在：' + assets)
}
if (!Array.isArray(list) || !list.includes('island.html')) fail('页面资源清单里没有 island.html')
for (const f of list) if (!fs.existsSync(path.join(assets, f))) fail('清单里的资源不存在：' + f)
// 真跑一次：参数不对时宿主自己以 2 退出 —— 能走到这一步说明二进制能加载（架构对但起不来的也拦住）
const r = spawnSync(bin, ['1', assets, 'check'], { timeout: 5000 })
if (r.status !== 2) fail(`宿主起不来（期望参数校验以 2 退出，实际 status=${r.status} signal=${r.signal}）`)
// 另一个架构也真跑一次（arm64 机器上靠 Rosetta）：只看 lipo 拦不住「x86_64 那片坏了」
const other = process.arch === 'arm64' ? 'x86_64' : 'arm64'
if (other === 'x86_64' && spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']).status === 0) {
  const x = spawnSync('/usr/bin/arch', ['-x86_64', bin, '1', assets, 'check'], { timeout: 10000 })
  if (x.status !== 2) fail(`宿主 x86_64 那片起不来（status=${x.status} signal=${x.signal}）`)
} else console.log('[check-island] 本机跑不了 ' + other + '（无 Rosetta），只验了本机架构')
console.log(`[check-island] ✓ 通用二进制 · 能运行 · 页面资源 ${list.length} 个`)
