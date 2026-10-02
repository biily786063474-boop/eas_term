import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audit, backfill, markerVersions, referencedVersions } from './site-version.mjs'

// 取自真实下载页的结构：当前版（带标记）+ 钉住的 macOS 11 旧入口（无标记）
const download = `
<p>macOS 11 请用 0.4.113：<a href="/download/v0.4.113/Eas-Term-0.4.113-arm64.dmg">Apple 芯片</a> · <a href="/download/v0.4.113/Eas-Term-0.4.113-x64.dmg">Intel</a></p>
<!-- v0.4.121 --><a href="/download/v0.4.121/Eas-Term-0.4.121-arm64.dmg">arm</a>
<!-- v0.4.121 --><a href="/download/v0.4.121/Eas-Term-0.4.121-x64.zip">zip</a>
<!-- v0.4.121 --><a href="/download/v0.4.121/Eas-Term-0.4.121-x64-setup.exe">win</a>`
const home = `<p class="hero-req">macOS · Windows · v0.4.121</p><div class="win-ver">v0.4.121</div><svg><path d="M1 2v0.4.5"/></svg>`

test('上一版取自版本标记', () => {
  assert.deepEqual(markerVersions(download), ['0.4.121'])
  assert.deepEqual(markerVersions(home), [])
})

test('只改上一版：macOS 11 的 0.4.113 入口原样保留', () => {
  const out = backfill(download, '0.4.122', ['0.4.121'], { win: true })
  assert.match(out, /\/download\/v0\.4\.113\/Eas-Term-0\.4\.113-arm64\.dmg/)
  assert.match(out, /\/download\/v0\.4\.113\/Eas-Term-0\.4\.113-x64\.dmg/)
  assert.match(out, /\/download\/v0\.4\.122\/Eas-Term-0\.4\.122-arm64\.dmg/)
  assert.match(out, /\/download\/v0\.4\.122\/Eas-Term-0\.4\.122-x64-setup\.exe/)
  assert.doesNotMatch(out, /0\.4\.121/)
  const a = audit(out, '0.4.122', ['0.4.121'])
  assert.deepEqual(a.stale, [])
  assert.deepEqual(a.pinned.sort(), ['/download/v0.4.113/Eas-Term-0.4.113-arm64.dmg', '/download/v0.4.113/Eas-Term-0.4.113-x64.dmg'])
})

test('首页版本标签跟着回填；SVG 路径里形如 v0.4.5 的坐标不碰', () => {
  const out = backfill(home, '0.4.122', ['0.4.121'])
  assert.equal((out.match(/v0\.4\.122</g) || []).length, 2)
  assert.match(out, /d="M1 2v0\.4\.5"/)
  assert.deepEqual(audit(out, '0.4.122', ['0.4.121']).stale, [])
})

test('标签漏改会被残留检查拦下（发 0.4.120 时首页 34 处就是这么漏的）', () => {
  assert.deepEqual(audit(home, '0.4.122', ['0.4.121']).stale.sort(), ['>v0.4.121<', '· v0.4.121<'])
})

test('不带 --win：exe 停在上一版，算落后的 pinned，不算残留', () => {
  const out = backfill(download, '0.4.122', ['0.4.121'], { win: false })
  const a = audit(out, '0.4.122', ['0.4.121'])
  assert.deepEqual(a.stale, [])
  assert.ok(a.pinned.includes('/download/v0.4.121/Eas-Term-0.4.121-x64-setup.exe'))
})

test('上一版的 mac 包链接没改到 = 残留；目录与文件名版本对不上 = 残留', () => {
  const broken = `<!-- v0.4.122 --><a href="/download/v0.4.121/Eas-Term-0.4.121-arm64.dmg"></a><a href="/download/v0.4.122/Eas-Term-0.4.121-x64.dmg"></a>`
  const a = audit(broken, '0.4.122', ['0.4.121'])
  assert.equal(a.stale.length, 2)
})

test('版本相同时什么都不改（重复执行是幂等的）', () => {
  assert.equal(backfill(download, '0.4.121', ['0.4.121'], { win: true }), download)
})

test('清理旧版本用的引用清单包含钉住的旧入口', () => {
  assert.deepEqual(referencedVersions(download).sort(), ['0.4.113', '0.4.121'])
})

test('仓库路径带空格时命令行入口照样执行（vibe coding；原先 main 静默不跑）', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site version '))
  fs.copyFileSync(new URL('./site-version.mjs', import.meta.url), path.join(dir, 'site-version.mjs'))
  fs.writeFileSync(path.join(dir, 'page.html'), download)
  const out = execFileSync(process.execPath, [path.join(dir, 'site-version.mjs'), 'refs', path.join(dir, 'page.html')], { encoding: 'utf8' })
  assert.deepEqual(out.trim().split('\n').sort(), ['0.4.113', '0.4.121'])
  fs.rmSync(dir, { recursive: true, force: true })
})
