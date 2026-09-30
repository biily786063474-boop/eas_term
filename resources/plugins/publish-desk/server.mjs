#!/usr/bin/env node
// 发布台：AI 把一次宣发按平台分成卡片存进来，用户在面板里逐张复制 / 打开发布页 / 手动点发布。
// 插件本身不联网、不碰任何平台账号 —— 登录态在画布网页节点里（宿主的 persist:browser），发布那一下永远是人点。
import readline from 'node:readline'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listPlatforms, addBatch, updateCard, markCard, archiveBatch, list, exact, checkText, lexicon } from './lib/store.mjs'
import { PLATFORM_IDS } from './lib/platforms.mjs'

const URI = 'ui://publish-desk/panel'
const VERSION = '0.1.0'
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const s = (maxLength) => ({ type: 'string', maxLength })
const platform = { type: 'string', enum: PLATFORM_IDS }
const card = { title: s(300), body: s(40000), tags: { type: 'array', items: s(100), maxItems: 60 }, media: { type: 'array', items: s(4096), maxItems: 20, description: '素材文件的绝对路径（须在已登记项目内，面板才能在访达里定位）' } }
const TOOLS = [
  { name: 'desk_platforms', description: '列出发布台支持的 14 个平台：发布页地址、字数上限（标明是否官方核实）与注意事项。写各平台文案前先看这里。', inputSchema: schema({}) },
  { name: 'desk_add_batch', description: '新建一个发布批次（一次宣发）。默认给全部 14 个平台各建一张卡片；cards 里给出的平台直接填上文案。每个平台只能一张卡片。', inputSchema: schema({ title: s(120), note: s(2000), platforms: { type: 'array', items: platform, minItems: 1 }, cards: { type: 'array', maxItems: 14, items: schema({ platform, ...card }, ['platform']) } }, ['title']) },
  { name: 'desk_update_card', description: '改某批次里某个平台的卡片（只改给出的字段）。已标记发布的卡片不能改。', inputSchema: schema({ batchId: s(100), platform, ...card }, ['batchId', 'platform']) },
  { name: 'desk_list', description: '不带 batchId：列出批次摘要；带 batchId：返回该批次全部卡片与字数检查结果。', inputSchema: schema({ batchId: s(100), includeArchived: { type: 'boolean' } }) },
  { name: 'desk_mark', description: '改卡片状态：draft 草稿 / ready 待发 / published 已发布（可附发布后的链接）/ skipped 不发。只在用户确认已经发出后才标 published。', inputSchema: schema({ batchId: s(100), platform, status: { type: 'string', enum: ['draft', 'ready', 'published', 'skipped'] }, url: s(2048) }, ['batchId', 'platform', 'status']) },
  { name: 'desk_check', description: '本地检查一段文案的违禁词与平台规则（绝对化用语、承诺保证、站外引流、他平台名、外部链接，以及用户自己记下的词）。每个命中带依据原文出处与建议写法。命中是提示不是禁止：绝对化用语要结合语境判断，请向用户说明理由，别替用户删改。写各平台文案后先自查。', inputSchema: schema({ text: s(40000), platform }, ['text']) },
  { name: 'desk_lexicon', description: '查看词库（list，可按 kind 过滤）；用户说某篇因为某个词被限流 / 删帖时，用 add 记下来（terms、platform、title 说明；date 默认今天）；remove 只能删用户自己记下的。', inputSchema: schema({ action: { type: 'string', enum: ['list', 'add', 'remove'] }, kind: { type: 'string', enum: ['absolute', 'guarantee', 'traffic', 'brand', 'link', 'user'] }, id: s(80), terms: { type: 'array', items: s(40), minItems: 1, maxItems: 20 }, platform, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, title: s(200), hint: s(300), suggest: s(300) }, ['action']) },
  { name: 'desk_archive', description: '归档或取消归档一个批次（不删除）。', inputSchema: schema({ batchId: s(100), archived: { type: 'boolean' } }, ['batchId', 'archived']) }
]

async function call(params) {
  exact(params, ['name', 'arguments', '_meta'], '调用')
  const args = params.arguments ?? {}
  switch (params.name) {
    case 'desk_platforms': exact(args, []); return { platforms: listPlatforms() }
    case 'desk_add_batch': return addBatch(args)
    case 'desk_update_card': return updateCard(args)
    case 'desk_list': return list(args)
    case 'desk_mark': return markCard(args)
    case 'desk_archive': return archiveBatch(args)
    case 'desk_check': return checkText(args)
    case 'desk_lexicon': return lexicon(args)
    default: throw Error('未知发布台工具')
  }
}

function send(message) { process.stdout.write(JSON.stringify(message) + '\n') }
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.id === undefined) return
  try {
    switch (m.method) {
      case 'initialize': return ok(m.id, { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'publish-desk', version: VERSION },
        instructions: '用户要把内容发到多个社媒 / 内容平台时：先 desk_platforms 看各平台限制，再 desk_add_batch 按平台写好卡片，并用 desk_check 自查违禁词与平台规则（命中是提示，向用户说明依据，由用户决定）。发布由用户在发布台面板里手动完成，不要声称已经发出。' })
      case 'ping': return ok(m.id, {})
      case 'tools/list': return ok(m.id, { tools: TOOLS })
      case 'tools/call':
        try {
          const value = await call(m.params ?? {})
          return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
        } catch (err) { return ok(m.id, { isError: true, content: [{ type: 'text', text: err.message || String(err) }] }) }
      case 'resources/list': return ok(m.id, { resources: [{ uri: URI, name: '发布台', mimeType: 'text/html;profile=mcp-app' }] })
      case 'resources/read':
        if (m.params?.uri !== URI) throw Error('未知资源')
        return ok(m.id, { contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: fs.readFileSync(fileURLToPath(new URL('./ui/panel.html', import.meta.url)), 'utf8') }] })
      default: return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: '不支持的方法' } })
    }
  } catch (err) { send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: err.message || String(err) } }) }
})
