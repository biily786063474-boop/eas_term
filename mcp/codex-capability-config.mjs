import { spawn } from 'node:child_process'

const fail = reason => new Error(`Codex 配置保护失败：${reason}`)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
// JSON basic-string escapes are valid TOML; DEL must also be escaped.
const quote = value => {
  if (typeof value !== 'string' || !value.isWellFormed()) throw fail('配置字符串无效')
  return JSON.stringify(value).replace(/\x7f/g, '\\u007f')
}
const toml = value => {
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`
  if (object(value)) return `{${Object.entries(value).map(([key, v]) => `${quote(key)}=${toml(v)}`).join(',')}}`
  throw fail('不支持的配置值')
}
function userArgs(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-p' || arg === '--profile' || arg.startsWith('--profile=')) {
      // Codex 0.153.4 profile-v2 is runtime-only; config/read has no profile parameter.
      // Reading the default profile would silently erase the user's actual restrictions.
      throw fail('当前原生 app-server 不支持 profile 配置读取，不能安全合并')
    }
    if (arg === '-c' || arg === '--config') {
      const value = args[++i]
      if (typeof value !== 'string' || !value.length) throw fail('配置参数缺值')
      out.push('-c', value)
    } else if (arg.startsWith('--config=')) out.push('-c', arg.slice(9))
    else throw fail('不支持的用户配置参数')
  }
  return out
}

/** Only initialize/config/read, never a model or tool. Settles after the owned probe exits. */
async function readConfig({ binary, cwd, env, timeoutMs, signal }, args) {
  if (signal?.aborted) throw fail('已取消')
  return new Promise((resolve, reject) => {
    let child, outcome, finished = false, buffer = '', bytes = 0, killTimer
    const finish = (error, value) => {
      if (finished) return
      finished = true
      outcome = { error, value }
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (!child || child.pid === undefined) return error ? reject(error) : resolve(value)
      child.stdin.destroy()
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250)
    }
    const abort = () => finish(fail('已取消'))
    const timer = setTimeout(() => finish(fail('读取超时')), timeoutMs)
    const send = message => {
      if (finished) return
      child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) finish(fail('请求写入失败')) })
    }
    try { child = spawn(binary, ['app-server', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] }) }
    catch { finish(fail('无法启动配置探针')); return }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', () => finish(fail('无法启动配置探针')))
    child.once('close', () => {
      clearTimeout(timer); clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      if (!outcome) outcome = { error: fail('配置探针提前退出') }
      finished = true
      if (outcome.error) reject(outcome.error)
      else resolve(outcome.value)
    })
    child.stdin.on('error', () => finish(fail('请求写入失败')))
    child.stdout.on('error', () => finish(fail('响应读取失败')))
    child.stdout.setEncoding('utf8')
    let expected = 1
    child.stdout.on('data', chunk => {
      if (finished) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > 8 * 1024 * 1024) return finish(fail('配置响应过大'))
      buffer += chunk
      let end
      while (!finished && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        let message
        try { message = JSON.parse(line) } catch { finish(fail('响应格式无效')); break }
        if (!object(message)) { finish(fail('响应格式无效')); break }
        if (message.id !== expected) continue
        if (message.error || !object(message.result)) { finish(fail('原生配置读取被拒绝')); break }
        if (expected === 1) {
          expected = 2
          send({ method: 'initialized' })
          send({ id: 2, method: 'config/read', params: { cwd, includeLayers: false } })
        } else {
          if (!object(message.result.config)) finish(fail('原生配置结构无效'))
          else finish(null, message.result.config)
        }
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'eas_capability_config', version: '1.0.0' }, capabilities: { experimentalApi: true } } })
  })
}
function stringList(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw fail('工具禁用配置无效')
  return value
}
function skillList(config) {
  const items = config.skills?.config ?? []
  if (!Array.isArray(items) || items.some(v => !object(v) || typeof v.path !== 'string' || typeof v.enabled !== 'boolean')) throw fail('技能配置无效')
  return items
}

/** Caller preserves original user flags and appends this result last. binary is the native CLI.
 * Native config/read parses both snapshots; no partial TOML parser or config logging here. */
export async function readAndMergeCodexConfig({ binary, cwd, env = process.env, userConfigArgs = [], managedAssignments = [], timeoutMs = 10000, signal }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw fail('读取超时配置无效')
  if (!Array.isArray(managedAssignments) || managedAssignments.some(v => typeof v !== 'string')) throw fail('受管配置参数无效')
  const options = { binary, cwd, env, timeoutMs, signal }
  const originalArgs = userArgs(userConfigArgs)
  const base = await readConfig(options, originalArgs)
  const candidate = await readConfig(options, [...originalArgs, ...managedAssignments.flatMap(v => ['-c', v])])
  if (signal?.aborted) throw fail('已取消')
  const result = [...managedAssignments]
  for (const key of ['instructions', 'developer_instructions']) {
    const old = base[key], next = candidate[key]
    if (old === next || old == null || old === '') continue
    if (typeof old !== 'string' || (next != null && typeof next !== 'string')) throw fail('指引配置无效')
    result.push(`${key}=${quote(next ? old + '\n\n' + next : old)}`)
  }
  const names = new Set([...Object.keys(base.mcp_servers ?? {}), ...Object.keys(candidate.mcp_servers ?? {})])
  for (const name of names) {
    const old = base.mcp_servers?.[name] ?? {}, next = candidate.mcp_servers?.[name] ?? {}
    const all = [...new Set([...stringList(old.disabled_tools), ...stringList(next.disabled_tools)])]
    const toolsChanged = JSON.stringify(all) !== JSON.stringify(next.disabled_tools ?? [])
    const disabledChanged = old.enabled === false && next.enabled !== false
    // Codex splits -c paths on dots without decoding quoted segments. Do not emit a
    // fake quoted key or serialize entire server tables (which may contain secrets).
    if ((toolsChanged || disabledChanged) && !/^[A-Za-z0-9_-]+$/.test(name)) throw fail('原生配置覆盖不支持此服务名称')
    const prefix = `mcp_servers.${name}`
    if (toolsChanged) result.push(`${prefix}.disabled_tools=${toml(all)}`)
    if (disabledChanged) result.push(`${prefix}.enabled=false`)
  }
  const skills = new Map()
  for (const item of [...skillList(base), ...skillList(candidate)]) {
    const previous = skills.get(item.path)
    skills.set(item.path, { ...previous, ...item, enabled: previous?.enabled === false ? false : item.enabled })
  }
  const mergedSkills = [...skills.values()]
  if (JSON.stringify(mergedSkills) !== JSON.stringify(skillList(candidate))) result.push(`skills.config=${toml(mergedSkills)}`)
  return result
}
