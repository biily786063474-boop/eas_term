// No free-form strings: error messages, CLI output and function names can contain user data.
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
export const MAX_RAW = 1024 * 1024
export const MAX_WIRE = 256 * 1024
export const KINDS = ['app-start', 'app-ready', 'app-quit', 'previous-unclean', 'main-error', 'main-rejection', 'window-open', 'window-close', 'window-unresponsive', 'render-gone', 'child-gone', 'chat-open', 'chat-start', 'chat-send', 'cli-spawn', 'cli-started', 'cli-error', 'cli-exit', 'pty-create', 'pty-started', 'pty-error', 'pty-exit'] as const
const CLIS = ['claude', 'codex', 'omp']
const REASONS = ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']
const SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'error']
const ERRORS = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'Unknown']
const CODES = ['ENOENT', 'EPIPE', 'EIO', 'EACCES', 'EPERM', 'ENOMEM', 'ENOSPC', 'EINVAL', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED']
export interface SafeEvent { t: number; kind: string; run?: string; cli?: string; processType?: string; code?: number; signal?: string; reason?: string; error?: string; errorCode?: string; frames?: string[] }
export function safeEvent(kind: unknown, data: Record<string, unknown>, time: number): SafeEvent | null {
  if (!KINDS.includes(kind as typeof KINDS[number])) return null
  const e: SafeEvent = { t: Number.isFinite(time) ? Math.max(0, Math.min(Math.floor(time), 1e12)) : 0, kind: kind as string }
  if (typeof data.run === 'string' && /^[a-f0-9-]{36}$/.test(data.run)) e.run = data.run
  for (const [key, values] of [['cli', CLIS], ['reason', REASONS], ['signal', SIGNALS], ['processType', ['GPU', 'Utility', 'Tab', 'Browser', 'Zygote', 'Sandbox helper', 'Pepper Plugin', 'Pepper Plugin Broker']]] as const) {
    if (typeof data[key] === 'string' && (values as readonly string[]).includes(data[key] as string)) e[key] = data[key] as string
  }
  if (Number.isInteger(data.code) && Math.abs(data.code as number) <= 4294967295) e.code = data.code as number
  if (data.error && typeof data.error === 'object') {
    const err = data.error as Record<string, unknown>
    e.error = ERRORS.includes(String(err.name)) ? String(err.name) : 'Unknown'
    if (CODES.includes(String(err.code))) e.errorCode = String(err.code)
    const frames = String(err.stack ?? '').split('\n').slice(1, 20).flatMap(line => {
      // Retain only built bundle coordinates, never paths or caller/function text.
      const m = /[\\/]out[\\/](main|preload)[\\/]index\.js:(\d{1,8}):(\d{1,8})\)?$/.exec(line.trim())
      return m ? [`${m[1]}:${m[2]}:${m[3]}`] : []
    }).slice(0, 8)
    if (frames.length) e.frames = frames
  } else if (typeof data.error === 'string' && ERRORS.includes(data.error)) {
    e.error = data.error
    if (CODES.includes(String(data.errorCode))) e.errorCode = String(data.errorCode)
    if (Array.isArray(data.frames)) e.frames = data.frames.filter(f => typeof f === 'string' && /^(main|preload):\d{1,8}:\d{1,8}$/.test(f)).slice(0, 8)
  }
  return e
}
export interface Report { schemaVersion: 1; id: string; version: string; os: string; arch: string; events: SafeEvent[] }
export function makeReport(meta: { version: string; os: string; arch: string }, rows: unknown[]): Report {
  const events = rows.slice(-1500).flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const d = row as Record<string, unknown>; const e = safeEvent(d.kind, d, Number(d.t))
    return e ? [e] : []
  })
  return { schemaVersion: 1, id: randomUUID(), version: /^0\.4\.85-diag\.\d{1,4}$/.test(meta.version) ? meta.version : '0.4.85-diag.1', os: /^\d{1,5}(\.\d{1,5}){1,3}$/.test(meta.os) ? meta.os : '0.0', arch: ['x64', 'arm64', 'ia32'].includes(meta.arch) ? meta.arch : 'x64', events }
}
export function encodeReport(r: Report): Buffer {
  const raw = Buffer.from(JSON.stringify(r))
  if (raw.length > MAX_RAW) throw new Error('report too large')
  const wire = gzipSync(raw)
  if (wire.length > MAX_WIRE) throw new Error('report too large')
  return wire
}
