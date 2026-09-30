// 发布台存储：一个全局 JSON（宿主给的 EAS_PLUGIN_DATA 下），不按项目分。
// 为什么不放项目 .eas/：通用插件的模型侧调用拿不到项目 cwd（宿主只给时间线和执行清单特判），
// 为发布台再加一处特判不值 —— 发布批次本来就是跨项目的（一次宣发可能同时发两个产品）。
// 写法照执行清单：进程内排队 + 跨进程锁文件 + 锁内重读 + 临时文件 fsync 后 rename；路径上任何一段是符号链接都拒绝。
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PLATFORMS, PLATFORM_IDS, platformOf, lengthOf, joinTags } from './platforms.mjs'
import { compile, check, validateEntry, KIND_LABEL } from './lexicon.mjs'
import { builtin, builtinEntries } from './builtin.mjs'
import { checkCardMedia, mediaChecklist } from './mediaCheck.mjs'

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
function empty() { return { schema: 1, version: 0, batches: [], lexicon: [] } }
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
  if (db.lexicon === undefined) db.lexicon = []   // P1 写下的文件没有这一项
  if (!Array.isArray(db.lexicon)) fail('发布台数据损坏：lexicon 不是数组（未覆盖原文件）', 'CORRUPT_DATA')
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

/** 内置词库 + 用户自己记下的词条，编译好的一份 */
function rulesOf(db) {
  const user = db.lexicon.length ? compile(db.lexicon) : []
  return [...builtin(), ...user]
}
/** 违禁词 / 平台规则检查：标题、正文、标签分别查，命中带字段名 */
export function hitsOf(card, rules) {
  const p = platformOf(card.platform)
  return [
    ...check(card.title, rules, { platform: card.platform, field: 'title' }),
    ...check(card.body, rules, { platform: card.platform, field: 'body' }),
    ...check(joinTags(card.tags, p), rules, { platform: card.platform, field: 'tags' })
  ]
}

/** 字数检查（长度与平台明文规则）；词库命中另见 hitsOf */
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
  return out
}
function view(card, rules) {
  const p = platformOf(card.platform)
  const limit = (r) => (r ? { value: r.value, verified: r.verified } : null)
  return { ...card, name: p.name, group: p.group, p1: !!p.p1, url: p.url, notes: p.notes, tagsText: joinTags(card.tags, p),
    lengths: { title: lengthOf(card.title, p), body: lengthOf(card.body, p), tags: card.tags.length },
    limits: { title: limit(p.rules.titleMax), body: limit(p.rules.bodyMax), tags: limit(p.rules.tagsMax) }, lint: lintCard(card), hits: hitsOf(card, rules),
    // 素材：逐个读文件头（有缓存）并对照平台素材规格；checklist / cover 是这个平台要准备什么
    mediaCheck: { ...checkCardMedia(card.media, p.media), checklist: mediaChecklist(p.media), cover: p.media?.cover ?? null } }
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
    const rules = rulesOf(db)
    return { ...summary(batch), cards: cards.map((c) => view(c, rules)) }
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
    return view(card, rulesOf(db))
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
    return view(card, rulesOf(db))
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
    const rules = rulesOf(db)
    return { version: db.version, batch: { ...summary(b), note: b.note, cards: b.cards.map((c) => view(c, rules)) } }
  }
  const batches = db.batches.filter((b) => args.includeArchived || !b.archived).map(summary)
  return { version: db.version, batches }
}

/** 检一段任意文本（AI 写稿时先自查用）。不给平台就按全部平台的规则查 */
export function checkText(args) {
  exact(args, ['text', 'platform'])
  const text = str(args.text, '文本', LIMITS.body, { empty: true })
  const platform = args.platform === undefined ? undefined : platformId(args.platform)
  const rules = rulesOf(read())
  const hits = check(text, rules, { platform })
  return { platform: platform ?? 'all', count: hits.length, hits,
    note: '命中是提示不是禁止：绝对化用语要看语境（执法指南列了不算违法的情形），平台规则以各平台现行规范为准；最终由你决定。' }
}

/** 词库：列出（内置 + 我记下的）/ 记一条 / 删一条（只能删我记下的） */
export function lexicon(args) {
  exact(args, ['action', 'id', 'terms', 'platform', 'date', 'title', 'hint', 'suggest', 'kind'])
  if (args.action === 'list') {
    const db = read()
    const brief = (e, source) => ({ id: e.id, source, kind: e.kind, kindLabel: KIND_LABEL[e.kind], level: e.level, confidence: e.confidence, platforms: e.platforms,
      terms: e.terms, pattern: e.pattern, hint: e.hint, suggest: e.suggest, context: e.context, basis: e.basis })
    const kinds = args.kind === undefined ? null : [args.kind]
    return { entries: [...builtinEntries().map((e) => brief(e, 'builtin')), ...db.lexicon.map((e) => brief(e, 'user'))].filter((e) => !kinds || kinds.includes(e.kind)) }
  }
  if (args.action === 'add') {
    if (!Array.isArray(args.terms) || !args.terms.length || args.terms.length > 20) fail('terms 需为 1–20 个词')
    const entry = {
      id: `user-${randomUUID().slice(0, 8)}`, kind: 'user', level: 'medium', confidence: 'observed', platforms: [platformId(args.platform)],
      terms: args.terms.map((t) => str(t, '词', 40).trim()), loose: true,
      basis: { title: str(args.title, '说明（比如「这篇笔记被限流」）', 200), date: args.date ?? now().slice(0, 10), platform: args.platform },
      hint: str(args.hint, '提示', 300, { optional: true }) ?? '你之前在这个平台因为它被限流 / 删帖过',
      ...(args.suggest !== undefined ? { suggest: str(args.suggest, '建议写法', 300) } : {})
    }
    validateEntry(entry)
    return mutate((db) => { if (db.lexicon.length >= 500) fail('我记下的词条已达 500 条'); db.lexicon.push(entry); return entry })
  }
  if (args.action === 'remove') {
    const id = str(args.id, 'id', 80)
    if (!id.startsWith('user-')) fail('内置词条不能删；觉得它误报，可以告诉 AI 在对话里解释语境')
    return mutate((db) => {
      const i = db.lexicon.findIndex((e) => e.id === id)
      if (i < 0) fail('找不到这条', 'NOT_FOUND')
      return { removed: db.lexicon.splice(i, 1)[0].id }
    })
  }
  fail('action 只能是 list / add / remove')
}
