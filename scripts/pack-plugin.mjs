#!/usr/bin/env node
// 把一个插件目录打包成 <name>-<version>.zip，并算出 registry 要用的 sha256/size。
//
// 包格式（对齐设计稿 §包格式）：zip 根部**直接是 plugin.json**，不多套一层目录 ——
// 客户端 pluginMarket.extractZip 解压后就地读 plugin.json。
// 排除 .DS_Store 与 *.test.*（测试文件不该跟着插件发出去）。
//
// 用法：
//   node scripts/pack-plugin.mjs resources/plugins/board [--out dist/plugins]
// 也被 build-plugin-registry.mjs 当函数用（packPlugin）。
import { parsePluginRequirements } from '../src/main/pluginCompatibility.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const DEFAULT_BASE = 'https://eas.biily.top/plugins'

/** 打包一个插件目录，返回可直接进 registry.plugins 的条目 + 产物路径。 */
export function packPlugin(dir, opts = {}) {
  const outRoot = opts.outRoot || 'dist/plugins'
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  const pdir = path.resolve(dir)
  const m = JSON.parse(fs.readFileSync(path.join(pdir, 'plugin.json'), 'utf8'))
  const name = m.name
  const version = m.version
  if (!NAME_RE.test(name || '')) throw new Error(`${dir}: plugin.json.name 非法`)
  if (path.basename(pdir) !== name) throw new Error(`${dir}: 目录名须等于 plugin.json.name（${name}）`)
  if (!SEMVER_RE.test(version || '')) throw new Error(`${dir}: plugin.json.version 必须是 x.y.z`)

  const parsed = parsePluginRequirements(m.requirements)
  if (!parsed.ok) throw new Error('requirements: ' + parsed.reason)
  if (m.requirements !== undefined && opts.registrySchema !== 2) throw new Error('requirements 插件只允许发布到 v2 目录')

  const outDir = path.resolve(outRoot, name)
  fs.mkdirSync(outDir, { recursive: true })
  const zipPath = path.join(outDir, `${name}-${version}.zip`)
  fs.rmSync(zipPath, { force: true })
  // 从插件目录内部打包（cwd=pdir，成员名以 plugin.json 为根）。-X 去扩展属性，-r 递归，-q 安静
  execFileSync(
    'zip',
    ['-rqX', zipPath, '.', '-x', '.DS_Store', '-x', '*/.DS_Store', '-x', '*.test.*', '-x', '__pycache__/*'],
    { cwd: pdir, stdio: 'inherit' }
  )
  const buf = fs.readFileSync(zipPath)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const size = buf.length
  const entry = {
    name,
    displayName: m.displayName || name,
    ...(m.description ? { description: m.description } : {}),
    ...(m.category ? { category: m.category } : {}),
    ...(m.brandColor ? { brandColor: m.brandColor } : {}),
    version,
    url: `${baseUrl}/${name}/${name}-${version}.zip`,
    sha256,
    size,
    ...(m.permissions ? { permissions: m.permissions } : {}),
    ...(parsed.requirements ? { requirements: parsed.requirements } : {})
  }
  return { entry, zipPath }
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('用法: node scripts/pack-plugin.mjs <plugin-dir> [--out <dir>]')
    process.exit(1)
  }
  const outIdx = process.argv.indexOf('--out')
  const outRoot = outIdx > 0 ? process.argv[outIdx + 1] : 'dist/plugins'
  try {
    const { entry, zipPath } = packPlugin(dir, { outRoot })
    console.log(`打包完成: ${path.relative(process.cwd(), zipPath)}`)
    console.log(`sha256: ${entry.sha256}`)
    console.log(`size:   ${entry.size}`)
    console.log('\nregistry 条目片段:')
    console.log(JSON.stringify(entry, null, 2))
  } catch (e) {
    console.error('打包失败:', e.message)
    process.exit(1)
  }
}
