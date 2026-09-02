#!/usr/bin/env node
// 按 resources/omp/manifest.json 把 omp 的独立二进制下到 resources/omp/<os>-<arch>/。
//
// 用法：
//   node scripts/fetch-omp.mjs                # 按当前平台需要的 target（darwin → mac-arm64 + mac-x64）
//   node scripts/fetch-omp.mjs --all          # 三个都下
//   node scripts/fetch-omp.mjs --targets mac-arm64
//   OMP_FETCH_BASE=<镜像前缀> …                # 整体替换 url 的 origin
//
// ── 几件必须在这里做、别处补不了的事 ────────────────────────────────────────
// · **可执行位只能在这里保证**：electron-builder 的 copyFile 只保留并扩散源文件 mode、
//   不会凭空加 x，而二进制不入库所以也没有 git 的 mode 兜底。
//   漏 chmod 的症状是 spawn EACCES，**且只在打包版上出现**。
// · **SHA256 不符就删掉重来**，绝不留下一个「大小对但内容坏」的文件 ——
//   那种文件下次跑会被当成缓存跳过，坏在原地。
// · mac 上一次 `npm run dist` 要打 arm64 与 x64 两遍，所以 darwin 默认下两份。
//
// 本机首次跑要下 260MB+：全局 CLAUDE.md 记着 Clash TUN 会让大文件「连得上传不动」，
// 先给 github.com / objects.githubusercontent.com 加 DIRECT 再跑。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'resources', 'omp')
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))

const argv = process.argv.slice(2)
const pick = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

/** 这次要下哪几个。**默认只下当前平台用得上的** —— 在 mac 上顺手把
 *  Windows 那份 153MB 也拉下来纯属浪费，CI 上 runner 各下各的。 */
function targets() {
  if (argv.includes('--all')) return Object.keys(manifest.assets)
  const explicit = pick('--targets')
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean)
  if (process.platform === 'darwin') return ['mac-arm64', 'mac-x64']
  if (process.platform === 'win32') return ['win-x64']
  return []
}

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

function urlOf(u) {
  const base = process.env.OMP_FETCH_BASE
  if (!base) return u
  const parsed = new URL(u)
  return base.replace(/\/$/, '') + parsed.pathname
}

async function download(url, dest) {
  const res = await fetch(urlOf(url), { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const part = `${dest}.part`
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()))
  return part
}

/** 一个文件：已存在且 SHA 相同就跳过，否则下、校、就位。 */
async function ensure(dest, want, url, exec) {
  const name = path.relative(ROOT, dest)
  if (fs.existsSync(dest) && sha256(dest) === want) {
    if (exec && process.platform !== 'win32') fs.chmodSync(dest, 0o755)
    console.log(`  已缓存 ${name}`)
    return
  }
  console.log(`  下载 ${name} …`)
  const part = await download(url, dest)
  const got = sha256(part)
  if (got !== want) {
    fs.rmSync(part, { force: true })
    throw new Error(`${name} 校验不符\n  期望 ${want}\n  实际 ${got}`)
  }
  fs.renameSync(part, dest)
  // **posix 上必须显式加 x**，理由见文件头
  if (exec && process.platform !== 'win32') fs.chmodSync(dest, 0o755)
  console.log(`  ✓ ${name}`)
}

const list = targets()
if (list.length === 0) {
  console.log(`[fetch-omp] 这个平台（${process.platform}）不分发 omp，跳过`)
  process.exit(0)
}

console.log(`[fetch-omp] omp ${manifest.version} → ${list.join(', ')}`)
let failed = 0
for (const t of list) {
  const a = manifest.assets[t]
  if (!a) {
    console.error(`  ✗ manifest 里没有 target：${t}`)
    failed++
    continue
  }
  try {
    await ensure(path.join(DIR, t, a.file), a.sha256, a.url, true)
  } catch (e) {
    console.error(`  ✗ ${t}：${e.message}`)
    failed++
  }
}
try {
  await ensure(path.join(DIR, manifest.notices.file), manifest.notices.sha256, manifest.notices.url, false)
} catch (e) {
  console.error(`  ✗ 第三方声明：${e.message}`)
  failed++
}
if (failed) process.exit(1)
console.log('[fetch-omp] 就绪')
