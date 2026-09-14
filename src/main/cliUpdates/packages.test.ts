import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stageVersion, verifyVersion } from './packages.ts'

test('native package pipeline checks integrity, extracts, validates version/help, and preserves package resources', {skip: process.platform === 'win32'}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-package-test-'))
  t.after(() => fs.rmSync(root, {recursive:true,force:true}))
  const source = path.join(root,'source'), installed = path.join(root,'installed')
  fs.mkdirSync(path.join(source,'package/bin'),{recursive:true})
  fs.writeFileSync(path.join(source,'package/bin/codex'), '#!/bin/sh\ncase "$*" in\n*--version*) echo "codex-cli 99.0.1";;\n*--help*) echo "--json --sandbox --skip-git-repo-check";;\nesac\n', {mode:0o755})
  fs.writeFileSync(path.join(source,'package/bin/resource.txt'),'companion')
  const archive = path.join(root,'package.tgz')
  execFileSync('/usr/bin/tar',['-czf',archive,'-C',source,'package'])
  const bytes = fs.readFileSync(archive)
  const integrity = 'sha512-'+createHash('sha512').update(bytes).digest('base64')
  let badHash = false, unsafeOrigin = false
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('.tgz')) return new Response(bytes)
    return Response.json({name:'@openai/codex', version:`99.0.1-${process.platform}-${process.arch}`, dist:{tarball:unsafeOrigin ? 'https://example.com/package.tgz' : 'https://registry.npmjs.org/package.tgz',integrity:badHash ? 'sha512-AAAA' : integrity}})
  }) as typeof fetch
  badHash = true
  await assert.rejects(stageVersion(installed,'codex','99.0.1',new AbortController().signal), /校验失败/)
  assert.equal(fs.existsSync(path.join(installed,'codex','99.0.1')),false)
  assert.deepEqual(fs.readdirSync(path.join(installed,'codex')),[])
  badHash = false; unsafeOrigin = true
  await assert.rejects(stageVersion(installed,'codex','99.0.1',new AbortController().signal), /来源/)
  unsafeOrigin = false
  await stageVersion(installed,'codex','99.0.1',new AbortController().signal)
  const bin = verifyVersion(installed,'codex','99.0.1')
  assert.equal(execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),'codex-cli 99.0.1')
  assert.equal(fs.readFileSync(path.join(path.dirname(bin),'resource.txt'),'utf8'),'companion')
})

// 2026-09-13：verifyBinary 原来是 execFileSync，8 秒 timeout 内主线程整个卡住（全量高负载时正是它 ETIMEDOUT）。
// 异步版本必须让事件循环继续转：卡住的假 CLI 超时被拒绝的同时，定时器仍在走。
test('异步校验挂住的 CLI 时事件循环不被阻塞，超时后拒绝', {skip: process.platform === 'win32'}, async t => {
  const { verifyVersionAsync } = await import('./packages.ts')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-verify-async-'))
  t.after(() => fs.rmSync(root, {recursive:true,force:true}))
  const dir = path.join(root, 'codex', '9.9.9'), bin = path.join(dir, 'package', 'bin', 'codex')
  fs.mkdirSync(path.dirname(bin), {recursive:true})
  fs.writeFileSync(bin, '#!/bin/sh\nsleep 5\n', {mode:0o755})
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify({bin:'package/bin/codex'}))
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 20)
  t.after(() => clearInterval(timer))
  await assert.rejects(verifyVersionAsync(root, 'codex', '9.9.9', {timeoutMs: 300}), /ETIMEDOUT|timeout|超时/i)
  assert.ok(ticks >= 5, `事件循环应持续运行，实际 ticks=${ticks}`)
})
