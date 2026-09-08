#!/usr/bin/env node
// Owned by one Eas-Term process generation. Never edits user config or retries a turn.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveCliInvocation } from './cli-entry.mjs'
import { readAndMergeCodexConfig } from './codex-capability-config.mjs'

const abort = new AbortController()
let child
let terminating = false
let killTimer
function stop(signal) {
  terminating = true
  abort.abort()
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill(signal)
    killTimer ??= setTimeout(() => child?.kill('SIGKILL'), 3000)
    killTimer.unref()
  }
}
process.on('SIGINT', () => {
  // With an inherited terminal, the foreground group already delivers Ctrl-C
  // to native Codex. Forwarding it again would turn one cancel into two.
  if (child && process.stdin.isTTY) return
  stop('SIGINT')
})
process.on('SIGTERM', () => stop('SIGTERM'))

try {
  const input = JSON.parse(process.argv[2] ?? '')
  if (!input || typeof input.binary !== 'string' || !Array.isArray(input.args) || input.args.some(arg => typeof arg !== 'string')) throw new Error('invalid launch')
  const explicit = Object.hasOwn(input, 'managedAssignments')
  if (explicit && (!Array.isArray(input.managedAssignments) || input.managedAssignments.some(value => typeof value !== 'string'))) throw new Error('invalid managed config')
  const args = [], assignments = explicit ? [...input.managedAssignments] : [], userConfigArgs = []
  const config = value => explicit ? userConfigArgs.push('-c', value) : assignments.push(value)
  for (let index = 0; index < input.args.length; index++) {
    const arg = input.args[index]
    if (arg === '--') { args.push(...input.args.slice(index)); break }
    if (arg === '-c' || arg === '--config') {
      if (typeof input.args[index + 1] !== 'string') throw new Error('missing config')
      config(input.args[++index])
    } else if (arg.startsWith('--config=')) {
      config(arg.slice(9))
    } else if (arg.startsWith('-c') && arg.length > 2) {
      config(arg.slice(2))
    } else if (arg.startsWith('--profile=')) {
      userConfigArgs.push(arg)
    } else if (arg.startsWith('-p') && arg.length > 2) {
      userConfigArgs.push('-p', arg.slice(2))
    } else if (arg === '-p' || arg === '--profile') {
      if (typeof input.args[index + 1] !== 'string') throw new Error('missing profile')
      userConfigArgs.push(arg, input.args[++index])
    } else {
      args.push(arg)
    }
  }
  const env = { ...process.env }
  if (env.EAS_CAPABILITY_NODE_FALLBACK === '1') delete env.ELECTRON_RUN_AS_NODE
  delete env.EAS_CAPABILITY_NODE_FALLBACK
  const invocation = resolveCliInvocation('codex', input.binary, [], env, { command: process.execPath, args: [], ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}) })
  const cliEnv = { ...env, ...invocation.env }
  let configCwd = process.cwd()
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--') break
    if (args[index] === '-C' || args[index] === '--cd') configCwd = path.resolve(process.cwd(), args[++index])
    else if (args[index].startsWith('-C') && args[index].length > 2) configCwd = path.resolve(process.cwd(), args[index].slice(2))
    else if (args[index].startsWith('--cd=')) configCwd = path.resolve(process.cwd(), args[index].slice(5))
  }
  const merged = await readAndMergeCodexConfig({ binary: invocation.command, prefixArgs: invocation.args, cwd: configCwd, env: cliEnv, userConfigArgs, managedAssignments: assignments, signal: abort.signal })
  if (terminating) process.exitCode = 130
  else {
    // Global config options precede the exec subcommand, preserving positional prompts.
    child = spawn(invocation.command, [...invocation.args, ...userConfigArgs, ...merged.flatMap(value => ['-c', value]), ...args], { cwd: process.cwd(), env: cliEnv, stdio: 'inherit', windowsHide: true })
    const code = await new Promise(resolve => {
      child.once('error', () => resolve(1))
      child.once('exit', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 143)))
    })
    clearTimeout(killTimer)
    process.exitCode = code
  }
} catch {
  if (!terminating) process.stderr.write('Eas-Term：无法安全合并 Codex 用户配置，本轮尚未执行。请检查 Codex 配置或修复官方 CLI 安装（不支持未知 Windows 包装脚本）后重试。\n')
  process.exitCode = terminating ? 130 : 1
}
