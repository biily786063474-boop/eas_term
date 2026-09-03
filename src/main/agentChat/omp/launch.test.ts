// `launch.ts` 的单测。
//
// **这个文件能存在本身就是一次重构的产物**（2026-09-03）：原来 launch.ts
// 直接 import `mcpBridge.ts`，而那条链上有无扩展名的相对 import（`./plugins`），
// Node 的 ESM 解析器认不了 —— 于是整个模块在 `node --test` 下加载不了，
// `readMcpServers` 那段角色禁用逻辑一条测试都没有。
//
// 顺带那条 import 还构成一个循环依赖：launch → mcpBridge → quotaStore → launch。
// 现在两个依赖都由调用方注入（`mcpEnv` 与 MCP 配置路径），环断了，测试也能跑了。
//
// ⚠️ **别在 launch.ts 里加回对 `mcpBridge` / `electron` 的 import** ——
// 加回去这个文件会整个红掉（下面第一条就是钉这个的）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import type { HostPaths } from '../../../shared/agentChat.ts'
import { planOmpLaunch, readMcpServers } from './launch.ts'
import { ompBinFileName, ompResourceDirName } from './paths.ts'

const tmps: string[] = []
after(() => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

/** 写一份 MCP 配置到临时文件，返回路径 */
function mcpConfig(servers: Record<string, unknown>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-launch-'))
  tmps.push(d)
  const p = path.join(d, 'mcp.json')
  fs.writeFileSync(p, JSON.stringify({ mcpServers: servers }))
  return p
}

const stdio = (name: string): Record<string, unknown> => ({
  [name]: { type: 'stdio', command: 'node', args: [`${name}.mjs`] }
})

describe('readMcpServers · 角色禁用的 server', () => {
  it('没有禁用名单时全都带上', () => {
    const p = mcpConfig({ ...stdio('eas-term'), ...stdio('bizone-canvas') })
    const { servers, dropped } = readMcpServers(p)
    assert.deepEqual(servers.map((s) => s.name).sort(), ['bizone-canvas', 'eas-term'])
    assert.deepEqual(dropped, [])
  })

  it('**禁用的不进名单** —— 选了「画师」，图像类 MCP 就不该在会话里存在', () => {
    const p = mcpConfig({ ...stdio('eas-term'), ...stdio('bizone-canvas') })
    const { servers } = readMcpServers(p, ['bizone-canvas'])
    assert.deepEqual(servers.map((s) => s.name), ['eas-term'])
  })

  it('**禁用的也不进 dropped** —— dropped 是「这几个配置坏了」，有意不连不是故障', () => {
    const p = mcpConfig(stdio('bizone-canvas'))
    const { servers, dropped } = readMcpServers(p, ['bizone-canvas'])
    assert.deepEqual(servers, [])
    assert.deepEqual(dropped, [], '有意禁用的被误报成了坏配置')
  })

  it('禁用名单里有不存在的名字不影响别人', () => {
    const p = mcpConfig(stdio('eas-term'))
    assert.equal(readMcpServers(p, ['不存在的']).servers.length, 1)
  })

  it('配置路径为 null 时安静返回空 —— 不抛', () => {
    assert.deepEqual(readMcpServers(null), { servers: [], dropped: [] })
  })

  it('坏 JSON 安静返回空', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-launch-'))
    tmps.push(d)
    const p = path.join(d, 'bad.json')
    fs.writeFileSync(p, '{ 这不是 json')
    assert.deepEqual(readMcpServers(p), { servers: [], dropped: [] })
  })

  it('**非 stdio 型进 dropped 而不是 servers** —— 带进去会让整个 session/new 失败', () => {
    const p = mcpConfig({ ...stdio('好的'), 远程: { type: 'sse', url: 'https://x' } })
    const { servers, dropped } = readMcpServers(p)
    assert.deepEqual(servers.map((s) => s.name), ['好的'])
    assert.deepEqual(dropped, ['远程'])
  })

  it('**env 一律给数组，哪怕空** —— 上游无条件遍历它，省掉就是 TypeError', () => {
    const p = mcpConfig(stdio('eas-term'))
    assert.ok(Array.isArray(readMcpServers(p).servers[0].env))
  })
})

/** 造一个能过「随包二进制」那道闸的 host。
 *
 *  ⚠️ **这一步不能省。** 第一版测试直接给了个假路径，`planOmpLaunch` 因为
 *  `no-binary` 返回 `ok:false`，而断言写在 `if (!r.ok) return` 后面 ——
 *  于是两条测试**一次断言都没跑到就绿了**（2026-09-03 实测发现）。
 *  改坏 mcpEnv 的注入逻辑，它们照样绿。 */
function hostWithBin(): HostPaths {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-bin-'))
  tmps.push(d)
  const dir = path.join(d, 'resources', 'omp', ompResourceDirName())
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, ompBinFileName()), '#!/bin/sh\n', { mode: 0o755 })
  return { isPackaged: false, resourcesPath: '', appPath: d, userData: d, home: d }
}

describe('planOmpLaunch · MCP 凭证注入', () => {
  const base = (): { cwd: string; host: HostPaths; provider: string } => ({
    cwd: '/proj',
    host: hostWithBin(),
    provider: 'anthropic'
  })

  it('闸能过 —— 否则下面两条会「没断言到就绿」', () => {
    const r = planOmpLaunch(base())
    assert.ok(r.ok, r.ok ? '' : `闸没过：${r.reason} / ${r.message}`)
  })

  it('**不传 mcpEnv 就一个 MCP 变量都不注入** —— 冒烟那条路径靠的就是这个', () => {
    const r = planOmpLaunch(base())
    assert.ok(r.ok)
    for (const k of Object.keys(r.spec.env)) {
      assert.ok(!k.startsWith('EAS_TERM_'), `不该注入 ${k}`)
    }
  })

  it('传了就原样进 env', () => {
    const r = planOmpLaunch({ ...base(), mcpEnv: { EAS_TERM_PORT: '1', EAS_TERM_TOKEN: 't' } })
    assert.ok(r.ok)
    assert.equal(r.spec.env.EAS_TERM_PORT, '1')
    assert.equal(r.spec.env.EAS_TERM_TOKEN, 't')
  })
})
