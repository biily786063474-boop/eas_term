#!/usr/bin/env node
// Opus 作品画廊 · MCP stdio server。手写极简 JSON-RPC（照 resources/plugins/timeline/server.mjs），零依赖。
// 个人插件：源码在 plugins-dev/，用 scripts/install-dev-plugin.sh 装到 ~/.eas/plugins/，不随安装包分发。
// 设计稿：docs/superpowers/specs/2026-09-28-opus-gallery-design.md
import readline from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, filterPage, tagCounts, composeInjection, DEFAULT_PRESETS, savePreset, deletePreset } from './lib/core.mjs'
import { createStore, DATA_URL, MEDIA_BASE } from './lib/store.mjs'

const URI = 'ui://opus-gallery/panel'
const MIME = 'text/html;profile=mcp-app'
const dir = process.env.EAS_PLUGIN_DATA || path.join(os.homedir(), '.eas', 'plugin-data', 'opus-gallery')
const store = createStore({ dir, dataUrl: process.env.OPUS_GALLERY_DATA_URL || DATA_URL, mediaBase: process.env.OPUS_GALLERY_MEDIA_BASE || MEDIA_BASE })
const presetsFile = path.join(dir, 'presets.json')

function loadPresets() {
  try {
    const v = JSON.parse(fs.readFileSync(presetsFile, 'utf8'))
    if (Array.isArray(v)) return v
  } catch {}
  return DEFAULT_PRESETS.map((p) => ({ ...p }))
}
function writePresets(list) {
  const tmp = `${presetsFile}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, presetsFile)
  return { presets: list }
}

const str = { type: 'string' }
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const TOOLS = [
  { name: 'gallery_show', description: '打开 Opus 作品画廊面板', inputSchema: obj(), _meta: { 'ui/resourceUri': URI } },
  { name: 'gallery_list', description: '按分类/技术标签分页列出作品（不含图片与全文提示词）', inputSchema: obj({ category: str, tag: str, page: { type: 'integer', minimum: 0 }, refresh: { type: 'boolean' } }) },
  { name: 'gallery_images', description: '取作品封面或预览动图（data URL），一次最多 12 个', inputSchema: obj({ kind: { type: 'string', enum: ['poster', 'preview'] }, slugs: { type: 'array', items: str, maxItems: 12 } }, ['kind', 'slugs']) },
  { name: 'gallery_detail', description: '取一件作品的完整信息与原提示词', inputSchema: obj({ slug: str }, ['slug']) },
  { name: 'gallery_compose', description: '以某件作品为风格参考、按主题拼出注入对话的指令', inputSchema: obj({ slug: str, topic: str, presetId: str }, ['slug', 'topic']) },
  { name: 'gallery_presets', description: '列出附加约束预设', inputSchema: obj() },
  { name: 'gallery_preset_save', description: '新建或更新附加约束预设', inputSchema: obj({ id: str, name: str, text: str }, ['name', 'text']) },
  { name: 'gallery_preset_delete', description: '删除附加约束预设', inputSchema: obj({ id: str }, ['id']) }
]

async function find(slug) {
  const e = (await store.ensure()).find((x) => x.slug === String(slug ?? ''))
  if (!e) throw new Error(`没有这件作品：${slug}`)
  return e
}

async function call(name, a = {}) {
  switch (name) {
    case 'gallery_show':
      return { opened: true }
    case 'gallery_list': {
      if (a.refresh) await store.sync()
      const all = await store.ensure()
      const pg = filterPage(all, a)
      return {
        ...store.status(),
        categories: CATEGORIES,
        tags: tagCounts(all),
        page: pg.page,
        pages: pg.pages,
        total: pg.total,
        items: pg.items.map((e) => ({ slug: e.slug, author: e.author, category: e.category, tags: e.tags, partial: e.partial }))
      }
    }
    case 'gallery_images': {
      const slugs = Array.isArray(a.slugs) ? a.slugs.map(String) : []
      if (slugs.length > 12) throw new Error('一次最多取 12 张')
      const all = await store.ensure()
      const pairs = await Promise.all(slugs.map(async (s) => {
        const e = all.find((x) => x.slug === s)
        return [s, e ? await store.image(a.kind, e) : '']
      }))
      return { images: Object.fromEntries(pairs) }
    }
    case 'gallery_detail': {
      const e = await find(a.slug)
      return { slug: e.slug, author: e.author, postUrl: e.postUrl, category: e.category, tags: e.tags, partial: e.partial, prompt: e.prompt, added: e.added }
    }
    case 'gallery_compose': {
      const e = await find(a.slug)
      const preset = a.presetId ? loadPresets().find((p) => p.id === a.presetId) : null
      if (a.presetId && !preset) throw new Error('这个附加约束预设已不存在，请重新选择')
      return composeInjection(e, a.topic, preset)
    }
    case 'gallery_presets':
      return { presets: loadPresets() }
    case 'gallery_preset_save':
      return writePresets(savePreset(loadPresets(), a))
    case 'gallery_preset_delete':
      return writePresets(deletePreset(loadPresets(), String(a.id ?? '')))
    default:
      throw new Error(`未知工具 ${name}`)
  }
}

/** content[0].text 给模型看：gallery_images 的 base64（最多 12 张、上 MB）只放 structuredContent，
 *  文本里只留 slug → 有没有图，免得 agent 调一次就灌进几 MB 上下文（最终审查 M-1）。面板读 structuredContent。 */
function summaryText(name, data) {
  if (name === 'gallery_images') return JSON.stringify({ images: Object.fromEntries(Object.entries(data.images).map(([k, v]) => [k, !!v])) })
  return JSON.stringify(data)
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')

async function handle(m) {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'opus-gallery', version: '0.1.0' } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call':
      try {
        const data = await call(m.params?.name, m.params?.arguments ?? {})
        return { content: [{ type: 'text', text: summaryText(m.params?.name, data) }], structuredContent: data }
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: String(e?.message ?? e) }] }
      }
    case 'resources/list':
      return { resources: [{ uri: URI, name: 'Opus 画廊', mimeType: MIME }] }
    case 'resources/read':
      if (m.params?.uri !== URI) throw Object.assign(new Error('未知资源'), { code: -32602 })
      return { contents: [{ uri: URI, mimeType: MIME, text: fs.readFileSync(fileURLToPath(new URL('./ui/panel.html', import.meta.url)), 'utf8') }] }
    default:
      throw Object.assign(new Error('不支持的方法'), { code: -32601 })
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.id === undefined) return
  handle(m).then(
    (result) => send({ jsonrpc: '2.0', id: m.id, result }),
    (e) => send({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? -32603, message: String(e?.message ?? e) } })
  )
})
