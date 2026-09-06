#!/usr/bin/env node
// 把 computer use 插件的窗口列表助手编成**通用二进制**（arm64 + x86_64）。
//
// 为什么是通用而不是按架构分开：`npm run dist` 一次同时出 arm64 与 x64 两个包，
// 分架构就要编两次并在打包配置里按 ${arch} 分流（omp 那样）；这个助手只有 150KB，
// 做成通用二进制最省事，两个包直接共用一份。
//
// **编不出来不算失败**：没装 Xcode 命令行工具的机器上跳过，插件运行时会走降级
// （拿不到窗口列表 → 不做窗口截图、不做打码、明确告诉用户为什么）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'resources/plugins/computer/native/windows.swift')
const outDir = path.join(root, 'resources/plugins/computer/bin')
const out = path.join(outDir, 'eas-windows')

function has(bin) {
  try {
    execFileSync('/usr/bin/which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (process.platform !== 'darwin') {
  console.log('[computer-helper] 不是 macOS，跳过')
  process.exit(0)
}
if (!has('swiftc') || !has('lipo')) {
  console.log('[computer-helper] 没有 swiftc/lipo（Xcode 命令行工具），跳过 —— 插件会走降级')
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'eas-helper-'))
try {
  const parts = []
  for (const [target, name] of [
    ['arm64-apple-macos11', 'arm64'],
    ['x86_64-apple-macos11', 'x64']
  ]) {
    const o = path.join(tmp, name)
    execFileSync('swiftc', ['-O', '-target', target, '-o', o, src], { stdio: 'inherit' })
    parts.push(o)
  }
  execFileSync('lipo', ['-create', ...parts, '-o', out], { stdio: 'inherit' })
  fs.chmodSync(out, 0o755)
  const arch = execFileSync('lipo', ['-info', out]).toString().trim()
  console.log(`[computer-helper] ✓ ${out}（${(fs.statSync(out).size / 1024).toFixed(0)}KB）${arch}`)
} catch (e) {
  console.log('[computer-helper] 编译失败，跳过 —— 插件会走降级：', e.message)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
