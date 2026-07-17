import { ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { SessionIndex, SessionTurn, SessionExchange } from '../shared/types'

// 读 Claude Code 的会话 transcript：~/.claude/projects/<编码后的cwd>/<sessionId>.jsonl
// 每行一个 JSON（type: user/assistant/…）。抽出用户真实消息 + 对应的 Claude 回答，
// 供「对话导航」主视图使用。同一 cwd 可能多份会话，取最近修改的那份（当前活跃会话）。

interface Parsed {
  mtimeMs: number
  sessionId: string
  turns: SessionTurn[]
  exchanges: Map<string, SessionExchange>
}
const cache = new Map<string, Parsed>() // key: jsonl 文件路径

// Claude Code 的目录名把 cwd 里的非字母数字都换成 '-'
function projectDir(cwd: string): string {
  const enc = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', enc)
}

function latestJsonl(dir: string): string | null {
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  let best: string | null = null
  let bestM = -1
  for (const f of files) {
    const full = path.join(dir, f)
    try {
      const m = fs.statSync(full).mtimeMs
      if (m > bestM) {
        bestM = m
        best = full
      }
    } catch {
      // 跳过读不到的
    }
  }
  return best
}

// 抽用户真实消息文本（过滤 tool_result、技能启动、系统注入、中断标记）
function userText(o: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }): string | null {
  if (o?.type !== 'user' || o?.isSidechain) return null
  const c = o.message?.content
  let text: string | null = null
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) {
    const tb = c.filter((b) => (b as { type?: string })?.type === 'text').map((b) => (b as { text?: string }).text ?? '')
    if (tb.length) text = tb.join('\n')
  }
  if (!text) return null
  const t = text.trim()
  if (
    !t ||
    t.startsWith('Base directory for this skill') ||
    INJECTED_TAG_RE.test(t) ||
    t.startsWith('[Request interrupted') ||
    t.startsWith('Caveat:')
  ) {
    return null
  }
  return t
}

// 只过滤已知的注入包装标签（skill/hook/系统提醒等），不能一刀切过滤所有 '<' 开头——
// 用户粘贴 HTML/JSX 提问（如「<div ...> 这个组件怎么居中」）是合法消息
const INJECTED_TAG_RE =
  /^<(command-name|command-message|command-args|local-command|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr|user-prompt|session-start)/

// 抽 Claude 回答文本（含可见文本 + 工具调用标注）
function assistantText(o: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }): string | null {
  if (o?.type !== 'assistant' || o?.isSidechain) return null
  const c = o.message?.content
  if (!Array.isArray(c)) return null
  const parts: string[] = []
  for (const b of c) {
    const blk = b as { type?: string; text?: string; name?: string }
    if (blk?.type === 'text' && blk.text) parts.push(blk.text)
    else if (blk?.type === 'tool_use' && blk.name) parts.push(`〔调用工具：${blk.name}〕`)
  }
  return parts.length ? parts.join('\n\n') : null
}

function parse(file: string): Parsed {
  const mtimeMs = fs.statSync(file).mtimeMs
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) return cached

  const raw = fs.readFileSync(file, 'utf8')
  const turns: SessionTurn[] = []
  const exchanges = new Map<string, SessionExchange>()
  let sessionId = ''
  let curUuid: string | null = null
  let curAssist: string[] = []

  const flush = (): void => {
    if (curUuid) {
      const ex = exchanges.get(curUuid)
      if (ex) ex.assistantText = curAssist.join('\n\n')
    }
    curAssist = []
  }

  for (const ln of raw.split('\n')) {
    if (!ln.trim()) continue
    let o: { type?: string; uuid?: string; timestamp?: string; sessionId?: string; isSidechain?: boolean; message?: { content?: unknown } }
    try {
      o = JSON.parse(ln)
    } catch {
      continue
    }
    if (o.sessionId) sessionId = o.sessionId
    const ut = userText(o)
    if (ut !== null && o.uuid) {
      // 中断重发等会让同一条消息连续出现两次：不新增，让后续回答接到上一条
      const prev = turns[turns.length - 1]
      if (prev && exchanges.get(prev.uuid)?.userText === ut) {
        flush()
        curUuid = prev.uuid
        continue
      }
      flush()
      curUuid = o.uuid
      const at = o.timestamp ? Date.parse(o.timestamp) : 0
      turns.push({ uuid: o.uuid, at, preview: ut.replace(/\s+/g, ' ').slice(0, 120) })
      exchanges.set(o.uuid, { userText: ut, assistantText: '', at })
      continue
    }
    const at2 = assistantText(o)
    if (at2 !== null && curUuid) curAssist.push(at2)
  }
  flush()

  const parsed: Parsed = { mtimeMs, sessionId, turns, exchanges }
  cache.set(file, parsed)
  return parsed
}

export function registerSessionHandlers(): void {
  ipcMain.handle('session:index', (_e, cwd: string): SessionIndex => {
    try {
      const file = latestJsonl(projectDir(cwd))
      if (!file) return { found: false, turns: [] }
      const p = parse(file)
      return { found: true, sessionId: p.sessionId, turns: p.turns }
    } catch {
      return { found: false, turns: [] }
    }
  })

  ipcMain.handle(
    'session:exchange',
    (_e, cwd: string, uuid: string, sessionId?: string): SessionExchange => {
      try {
        const dir = projectDir(cwd)
        // 优先按 index 时的 sessionId 定位文件（transcript 以 <sessionId>.jsonl 命名）：
        // 若期间同项目出现了更新的会话文件，重新取"最新"会查错文件、uuid 落空
        let file: string | null = null
        if (sessionId && /^[\w-]+$/.test(sessionId)) {
          const p = path.join(dir, `${sessionId}.jsonl`)
          if (fs.existsSync(p)) file = p
        }
        if (!file) file = latestJsonl(dir)
        if (!file) return { userText: '', assistantText: '', at: 0 }
        return parse(file).exchanges.get(uuid) ?? { userText: '', assistantText: '', at: 0 }
      } catch {
        return { userText: '', assistantText: '', at: 0 }
      }
    }
  )
}
