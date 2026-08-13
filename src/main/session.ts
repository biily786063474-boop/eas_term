import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { candidateDirs } from './sessionPaths'
import type { SessionIndex, SessionTurn, SessionExchange, SessionImage, SessionLast } from '../shared/types'

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

/** 直接读 projects.json 而不是从 projects.ts 导入：那边注册 IPC，import 进来会有副作用。
 *  和 fsGuard 用的是同一套做法（现读、不缓存），所以改名后立刻生效、不用重启。 */
function pastPathsOf(cwd: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'projects.json'), 'utf8')
    const list = JSON.parse(raw) as { path?: string; pastPaths?: string[] }[]
    if (!Array.isArray(list)) return []
    return list.find((p) => p?.path === cwd)?.pastPaths ?? []
  } catch {
    return [] // 读不到就只找当前目录，退化但不出错
  }
}

/** 这个 cwd 的 transcript 可能落在哪些目录，当前的排第一。
 *  项目改过名的话，改名前的会话还在老编码目录里 —— 一起找，不搬别人的目录。 */
function projectDirs(cwd: string): string[] {
  const root = path.join(os.homedir(), '.claude', 'projects')
  return candidateDirs(root, cwd, pastPathsOf(cwd))
}

/** 在候选目录里定位 transcript：优先按 sessionId 精确命中，否则取所有候选里 mtime 最新的。
 *  三个 handler 原本各写一遍这套逻辑，收在这里，免得改一处漏两处。 */
function findJsonl(cwd: string, sessionId?: string): string | null {
  const dirs = projectDirs(cwd)
  if (sessionId && /^[\w-]+$/.test(sessionId)) {
    for (const d of dirs) {
      const p = path.join(d, `${sessionId}.jsonl`)
      if (fs.existsSync(p)) return p
    }
  }
  let best: string | null = null
  let bestM = -1
  for (const d of dirs) {
    const f = latestJsonl(d)
    if (!f) continue
    try {
      const m = fs.statSync(f).mtimeMs
      if (m > bestM) {
        bestM = m
        best = f
      }
    } catch {
      // 跳过读不到的
    }
  }
  return best
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

interface UserContent {
  text: string // 纯图消息为 ''
  images: SessionImage[]
}

// 抽用户真实消息：文本 + 粘贴的图片（过滤 tool_result、技能启动、系统注入、中断标记）。
// 纯图无文字的消息也算一条（text=''），否则会从导航里消失、回答错挂到上一条。
function userContent(o: {
  type?: string
  isSidechain?: boolean
  message?: { content?: unknown }
}): UserContent | null {
  if (o?.type !== 'user' || o?.isSidechain) return null
  const c = o.message?.content
  let text = ''
  const images: SessionImage[] = []
  if (typeof c === 'string') {
    text = c
  } else if (Array.isArray(c)) {
    for (const b of c) {
      const blk = b as {
        type?: string
        text?: string
        source?: { type?: string; media_type?: string; data?: string }
      }
      // 含 tool_result 的是工具回执消息（其中的图片是工具截图），不是用户发言
      if (blk?.type === 'tool_result') return null
      if (blk?.type === 'text' && blk.text) text += (text ? '\n' : '') + blk.text
      else if (blk?.type === 'image' && blk.source?.type === 'base64' && blk.source.data) {
        images.push({ mediaType: blk.source.media_type ?? 'image/png', data: blk.source.data })
      }
    }
  }
  const t = text.trim()
  if (t) {
    if (
      t.startsWith('Base directory for this skill') ||
      INJECTED_TAG_RE.test(t) ||
      t.startsWith('[Request interrupted') ||
      t.startsWith('Caveat:')
    ) {
      return null
    }
    return { text: t, images }
  }
  // 无文字：只有带图时才算一条用户消息
  return images.length ? { text: '', images } : null
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
    const uc = userContent(o)
    if (uc !== null && o.uuid) {
      // 中断重发等会让同一条消息连续出现两次：不新增，让后续回答接到上一条
      const prev = turns[turns.length - 1]
      const prevEx = prev ? exchanges.get(prev.uuid) : undefined
      if (
        prevEx &&
        prevEx.userText === uc.text &&
        (prevEx.images?.length ?? 0) === uc.images.length
      ) {
        flush()
        curUuid = prev.uuid
        continue
      }
      flush()
      curUuid = o.uuid
      const at = o.timestamp ? Date.parse(o.timestamp) : 0
      const preview = uc.text
        ? uc.text.replace(/\s+/g, ' ').slice(0, 120)
        : `〔图片 ×${uc.images.length}〕`
      turns.push({
        uuid: o.uuid,
        at,
        preview,
        imageCount: uc.images.length || undefined
      })
      exchanges.set(o.uuid, {
        userText: uc.text,
        assistantText: '',
        at,
        images: uc.images.length ? uc.images : undefined
      })
      continue
    }
    const at2 = assistantText(o)
    if (at2 !== null && curUuid) curAssist.push(at2)
  }
  flush()

  const parsed: Parsed = { mtimeMs, sessionId, turns, exchanges }
  // 简单上限：只保留最近解析的几份（exchange 里含 base64 图片，别让缓存无限膨胀）
  if (cache.size >= 4) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(file, parsed)
  return parsed
}

export function registerSessionHandlers(): void {
  ipcMain.handle('session:index', (_e, cwd: string): SessionIndex => {
    try {
      const file = findJsonl(cwd)
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
        const file = findJsonl(cwd, sessionId)
        if (!file) return { userText: '', assistantText: '', at: 0 }
        return parse(file).exchanges.get(uuid) ?? { userText: '', assistantText: '', at: 0 }
      } catch {
        return { userText: '', assistantText: '', at: 0 }
      }
    }
  )

  // 最后一轮问答（灵动岛通知卡）。
  //
  // sessionId 是**必须优先**的：按 cwd 取「最近修改的 jsonl」在同一项目开了多个终端时会串——
  // 终端 A 答完了，取到的却是刚好后写盘的终端 B 的会话，卡片上就出现张冠李戴的回答。
  // 每个终端节点自己绑着 session id（NodeAgent.session），传进来就能锁到正确的那份。
  ipcMain.handle('session:last', (_e, cwd: string, sessionId?: string): SessionLast => {
    const empty: SessionLast = { found: false, ask: '', answer: '', at: 0 }
    try {
      const file = findJsonl(cwd, sessionId)
      if (!file) return empty
      const parsed = parse(file)
      const last = parsed.turns[parsed.turns.length - 1]
      if (!last) return empty
      const ex = parsed.exchanges.get(last.uuid)
      if (!ex) return empty
      const flat = (s: string, n: number): string => s.replace(/\s+/g, ' ').trim().slice(0, n)
      return {
        found: true,
        ask: flat(ex.userText, 90) || `〔图片 ×${ex.images?.length ?? 0}〕`,
        answer: flat(ex.assistantText, 260),
        at: ex.at
      }
    } catch {
      return empty
    }
  })
}
