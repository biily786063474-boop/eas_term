import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_BYTES = 4 * 1024 * 1024
const states = new Set(['pending', 'in_progress', 'blocked', 'reported_done'])
const transitions = {
  pending: new Set(['in_progress', 'blocked', 'reported_done']),
  in_progress: new Set(['pending', 'blocked', 'reported_done']),
  blocked: new Set(['pending', 'in_progress']),
  reported_done: new Set(['in_progress'])
}
const queues = new Map()

function fail(message, code = 'INVALID_INPUT') {
  throw Object.assign(new Error(message), { code })
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value, name, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name} 无效`)
  return value.trim()
}
function optionalText(value, name, max = 1000) {
  return value === undefined ? undefined : text(value, name, max)
}
function exact(value, fields, name) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) fail(`${name} 字段无效`)
}
function noLink(target) {
  try { if (fs.lstatSync(target).isSymbolicLink()) fail('执行计划路径不能是符号链接', 'UNSAFE_PATH') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
function location(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) fail('项目路径无效')
  noLink(cwd)
  const root = fs.realpathSync(cwd)
  if (!fs.statSync(root).isDirectory()) fail('项目路径不是目录')
  const dir = path.join(root, '.eas')
  const file = path.join(dir, 'execution-plans.json')
  noLink(dir); noLink(file)
  return { root, dir, file }
}
function validStep(value) {
  exact(value, ['stepId', 'title', 'criterion', 'status', 'accepted', 'evidence', 'history', 'createdAt', 'updatedAt'], '步骤')
  text(value.stepId, 'stepId', 100); text(value.title, '步骤标题'); text(value.criterion, '完成判据', 500)
  if (!states.has(value.status) || typeof value.accepted !== 'boolean' || !Array.isArray(value.history) || value.history.length > 500 || !Array.isArray(value.evidence) || value.evidence.length > 30) fail('步骤数据损坏', 'CORRUPT_DATA')
  if (value.evidence.some(v => typeof v !== 'string' || v.length > 1000) || value.history.some(v => !object(v) || typeof v.at !== 'string' || typeof v.status !== 'string')) fail('步骤历史损坏', 'CORRUPT_DATA')
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) fail('步骤时间损坏', 'CORRUPT_DATA')
}
function validPlan(value) {
  exact(value, ['planId', 'sessionId', 'sourceTurnId', 'ownerKey', 'title', 'status', 'steps', 'createdAt', 'updatedAt'], '计划')
  text(value.planId, 'planId', 100); text(value.sessionId, 'sessionId', 200); text(value.sourceTurnId, 'sourceTurnId', 200); text(value.title, '计划标题')
  if (value.ownerKey !== undefined) text(value.ownerKey, 'ownerKey', 240)
  if (!['active', 'archived', 'completed', 'terminated'].includes(value.status) || !Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 100) fail('计划数据损坏', 'CORRUPT_DATA')
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) fail('计划时间损坏', 'CORRUPT_DATA')
  const ids = new Set()
  for (const step of value.steps) { validStep(step); if (ids.has(step.stepId)) fail('步骤 ID 重复', 'CORRUPT_DATA'); ids.add(step.stepId) }
}
function load(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) fail('执行计划文件超过 4 MiB', 'CORRUPT_DATA')
    const db = JSON.parse(fs.readFileSync(file, 'utf8'))
    exact(db, ['schema', 'version', 'plans'], '执行计划库')
    if (db.schema !== 1 || !Number.isSafeInteger(db.version) || db.version < 0 || !Array.isArray(db.plans) || db.plans.length > 5000) fail('执行计划库损坏', 'CORRUPT_DATA')
    const ids = new Set(), turns = new Set()
    for (const plan of db.plans) {
      validPlan(plan)
      const source = `${plan.sessionId}\0${plan.sourceTurnId}`
      if (ids.has(plan.planId) || turns.has(source)) fail('计划 ID 或来源轮次重复', 'CORRUPT_DATA')
      ids.add(plan.planId); turns.add(source)
    }
    return db
  } catch (error) {
    if (error.code === 'ENOENT') return { schema: 1, version: 0, plans: [] }
    if (error.code === 'CORRUPT_DATA') throw error
    fail(`读取执行计划失败（未覆盖原文件）：${error.message}`, 'CORRUPT_DATA')
  }
}
function inputStep(value) {
  exact(value, ['title', 'criterion'], '新步骤')
  return { title: text(value.title, '步骤标题'), criterion: text(value.criterion, '完成判据', 500) }
}
function makeStep(value, now) {
  return { stepId: randomUUID(), ...inputStep(value), status: 'pending', accepted: false, evidence: [], history: [], createdAt: now, updatedAt: now }
}
function trusted(value) {
  exact(value, ['sessionId', 'turnId', 'ownerKey'], '会话')
  return { sessionId: text(value.sessionId, 'sessionId', 200), turnId: text(value.turnId, 'turnId', 200), ownerKey: value.ownerKey === undefined ? undefined : text(value.ownerKey, 'ownerKey', 240) }
}
function ownerKey(value) {
  const key = text(value, 'ownerKey', 240)
  if (!/^(node|session):[^:]+$/.test(key)) fail('计划归属无效')
  return key
}
function assertOwner(plan, key) {
  if (plan.ownerKey !== key) fail('计划归属不匹配', 'OWNER_MISMATCH')
}
function version(db, expected) {
  if (!Number.isSafeInteger(expected) || db.version !== expected) fail('计划已由其他会话更新', 'VERSION_CONFLICT')
}
function byId(db, id) {
  const plan = db.plans.find(item => item.planId === id)
  if (!plan) fail('计划不存在', 'NOT_FOUND')
  return plan
}
function clone(value) { return structuredClone(value) }
function withProjectLock(root, work) {
  const previous = queues.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(work)
  queues.set(root, next)
  void next.finally(() => { if (queues.get(root) === next) queues.delete(root) }).catch(() => {})
  return next
}
function save(loc, db) {
  fs.mkdirSync(loc.dir, { recursive: true })
  noLink(loc.dir); noLink(loc.file)
  const lock = path.join(loc.dir, 'execution-plans.lock')
  noLink(lock)
  let lockFd, tmp
  try {
    lockFd = fs.openSync(lock, 'wx', 0o600)
    // Re-read inside cross-process lock. In-process callers are serialized above.
    const latest = load(loc.file)
    if (latest.version !== db.version - 1) fail('计划已由其他进程更新', 'VERSION_CONFLICT')
    const serialized = JSON.stringify(db, null, 2)
    if (Buffer.byteLength(serialized) > MAX_BYTES) fail('执行计划容量超过 4 MiB，未写入', 'CAPACITY_EXCEEDED')
    tmp = path.join(loc.dir, `.execution-plans-${randomUUID()}.tmp`)
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    noLink(loc.dir); noLink(loc.file)
    fs.renameSync(tmp, loc.file); tmp = undefined
  } finally {
    if (tmp) try { fs.unlinkSync(tmp) } catch {}
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lock) }
  }
}
async function mutate(cwd, action) {
  const loc = location(cwd)
  return withProjectLock(loc.root, () => {
    const db = load(loc.file)
    const result = action(db)
    if (!result.changed) return clone(result.value)
    db.version += 1
    db.plans.forEach(plan => { if (plan === result.value) plan.updatedAt = new Date().toISOString() })
    save(loc, db)
    return { ...clone(result.value), version: db.version }
  })
}
export async function createPlan(cwd, identity, input) {
  const source = trusted(identity)
  source.ownerKey = ownerKey(source.ownerKey)
  exact(input, ['title', 'steps'], '计划输入')
  const title = text(input.title, '计划标题')
  if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 20) fail('计划需要 2–20 个步骤')
  const steps = input.steps.map(inputStep)
  return mutate(cwd, db => {
    const old = db.plans.find(plan => plan.sessionId === source.sessionId && plan.sourceTurnId === source.turnId)
    if (old) { assertOwner(old, source.ownerKey); return { changed: false, value: { ...old, version: db.version } } }
    const now = new Date().toISOString()
    const plan = { planId: randomUUID(), sessionId: source.sessionId, sourceTurnId: source.turnId, ownerKey: source.ownerKey, title, status: 'active', steps: steps.map(step => makeStep(step, now)), createdAt: now, updatedAt: now }
    db.plans.push(plan)
    return { changed: true, value: plan }
  })
}
export function getPlan(cwd, planId, identity) {
  const db = load(location(cwd).file), plan = byId(db, text(planId, 'planId', 100))
  if (identity) assertOwner(plan, ownerKey(trusted(identity).ownerKey))
  return { ...clone(plan), version: db.version }
}
export function listPlans(cwd, args = {}) {
  exact(args, ['sessionId', 'ownerKey', 'limit', 'offset'], '查询')
  const limit = args.limit ?? 30, offset = args.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) fail('分页参数无效')
  if (args.sessionId !== undefined) text(args.sessionId, 'sessionId', 200)
  const db = load(location(cwd).file)
  const plans = db.plans.filter(plan => (!args.sessionId || plan.sessionId === args.sessionId) && (!args.ownerKey || plan.ownerKey === ownerKey(args.ownerKey))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { total: plans.length, version: db.version, items: clone(plans.slice(offset, offset + limit).map(plan => ({ planId: plan.planId, sessionId: plan.sessionId, title: plan.title, status: plan.status, done: plan.steps.filter(step => step.status === 'reported_done').length, total: plan.steps.length, createdAt: plan.createdAt }))), nextOffset: offset + limit < plans.length ? offset + limit : null }
}
export async function updateStep(cwd, identity, input) {
  const source = trusted(identity)
  exact(input, ['planId', 'stepId', 'status', 'title', 'criterion', 'append', 'evidence', 'expectedVersion'], '步骤更新')
  return mutate(cwd, db => {
    version(db, input.expectedVersion)
    const plan = byId(db, text(input.planId, 'planId', 100))
    if (source.ownerKey !== undefined) assertOwner(plan, ownerKey(source.ownerKey))
    if (plan.status !== 'active') fail('非活动计划不可更新')
    const now = new Date().toISOString()
    if (input.stepId === undefined) {
      if (!Array.isArray(input.append) || !input.append.length || input.append.length > 20 || Object.keys(input).some(key => !['planId', 'append', 'expectedVersion'].includes(key))) fail('追加步骤参数无效')
      if (plan.steps.length + input.append.length > 100) fail('步骤超过上限')
      plan.steps.push(...input.append.map(step => makeStep(step, now)))
    } else {
      if (input.append !== undefined) fail('不能同时追加和编辑步骤')
      const step = plan.steps.find(item => item.stepId === input.stepId)
      if (!step) fail('步骤不存在', 'NOT_FOUND')
      if (step.status === 'reported_done' && (input.title !== undefined || input.criterion !== undefined)) fail('完成步骤请先撤回再编辑')
      if (input.status !== undefined) {
        if (!states.has(input.status) || (input.status !== step.status && !transitions[step.status].has(input.status))) fail('步骤状态转换无效')
        step.status = input.status
        if (input.status !== 'reported_done') step.accepted = false
      }
      if (input.title !== undefined) step.title = text(input.title, '步骤标题')
      if (input.criterion !== undefined) step.criterion = text(input.criterion, '完成判据', 500)
      const evidence = optionalText(input.evidence, '依据')
      if (evidence) step.evidence.push(evidence)
      if (step.evidence.length > 30) fail('依据超过上限')
      step.history.push({ at: now, status: step.status, ...(evidence ? { evidence } : {}) })
      step.updatedAt = now
    }
    return { changed: true, value: plan }
  })
}
export async function archivePlan(cwd, identity, input) {
  const source = trusted(identity)
  exact(input, ['planId', 'expectedVersion'], '归档')
  return mutate(cwd, db => {
    version(db, input.expectedVersion)
    const plan = byId(db, text(input.planId, 'planId', 100))
    if (source.ownerKey !== undefined) assertOwner(plan, ownerKey(source.ownerKey))
    if (plan.status !== 'active') fail('仅活动计划可归档')
    plan.status = 'archived'
    return { changed: true, value: plan }
  })
}
export async function acceptStep(cwd, input) {
  exact(input, ['planId', 'stepId', 'accepted', 'expectedVersion'], '验收')
  return mutate(cwd, db => {
    version(db, input.expectedVersion)
    const plan = byId(db, text(input.planId, 'planId', 100))
    const step = plan.steps.find(item => item.stepId === text(input.stepId, 'stepId', 100))
    if (!step) fail('步骤不存在', 'NOT_FOUND')
    if (plan.status !== 'active' || step.status !== 'reported_done' || typeof input.accepted !== 'boolean') fail('仅可验收模型已报告完成的活动步骤')
    step.accepted = input.accepted
    step.updatedAt = new Date().toISOString()
    step.history.push({ at: step.updatedAt, status: step.status, accepted: input.accepted })
    return { changed: true, value: plan }
  })
}

function card(plan, version) {
  return { planId: plan.planId, title: plan.title, status: plan.status, version, steps: plan.steps.map(({ stepId, title, status, accepted }) => ({ stepId, title, status, accepted })) }
}
export function cardForOwner(cwd, key) {
  const db = load(location(cwd).file)
  const plan = db.plans.filter(item => item.ownerKey === ownerKey(key) && item.status === 'active').at(-1)
  return plan ? card(plan, db.version) : null
}
export async function cardAccept(cwd, input) {
  exact(input, ['ownerKey', 'planId', 'stepId', 'accepted', 'expectedVersion', 'completeNow'], '卡片验收')
  return mutate(cwd, db => {
    version(db, input.expectedVersion)
    const plan = byId(db, text(input.planId, 'planId', 100))
    assertOwner(plan, ownerKey(input.ownerKey))
    const step = plan.steps.find(item => item.stepId === text(input.stepId, 'stepId', 100))
    if (!step) fail('步骤不存在', 'NOT_FOUND')
    if (plan.status !== 'active' || step.status !== 'reported_done' || typeof input.accepted !== 'boolean') fail('仅可验收模型已报告完成的活动步骤')
    if (typeof input.completeNow !== 'boolean') fail('完成条件无效')
    step.accepted = input.accepted
    step.updatedAt = new Date().toISOString()
    step.history.push({ at: step.updatedAt, status: step.status, accepted: input.accepted })
    if (input.completeNow && plan.steps.every(item => item.accepted)) plan.status = 'completed'
    return { changed: true, value: plan }
  })
}
export async function completePlan(cwd, input) {
  exact(input, ['ownerKey', 'planId', 'expectedVersion'], '完成计划')
  return mutate(cwd, db => {
    version(db, input.expectedVersion)
    const plan = byId(db, text(input.planId, 'planId', 100))
    assertOwner(plan, ownerKey(input.ownerKey))
    if (plan.status !== 'active' || !plan.steps.every(step => step.accepted)) fail('计划尚未全部验收')
    plan.status = 'completed'
    return { changed: true, value: plan }
  })
}
export async function terminatePlan(cwd, input) {
  exact(input, ['ownerKey', 'planId', 'expectedVersion'], '终止计划')
  return mutate(cwd, db => {
    const plan = byId(db, text(input.planId, 'planId', 100))
    assertOwner(plan, ownerKey(input.ownerKey))
    if (plan.status === 'terminated') return { changed: false, value: { ...plan, version: db.version } }
    version(db, input.expectedVersion)
    if (plan.status !== 'active') fail('仅活动计划可终止')
    plan.status = 'terminated'
    return { changed: true, value: plan }
  })
}
