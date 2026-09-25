// Host authorizes cwd with guardDir. Only fixed project-local paths are writable.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
const FIELDS = ['taskKey', 'title', 'summary', 'date', 'status', 'evidence', 'artifacts', 'author', 'originalQuestion']
function text(v, name, max) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(name + ' 长度无效')
  return v.trim()
}
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw Error('日期无效，应为 YYYY-MM-DD')
  return v
}
function strings(v, name) {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > 12) throw Error(name + ' 最多 12 项')
  return v.map(x => text(x, name, 600))
}
function validate(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !FIELDS.includes(k))) throw Error('记录字段无效')
  const taskKey = text(a.taskKey, 'taskKey', 100)
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(taskKey)) throw Error('taskKey 格式无效')
  const status = a.status ?? 'pending', evidence = strings(a.evidence, 'evidence')
  if (!['pending', 'verified', 'accepted'].includes(status)) throw Error('status 无效')
  if (status !== 'pending' && !evidence.length) throw Error('已验证/已验收必须有依据')
  return { taskKey, title: text(a.title, 'title', 160), summary: text(a.summary, 'summary', 4000), date: date(a.date), status, evidence, artifacts: strings(a.artifacts, 'artifacts'), author: a.author === undefined ? 'AI' : text(a.author, 'author', 80), ...(a.originalQuestion === undefined ? {} : { originalQuestion: text(a.originalQuestion, 'originalQuestion', 4000) }) }
}
function noLink(p) {
  try { if (fs.lstatSync(p).isSymbolicLink()) throw Error('时间线路径不能是符号链接') }
  catch (e) { if (e.code !== 'ENOENT') throw e }
}
function locations(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw Error('缺少合法项目路径')
  const dir = path.join(fs.realpathSync(cwd), '.eas'), file = path.join(dir, 'timeline.json')
  noLink(dir); noLink(file)
  return { dir, file }
}
function load(file) {
  try {
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw Error('时间线文件超过 16MB')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 20000) throw Error('时间线数据格式无效')
    const ids = new Set(), keys = new Set()
    for (const item of data.items) {
      validate(Object.fromEntries(FIELDS.map(k => [k, item[k]])))
      if (typeof item.id !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt)) || ids.has(item.id) || keys.has(item.taskKey)) throw Error('时间线记录损坏或重复')
      ids.add(item.id); keys.add(item.taskKey)
    }
    return data
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, items: [] }
    throw Error('读取时间线失败（未覆盖原文件）：' + e.message)
  }
}
export function record(cwd, args) {
  const value = validate(args), { dir, file } = locations(cwd)
  fs.mkdirSync(dir, { recursive: true }); noLink(dir)
  const lock = path.join(dir, 'timeline.lock'); noLink(lock)
  let fd
  try { fd = fs.openSync(lock, 'wx', 0o600) }
  catch (e) { if (e.code === 'EEXIST') throw Error('时间线正在写入或存在未清理锁，请检查 timeline.lock'); throw e }
  let tmp
  try {
    noLink(file)
    const data = load(file), old = data.items.find(x => x.taskKey === value.taskKey)
    if (old?.originalQuestion && value.originalQuestion === undefined) value.originalQuestion = old.originalQuestion
    if (old && old.date !== value.date) throw Error('同一成果的日期不可改变，请保留原日期')
    const changed = !old || FIELDS.some(k => JSON.stringify(old[k]) !== JSON.stringify(value[k]))
    if (!changed) return { id: old.id, created: false, changed: false, status: old.status }
    if (!old && data.items.length >= 20000) throw Error('时间线已达 20000 项上限')
    const now = new Date().toISOString(), item = { ...value, id: old?.id ?? randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now }
    if (old) data.items[data.items.indexOf(old)] = item
    else data.items.push(item)
    const serialized = JSON.stringify(data, null, 2)
    if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw Error('时间线容量超过 16MB，未写入')
    tmp = path.join(dir, '.timeline-' + randomUUID() + '.tmp')
    const out = fs.openSync(tmp, 'wx', 0o600)
    try { fs.writeFileSync(out, serialized); fs.fsyncSync(out) } finally { fs.closeSync(out) }
    noLink(dir); noLink(file); fs.renameSync(tmp, file); tmp = undefined
    return { id: item.id, created: !old, changed: true, status: item.status }
  } finally {
    if (tmp) try { fs.unlinkSync(tmp) } catch {}
    fs.closeSync(fd); fs.unlinkSync(lock)
  }
}
export function get(cwd, id) {
  text(id, 'id', 100)
  const item = load(locations(cwd).file).items.find(x => x.id === id)
  if (!item) throw Error('里程碑不存在')
  return item
}
export function list(cwd, args = {}) {
  const { month, date: day, query, taskKey } = args
  if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw Error('月份格式无效')
  if (day !== undefined) date(day)
  const limit = args.limit ?? 30, offset = args.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw Error('分页参数无效')
  if (query !== undefined && (typeof query !== 'string' || query.length > 200)) throw Error('query 无效')
  const filtered = load(locations(cwd).file).items.filter(x => (!month || x.date.startsWith(month)) && (!day || x.date === day) && (!taskKey || x.taskKey === taskKey) && (!query || x.title.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  const days = {}
  for (const x of filtered) days[x.date] = (days[x.date] ?? 0) + 1
  return { total: filtered.length, days, items: filtered.slice(offset, offset + limit).map(({ id, taskKey, title, date, status, createdAt }) => ({ id, taskKey, title, date, status, createdAt })), nextOffset: offset + limit < filtered.length ? offset + limit : null }
}
export function review(args) { return { reviewed: true, reason: text(args.reason, 'reason', 120) } }
