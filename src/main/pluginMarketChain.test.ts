// 贯通测试:把 board 现打成 zip,再走一遍客户端安装校验链
//   parseRegistry → verifySha256 → extractZip → parseManifest → 权限核对
// 证明 pack-plugin.mjs 的产物与 pluginMarket 客户端的预期严丝合缝(打包脚本一漂就红)。
// 不碰 electron,`node --test` 裸跑;没有 zip 就跳过。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRegistry } from './pluginRegistry.ts'
import { verifySha256 } from './pluginInstall.ts'
import { extractZip } from './pluginUnzip.ts'
import { parseManifest } from './pluginManifest.ts'
// @ts-expect-error scripts 是 .mjs,无类型声明
import { packPlugin } from '../../scripts/pack-plugin.mjs'

let hasZip = true
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' })
} catch {
  hasZip = false
}

const here = path.dirname(fileURLToPath(import.meta.url))
// 首批 registry 里两个插件都过一遍链：board（内置样板）+ pomodoro（非内置，市场里能真装的）
const CASES = [
  { name: 'board', dir: path.resolve(here, '../../resources/plugins/board') },
  { name: 'pomodoro', dir: path.resolve(here, '../../plugins-store/pomodoro') }
]

for (const { name, dir } of CASES) {
  test(`${name} 打包 → 客户端安装校验链全程通`, { skip: !hasZip }, async () => {
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-out-'))
    const { entry, zipPath } = packPlugin(dir, { outRoot, baseUrl: 'https://eas.biily.top/plugins' })

    // 1. registry 校验:url https + 官方域名、sha256/version/size 格式,全过
    const reg = parseRegistry({ schema: 1, updated: '2026-09-15T00:00:00Z', plugins: [entry] }, { allowedHosts: ['eas.biily.top'] })
    assert.equal(reg.ok, true)
    if (!reg.ok) return
    assert.equal(reg.entries.length, 1)
    const e = reg.entries[0]
    assert.equal(e.name, name)

    // 2. sha256 校验:声明的哈希与真包一致
    const buf = fs.readFileSync(zipPath)
    assert.equal(verifySha256(buf, e.sha256), true)

    // 3. 解压 + 4. 清单校验:根部直接是 plugin.json、parseManifest 过
    // 解到 <tmp>/<name>（内层目录名 = 插件名，parseManifest 要求 name 等于目录名，同真实 staging 布局）
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chain-dest-')), name)
    await extractZip(buf, dest)
    const raw = JSON.parse(fs.readFileSync(path.join(dest, 'plugin.json'), 'utf8'))
    const man = parseManifest(raw, dest, { builtin: false, exists: (p) => fs.existsSync(p) })
    assert.equal(man.ok, true)
    if (!man.ok) return
    assert.equal(man.info.name, name)

    // 5. 权限核对:registry 声明的权限与包内清单一致(防目录谎报)
    assert.deepEqual(new Set(e.permissions?.canvas ?? []), new Set(man.info.permissions?.canvas ?? []))
  })
}

test('包被篡改一个字节 → sha256 校验挡下', { skip: !hasZip }, () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-out-'))
  const { entry, zipPath } = packPlugin(CASES[0].dir, { outRoot, baseUrl: 'https://eas.biily.top/plugins' })
  const buf = fs.readFileSync(zipPath)
  buf[buf.length - 1] ^= 0xff // 翻一位
  assert.equal(verifySha256(buf, entry.sha256), false)
})

test('new requirements cannot enter legacy registry; v2 packaging preserves constraints', { skip: !hasZip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-requirements-'))
  try {
    const dir = path.join(root,'sample')
    fs.mkdirSync(dir)
    const requirements = {minHostVersion:'0.4.103',capabilities:['mcp.remote']}
    fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name:'sample',version:'1.0.0',mcp:{command:'node'},requirements}))
    assert.throws(() => packPlugin(dir,{outRoot:path.join(root,'legacy')}), /v2/)
    assert.equal(fs.existsSync(path.join(root,'legacy')),false)
    const {entry} = packPlugin(dir,{outRoot:path.join(root,'v2'),registrySchema:2,baseUrl:'https://eas.biily.top/plugins/v2'})
    assert.deepEqual(entry.requirements,requirements)
    fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name:'sample',version:'1.0.0',requirements:{capabilities:[]}}))
    assert.throws(() => packPlugin(dir,{outRoot:path.join(root,'bad'),registrySchema:2}), /requirements/)
  } finally { fs.rmSync(root,{recursive:true,force:true}) }
})
