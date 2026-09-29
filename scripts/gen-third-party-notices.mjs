#!/usr/bin/env node
// 第三方许可清单（2026-09-29）：electron-vite build 之后跑，写 out/renderer/third-party-notices.txt
// （设置 → 关于与开源致谢 → 「查看完整许可清单」读的就是它）。
//
// 两路来源合并：
//   1. electron.vite.config.ts 里 recordBundledPackages 记下的「被打进 JS 的包」（out/.third-party/*.json）
//      —— 它们的许可注释被压缩删掉了，不在这里列就哪儿都没有；
//   2. package-lock.json 里的生产依赖 —— electron-builder 原样放进 app.asar/node_modules，许可文件本来就在，
//      这里一并列出，让清单是完整的一份。
// 再加 src/shared/ossCredits.ts 里人工维护的非 npm 项（oh-my-pi、React Bits、Electron / Chromium、语音模型）。
//
// 硬拦：三个构建目标的名单缺任何一个就退出 1 —— 说明插件没跑，出来的清单会漏掉打进 JS 的那批库。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OSS_CREDITS, MODEL_CREDITS } from '../src/shared/ossCredits.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REC = path.join(ROOT, 'out/.third-party')
const OUT = path.join(ROOT, 'out/renderer/third-party-notices.txt')
const TARGETS = ['main', 'preload', 'renderer']

const missing = TARGETS.filter((t) => !fs.existsSync(path.join(REC, `${t}.json`)))
if (missing.length) {
  console.error(`✗ 缺少构建名单 out/.third-party/{${missing.join(',')}}.json —— recordBundledPackages 没跑？先 electron-vite build`)
  process.exit(1)
}

const self = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
/** 包目录 → 来源标记 */
const dirs = new Map()
for (const t of TARGETS) for (const d of JSON.parse(fs.readFileSync(path.join(REC, `${t}.json`), 'utf8'))) dirs.set(path.resolve(d), 'bundled')
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
for (const [key, info] of Object.entries(lock.packages ?? {})) {
  if (!key || info.dev || info.devOptional || !key.includes('node_modules/')) continue
  const d = path.join(ROOT, key)
  if (fs.existsSync(d) && !dirs.has(d)) dirs.set(d, 'node_modules')
}

const LICENSE_RE = /^(licen[cs]e|copying|notice)(\.|-|$)/i
const licenseOf = (pkg) => {
  const l = pkg.license ?? pkg.licenses
  if (!l) return '未声明'
  if (typeof l === 'string') return l
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(' OR ')
  return l.type ?? String(l)
}
const authorOf = (pkg) => typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? ''

const entries = []
for (const [dir, how] of dirs) {
  const pj = path.join(dir, 'package.json')
  if (!fs.existsSync(pj)) continue
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
  if (!pkg.name || pkg.name === self.name) continue
  const files = fs.readdirSync(dir).filter((f) => LICENSE_RE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort()
  const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n')
  entries.push({ name: pkg.name, version: pkg.version ?? '', license: licenseOf(pkg), author: authorOf(pkg), how, text })
}
// 同名同版本只留一份（嵌套 node_modules 里常有重复）
const seen = new Set()
const uniq = entries.filter((e) => { const k = `${e.name}@${e.version}`; if (seen.has(k)) return false; seen.add(k); return true })
  .sort((a, b) => a.name.localeCompare(b.name))

const rule = '='.repeat(78)
const lines = []
lines.push(`Eas-Term ${self.version} · 第三方软件许可清单 / Third-party notices`, rule, '')
lines.push('这份清单在构建时自动生成：列出打包进应用的每一个第三方包及其许可原文。')
lines.push('This file is generated at build time and lists every third-party package bundled into the app, with its license text.', '')
lines.push('另附（安装包 Resources/ 下）：licenses/electron-LICENSE.txt · licenses/LICENSES.chromium.html · licenses/Apache-2.0.txt · licenses/FunASR-MODEL_LICENSE.txt · omp/THIRD-PARTY-NOTICES.txt', '')
lines.push(rule, '致谢 / Acknowledgements', rule, '')
for (const c of [...OSS_CREDITS, ...MODEL_CREDITS]) {
  lines.push(`${c.name} — ${c.author}`, `  ${c.role}`, `  License: ${c.license} · ${c.url}${c.licenseFile ? ` · 原文：Resources/${c.licenseFile}` : ''}`, '')
}
lines.push(rule, `npm 包（${uniq.length} 个）/ npm packages`, rule, '')
let noText = 0
for (const e of uniq) {
  lines.push('-'.repeat(78), `${e.name} ${e.version} — ${e.license}${e.author ? ` — ${e.author}` : ''}`, '')
  if (e.text) lines.push(e.text, '')
  else { noText++; lines.push(`（包内未附许可文件；按 package.json 声明为 ${e.license}${/apache/i.test(e.license) ? '，原文见 Resources/licenses/Apache-2.0.txt' : ''}）`, '') }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n'))
// 中间名单里是本机绝对路径（/Users/…/node_modules/…），而 build.files 收 out/**/* —— 不删就跟着进安装包（2026-09-29 拆包抓到）
fs.rmSync(REC, { recursive: true, force: true })
const bundled = uniq.filter((e) => e.how === 'bundled').length
console.log(`✓ 第三方许可清单 ${path.relative(ROOT, OUT)}：${uniq.length} 个包（打进 JS 的 ${bundled} 个），${noText} 个包内没有许可文件（已注明声明的许可）`)
