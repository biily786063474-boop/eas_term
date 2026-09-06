#!/usr/bin/env node
// 发版前确认「电脑视野」的原生助手真的在、且是通用二进制。
//
// 为什么要单独一道检查：`dist` 走的是 `electron-vite build` 而不是 `npm run build`，
// 2026-09-06 差点因此发出一个**没有助手**的包 —— 那样插件在用户机器上只会说
// 「窗口助手没编译出来」，而本机开发时因为手动编过完全看不出来（同 check-omp-bundle.mjs 的动机）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = path.join(root, 'resources/plugins/computer/bin/eas-windows')

if (process.platform !== 'darwin') {
  console.log('[check-helper] 不是 macOS，跳过')
  process.exit(0)
}
if (!fs.existsSync(bin)) {
  console.error('[check-helper] ✗ 助手不存在：' + bin)
  console.error('  跑 node scripts/build-computer-helper.mjs（需要 Xcode 命令行工具）')
  process.exit(1)
}
const info = execFileSync('lipo', ['-info', bin]).toString()
for (const arch of ['arm64', 'x86_64']) {
  if (!info.includes(arch)) {
    console.error(`[check-helper] ✗ 助手缺 ${arch}：${info.trim()}`)
    console.error('  必须是通用二进制 —— 一次 dist 同时出 arm64 与 x64 两个包，共用这一份')
    process.exit(1)
  }
}
// 真跑一次只读子命令，确认它能起来（架构对但跑不起来的情况也拦住）
try {
  const out = execFileSync(bin, ['axcheck'], { encoding: 'utf8', timeout: 5000 })
  JSON.parse(out)
} catch (e) {
  console.error('[check-helper] ✗ 助手跑不起来：' + String(e.message || e))
  process.exit(1)
}
console.log(`[check-helper] ✓ ${(fs.statSync(bin).size / 1024).toFixed(0)}KB · 通用二进制 · 能运行`)
