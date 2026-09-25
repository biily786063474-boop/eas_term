#!/usr/bin/env node
import readline from 'node:readline'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPlan, getPlan, listPlans, updateStep, archivePlan, acceptStep } from './lib/store.mjs'

const URI = 'ui://execution-plan/panel'
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength })
const step = schema({ title: str(), criterion: str(500) }, ['title', 'criterion'])
const version = { type: 'integer', minimum: 0 }
const TOOLS = [
  { name: 'plan_create', description: '多步骤执行任务开始操作前，在当前轮次建立 2–20 步可验收清单；不要把每条命令拆成步骤。普通问答与单步操作无需建。', inputSchema: schema({ title: str(), steps: { type: 'array', items: step, minItems: 2, maxItems: 20 } }, ['title', 'steps']) },
  { name: 'plan_get', description: '按 ID 读取一份执行计划，继续已有工作时先查当前步骤。', inputSchema: schema({ planId: str(100) }, ['planId']) },
  { name: 'plan_list', description: '分页查询当前项目执行计划摘要；默认只看当前会话，不扫描全部历史。', inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0 }, allSessions: { type: 'boolean' } }) },
  { name: 'step_update', description: '推进/阻塞/报告完成步骤，或追加、调整未完成步骤；模型报告完成不等于用户验收。', inputSchema: schema({ planId: str(100), stepId: str(100), status: { type: 'string', enum: ['pending', 'in_progress', 'blocked', 'reported_done'] }, title: str(), criterion: str(500), append: { type: 'array', items: step, minItems: 1, maxItems: 20 }, evidence: str(1000), expectedVersion: version }, ['planId', 'expectedVersion']) },
  { name: 'plan_archive', description: '将不再继续的计划归档，不删除历史。', inputSchema: schema({ planId: str(100), expectedVersion: version }, ['planId', 'expectedVersion']) }
]
function exact(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('工具参数含未授权字段')
}
function context(params, model = false) {
  const ctx = params?._meta?.eas?.context
  if (!ctx || typeof ctx.cwd !== 'string' || !ctx.cwd) throw Error('缺少宿主项目上下文')
  if (model && (typeof ctx.sessionId !== 'string' || !ctx.sessionId || typeof ctx.turnId !== 'string' || !ctx.turnId)) throw Error('缺少受管会话轮次')
  return ctx
}
function receipt(plan) {
  return { planId: plan.planId, version: plan.version, status: plan.status, title: plan.title, steps: plan.steps.map(step => ({ stepId: step.stepId, title: step.title, status: step.status, accepted: step.accepted })) }
}
async function modelTool(params) {
  const ctx = context(params, true), args = params.arguments ?? {}
  const identity = { sessionId: ctx.sessionId, turnId: ctx.turnId }
  switch (params.name) {
    case 'plan_create':
      exact(args, ['title', 'steps'])
      return receipt(await createPlan(ctx.cwd, identity, args))
    case 'plan_get':
      exact(args, ['planId'])
      return getPlan(ctx.cwd, args.planId)
    case 'plan_list':
      exact(args, ['limit', 'offset', 'allSessions'])
      return listPlans(ctx.cwd, { limit: args.limit, offset: args.offset, ...(!args.allSessions ? { sessionId: ctx.sessionId } : {}) })
    case 'step_update':
      exact(args, ['planId', 'stepId', 'status', 'title', 'criterion', 'append', 'evidence', 'expectedVersion'])
      return receipt(await updateStep(ctx.cwd, identity, args))
    case 'plan_archive':
      exact(args, ['planId', 'expectedVersion'])
      return receipt(await archivePlan(ctx.cwd, identity, args))
    default: throw Error('未知执行清单工具')
  }
}
async function panelMethod(method, params) {
  const { cwd } = context(params)
  const { _meta, ...args } = params
  switch (method) {
    case 'panel/list': return listPlans(cwd, args)
    case 'panel/get': return getPlan(cwd, args.planId)
    case 'panel/accept': return receipt(await acceptStep(cwd, args))
    case 'panel/update': return receipt(await updateStep(cwd, { sessionId: 'panel', turnId: 'panel' }, args))
    case 'panel/archive': return receipt(await archivePlan(cwd, { sessionId: 'panel', turnId: 'panel' }, args))
    default: throw Error('未知面板操作')
  }
}
function send(message) { process.stdout.write(JSON.stringify(message) + '\n') }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }) }
function error(id, err) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message || String(err) } }) }
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return
  try {
    switch (m.method) {
      case 'initialize': return ok(m.id, { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'execution-plan', version: '1.0.0' }, instructions: '多步骤任务在开始操作前同轮调用 plan_create，推进时用 step_update；普通问答不建清单。仅在成功回执后报告清单变化。' })
      case 'ping': return ok(m.id, {})
      case 'tools/list': return ok(m.id, { tools: TOOLS })
      case 'tools/call': {
        try {
          const value = await modelTool(m.params ?? {})
          return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
        } catch (err) { return ok(m.id, { isError: true, content: [{ type: 'text', text: err.message || String(err) }] }) }
      }
      case 'resources/list': return ok(m.id, { resources: [{ uri: URI, name: '执行清单', mimeType: 'text/html;profile=mcp-app' }] })
      case 'resources/read':
        if (m.params?.uri !== URI) throw Error('未知资源')
        return ok(m.id, { contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: fs.readFileSync(fileURLToPath(new URL('./ui/panel.html', import.meta.url)), 'utf8') }] })
      case 'panel/list': case 'panel/get': case 'panel/accept': case 'panel/update': case 'panel/archive': return ok(m.id, await panelMethod(m.method, m.params ?? {}))
      default: return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: '不支持的方法' } })
    }
  } catch (err) { error(m.id, err) }
})
