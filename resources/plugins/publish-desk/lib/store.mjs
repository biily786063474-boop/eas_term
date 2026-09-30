// 发布台存储：一个全局 JSON（宿主给的 EAS_PLUGIN_DATA 下），不按项目分。
// 为什么不放项目 .eas/：通用插件的模型侧调用拿不到项目 cwd（宿主只给时间线和执行清单特判），
// 为发布台再加一处特判不值 —— 发布批次本来就是跨项目的（一次宣发可能同时发两个产品）。
// 写法照执行清单：进程内排队 + 跨进程锁文件 + 锁内重读 + 临时文件 fsync 后 rename；路径上任何一段是符号链接都拒绝。
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PLATFORMS, PLATFORM_IDS, platformOf, lengthOf, joinTags } from './platforms.mjs'

const MAX_BYTES = 8 * 1024 * 1024
const LIMITS = { batches: 200, title: 300, body: 40000, tags: 60, tag: 100, media: 20, note: 2000, url: 2048 }
const STATUSES = ['draft', 'ready', 'published', 'skipped']
let queue = Promise.resolve()

export function fail(message, code = 'INVALID_INPUT') { throw Object.assign(new Error(message), { code }) }
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export function exact(value, fields, name = '参数') {
  if (!object(value) || Object.keys(value).some((k) => !fields.includes(k))) fail(`${name}含未授权字段`)
}
function str(value, name, max, { optional = false, empty = false } = {}) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${name} 无效（需为 ${max} 字以内的文本）`)
  return value
}
function tagsOf(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > LIMITS.tags) fail(`标签最多 ${LIMITS.tags} 个`)
  return value.map((t) => str(t, '标签', LIMITS.tag).replace(/^#+/, '').trim()).filter(Boolean)
}
function mediaOf(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > LIMITS.media) fail(`素材最多 ${LIMITS.media} 个`)
  return value.map((p) => {
    str(p, '素材路径', 4096)
    if (!path.isAbsolute(p)) fail('素材路径必须是绝对路径')
    return p
  })
}
function platformId(value) {
  if (!PLATFORM_IDS.includes(value)) fail(`未知平台 ${String(value)}；可用：${PLATFORM_IDS.join(' / ')}`)
  return value
}

function noLink(target) {
  try { if (fs.lstatSync(target).isSymbolicLink()) fail('发布台数据路径不能是符号链接', 'UNSAFE_PATH') }
  catch (e) { if (e.code !== 'ENOENT') throw e }
}
function location() {
  const dir = process.env.EAS_PLUGIN_DATA
  if (!dir || !path.isAbsolute(dir)) fail('宿主没有提供插件数据目录（EAS_PLUGIN_DATA）', 'NO_DATA_DIR')
  noLink(dir)
  return { dir, file: path.join(dir, 'publish-desk.json'), lock: path.join(dir, 'publish-desk.lock') }
}
function empty() { return { schema: 1, version: 0, batches: [] } }
function load(loc) {
  noLink(loc.file)
  let raw
  try {
    if (fs.statSync(loc.file).size > MAX_BYTES) fail('发布台数据超过 8 MiB', 'CORRUPT_DATA')
    raw = fs.readFileSync(loc.file, 'utf8')
  } catch (e) { if (e.code === 'ENOENT') return empty(); throw e }
  let db
  try { db = JSON.parse(raw) } catch { fail('发布台数据损坏（未覆盖原文件）', 'CORRUPT_DATA') }
  if (!object(db) || db.schema !== 1 || !Number.isSafeInteger(db.version) || !Array.isArray(db.batches)) fail('发布台数据损坏（未覆盖原文件）', 'CORRUPT_DATA')
  return db
}
function acquire(lock) {
  for (let i = 0; i < 2; i++) {
    try { return fs.openSync(lock, 'wx', 0o600) } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // 锁残留（上次进程被杀）：超过 10 秒视为失效，清掉重试一次
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (i === 0 && age > 10_000) { try { fs.unlinkSync(lock) } catch {} ; continue }
      fail('发布台正被另一个进程写入，请稍后再试', 'BUSY')
    }
  }
}
/** 读 → 改 → 写，全程排队；mutate 在锁内拿到最新数据 */
function mutate(fn) {
  const run = queue.catch(() => {}).then(() => {
    const loc = location()
    fs.mkdirSync(loc.dir, { recursive: true })
    noLink(loc.lock)
    const fd = acquire(loc.lock)
    let tmp
    try {
      const db = load(loc)
      const result = fn(db)
      db.version += 1
      const text = JSON.stringify(db, null, 2)
      if (Buffer.byteLength(text) > MAX_BYTES) fail('发布台容量超过 8 MiB，未写入；可先归档旧批次', 'CAPACITY_EXCEEDED')
      tmp = path.join(loc.dir, `.publish-desk-${randomUUID()}.tmp`)
      const t = fs.openSync(tmp, 'wx', 0o600)
      try { fs.writeFileSync(t, text); fs.fsyncSync(t) } finally { fs.closeSync(t) }
      fs.renameSync(tmp, loc.file); tmp = undefined
      return result
    } finally {
      if (tmp) try { fs.unlinkSync(tmp) } catch {}
      fs.closeSync(fd)
      try { fs.unlinkSync(loc.lock) } catch {}
    }
  })
  queue = run
  return run
}
function read() { return load(location()) }

const now = () => new Date().toISOString()
function blankCard(platform) {
  return { platform, title: '', body: '', tags: [], media: [], status: 'draft', publishedUrl: '', publishedAt: '', updatedAt: now() }
}
function cardInput(c, name) {
  exact(c, ['platform', 'title', 'body', 'tags', 'media'], name)
  return {
    platform: platformId(c.platform),
    title: str(c.title, '标题', LIMITS.title, { optional: true, empty: true }),
    body: str(c.body, '正文', LIMITS.body, { optional: true, empty: true }),
    tags: tagsOf(c.tags),
    media: mediaOf(c.media)
  }
}
function apply(card, input) {
  for (const k of ['title', 'body', 'tags', 'media']) if (input[k] !== undefined) card[k] = input[k]
  card.updatedAt = now()
}
function findBatch(db, batchId) {
  const b = db.batches.find((x) => x.batchId === batchId)
  if (!b) fail('找不到这个批次', 'NOT_FOUND')
  return b
}
function findCard(batch, platform) {
  const c = batch.cards.find((x) => x.platform === platform)
  if (!c) fail('这个批次里没有该平台的卡片', 'NOT_FOUND')
  return c
}

/** 字数检查（P1 只查长度与明确的平台规则；违禁词在 P2） */
export function lintCard(card) {
  const p = platformOf(card.platform), out = []
  const rule = (key, actual, label) => {
    const r = p.rules[key]
    if (!r || actual <= r.value) return
    out.push({ field: key === 'tagsMax' ? 'tags' : key === 'titleMax' ? 'title' : 'body', level: r.verified ? 'over' : 'warn',
      message: `${label} ${actual}/${r.value}` + (r.verified ? '' : '（参考值，以上传页提示为准）'), source: r.source })
  }
  rule('titleMax', lengthOf(card.title, p), '标题')
  rule('bodyMax', lengthOf(card.body, p), p.count === 'x-weighted' ? '正文（X 计数）' : '正文')
  rule('tagsMax', card.tags.length, '标签')
  if (card.platform === 'xiaohongshu' && /https?:\/\//.test(card.body)) out.push({ field: 'body', level: 'warn', message: '小红书正文不支持外链，链接不会生效', source: '' })
  return out
}
function view(card) {
  const p = platformOf(card.platform)
  const limit = (r) => (r ? { value: r.value, verified: r.verified } : null)
  return { ...card, name: p.name, group: p.group, p1: !!p.p1, url: p.url, notes: p.notes, tagsText: joinTags(card.tags, p),
    lengths: { title: lengthOf(card.title, p), body: lengthOf(card.body, p), tags: card.tags.length },
    limits: { title: limit(p.rules.titleMax), body: limit(p.rules.bodyMax), tags: limit(p.rules.tagsMax) }, lint: lintCard(card) }
}
function summary(b) {
  const count = (s) => b.cards.filter((c) => c.status === s).length
  return { batchId: b.batchId, title: b.title, archived: b.archived, createdAt: b.createdAt, updatedAt: b.updatedAt, total: b.cards.length, ready: count('ready'), published: count('published'), skipped: count('skipped') }
}

export function listPlatforms() {
  return PLATFORMS.map((p) => ({ id: p.id, name: p.name, group: p.group, p1: !!p.p1, url: p.url, rules: p.rules, notes: p.notes }))
}
export function addBatch(args) {
  exact(args, ['title', 'note', 'cards', 'platforms'])
  const title = str(args.title, '批次标题', 120)
  const note = str(args.note, '备注', LIMITS.note, { optional: true, empty: true }) ?? ''
  if (args.cards !== undefined && (!Array.isArray(args.cards) || args.cards.length > PLATFORMS.length)) fail('cards 无效')
  const inputs = (args.cards ?? []).map((c, i) => cardInput(c, `第 ${i + 1} 张卡片`))
  if (new Set(inputs.map((c) => c.platform)).size !== inputs.length) fail('同一平台只能有一张卡片（每个平台一个账号）')
  let ids = PLATFORM_IDS
  if (args.platforms !== undefined) {
    if (!Array.isArray(args.platforms) || !args.platforms.length) fail('platforms 无效')
    ids = [...new Set(args.platforms.map(platformId))]
  }
  for (const c of inputs) if (!ids.includes(c.platform)) ids = [...ids, c.platform]
  return mutate((db) => {
    if (db.batches.length >= LIMITS.batches) fail(`批次已达 ${LIMITS.batches} 个，请先删除旧批次`, 'CAPACITY_EXCEEDED')
    const at = now()
    const cards = PLATFORM_IDS.filter((id) => ids.includes(id)).map((id) => {
      const card = blankCard(id), input = inputs.find((c) => c.platform === id)
      if (input) apply(card, input)
      return card
    })
    const batch = { batchId: randomUUID(), title, note, archived: false, createdAt: at, updatedAt: at, cards }
    db.batches.unshift(batch)
    return { ...summary(batch), cards: cards.map(view) }
  })
}
export function updateCard(args) {
  exact(args, ['batchId', 'platform', 'title', 'body', 'tags', 'media'])
  const batchId = str(args.batchId, 'batchId', 100)
  const { batchId: _b, ...rest } = args
  const input = cardInput(rest, '卡片')
  return mutate((db) => {
    const batch = findBatch(db, batchId)
    let card = batch.cards.find((x) => x.platform === input.platform)
    if (!card) { card = blankCard(input.platform); batch.cards.push(card); batch.cards.sort((a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform)) }
    if (card.status === 'published') fail('已发布的卡片不能再改；如需重发先把状态改回草稿', 'LOCKED')
    apply(card, input)
    batch.updatedAt = card.updatedAt
    return view(card)
  })
}
export function markCard(args) {
  exact(args, ['batchId', 'platform', 'status', 'url'])
  const batchId = str(args.batchId, 'batchId', 100), platform = platformId(args.platform)
  if (!STATUSES.includes(args.status)) fail(`状态只能是 ${STATUSES.join(' / ')}`)
  const url = str(args.url, '发布链接', LIMITS.url, { optional: true, empty: true })
  if (url && !/^https?:\/\//.test(url)) fail('发布链接必须是 http(s) 地址')
  return mutate((db) => {
    const batch = findBatch(db, batchId), card = findCard(batch, platform)
    card.status = args.status
    if (args.status === 'published') { card.publishedAt = card.publishedAt || now(); if (url !== undefined) card.publishedUrl = url }
    else { card.publishedAt = ''; card.publishedUrl = '' }
    card.updatedAt = now(); batch.updatedAt = card.updatedAt
    return view(card)
  })
}
export function archiveBatch(args) {
  exact(args, ['batchId', 'archived'])
  const batchId = str(args.batchId, 'batchId', 100)
  if (typeof args.archived !== 'boolean') fail('archived 需为 true / false')
  return mutate((db) => {
    const batch = findBatch(db, batchId)
    batch.archived = args.archived; batch.updatedAt = now()
    return summary(batch)
  })
}
export function list(args = {}) {
  exact(args, ['batchId', 'includeArchived'])
  const db = read()
  if (args.batchId !== undefined) {
    const b = findBatch(db, str(args.batchId, 'batchId', 100))
    return { version: db.version, batch: { ...summary(b), note: b.note, cards: b.cards.map(view) } }
  }
  const batches = db.batches.filter((b) => args.includeArchived || !b.archived).map(summary)
  return { version: db.version, batches }
}
