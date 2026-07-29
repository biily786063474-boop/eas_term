// 名词词典的用户自建词条：~/.eas/dict-user.json
//
// 「提交即复盘」钩子扫出「用了但词典没收录」的术语后，**不再自己写半截词条**——
// 那样产出的是一堆只有英文名、没解释没图的空壳，混在 242 条完整词条里很难看，
// 也帮不上任何忙。现在改成：钩子只把候选记进待办，由 agent 补全成
// 和内置词条**完全同构**的条目（zh/en/category/keywords/logic/svg），再经 dict_add 写入。
//
// 代价是这条链路**要花 token**（模型得写解释和示意图），所以功能默认关闭，
// 开启前界面上必须把这件事说清楚。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import type { DictPending, DictSinkStatus, UserTerm } from '../shared/types'

const userFile = (): string => path.join(os.homedir(), '.eas', 'dict-user.json')
/** 钩子扫出来、等 agent 补全的候选 */
const pendingFile = (): string => path.join(os.homedir(), '.eas', 'dict-pending.json')
/** 补全开关。钩子脚本自己也读这个文件——关着就连候选都不记，彻底零开销 */
const sinkFile = (): string => path.join(os.homedir(), '.eas', 'dict-sink.json')

const CATS = new Set(['interaction', 'motion', 'visual'])

/**
 * 补全开关默认 **关**。
 *
 * 单独一个开关、而不是跟着钩子安装走：钩子是按「纯脚本，不花 token」的说法装的，
 * 现在补全要让模型写解释和示意图，是**要花钱的**。拿当初那次同意去顶这次的消费，
 * 无论从产品还是合规角度都不成立。已经装了钩子的人，这一项照样是关的。
 */
function sinkEnabled(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(sinkFile(), 'utf8')) as { enabled?: unknown }
    return raw.enabled === true
  } catch {
    return false
  }
}

/**
 * 清洗模型生成的 SVG。
 *
 * 这一步不能省：词条的 svg 走 dangerouslySetInnerHTML 渲染，
 * 而这段内容是**模型写的**——脚本、事件属性、外链引用一旦漏过去就是执行口子。
 * 采白名单思路的简化版：掐掉危险标签和属性，再要求整体是一个 <svg> 元素。
 */
function sanitizeSvg(raw: unknown): string {
  let s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return ''
  if (!/^<svg[\s>]/i.test(s)) return '' // 不是 svg 就整个丢掉，别猜
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(iframe|object|embed|link|style|image|use)\b[^>]*>/gi, '')
    // on* 事件属性（onclick / onload / onmouseover …）
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    // javascript: 协议、外部资源引用（单双引号都要管——只挡一种等于没挡）
    .replace(/(href|xlink:href|src)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/(href|xlink:href|src)\s*=\s*'(?!#)[^']*'/gi, '')
    .replace(/javascript:/gi, '')
  return s.length > 8000 ? '' : s // 异常巨大的多半是模型跑飞了
}

/**
 * 逐条 sanitize 而不是整包信任。
 *
 * 这个文件用户和外部脚本都能改，条目本身又是模型写的——一条畸形数据不该让整个词典打不开
 * （同 canvasSlice 里 sanitizeCanvas 的思路）。返回的都是形状确定的 UserTerm。
 */
function readUser(): UserTerm[] {
  let list: unknown[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(userFile(), 'utf8')) as { terms?: unknown }
    if (Array.isArray(raw.terms)) list = raw.terms
  } catch {
    return [] // 文件不存在（大多数情况）或坏了 → 就当没有，词典照常用内置词库
  }
  const out: UserTerm[] = []
  for (const it of list) {
    const t = (it ?? {}) as Record<string, unknown>
    const id = typeof t.id === 'string' ? t.id.trim() : ''
    const en = typeof t.en === 'string' ? t.en.trim() : ''
    if (!id || !en) continue // 连名字都没有的条目没有展示价值
    const cat = typeof t.category === 'string' && CATS.has(t.category) ? t.category : 'interaction'
    out.push({
      id,
      en,
      zh: typeof t.zh === 'string' ? t.zh : '',
      category: cat as UserTerm['category'],
      keywords: Array.isArray(t.keywords)
        ? t.keywords.filter((k): k is string => typeof k === 'string')
        : [],
      logic: typeof t.logic === 'string' ? t.logic : '',
      svg: sanitizeSvg(t.svg),
      firstSeen: typeof t.firstSeen === 'string' ? t.firstSeen : '',
      project: typeof t.project === 'string' ? t.project : ''
    })
  }
  return out
}

function writeUser(terms: UserTerm[]): void {
  const f = userFile()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ version: 2, terms }, null, 2))
}

function readPending(): DictPending[] {
  try {
    const raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')) as { items?: unknown }
    return Array.isArray(raw.items) ? (raw.items as DictPending[]) : []
  } catch {
    return []
  }
}

/**
 * 把旧版沉淀的空壳词条转回待补全队列。
 *
 * 必须做，否则那些词**永远补不上**：钩子去重时会看到 dict-user.json 里已经有这个 id，
 * 于是不再入队；而它在词典里又只是个点开什么都没有的名字。占着位置还挡着路。
 *
 * 这一步会从词库里删条目，所以：只删 logic 和 svg 都为空的（纯空壳，删了不丢任何信息，
 * 名字原样进队列），并且改前留一份 .eas-backup。跑完就没有空壳了，自然不会再触发。
 */
function migrateLegacyShells(): void {
  const terms = readUser()
  const shells = terms.filter((t) => !t.logic.trim() && !t.svg.trim())
  if (!shells.length) return
  try {
    fs.copyFileSync(userFile(), userFile() + '.eas-backup')
  } catch {
    /* 没有原文件就无所谓备份 */
  }
  const items = readPending()
  const queued = new Set(items.map((x) => String(x.name).toLowerCase()))
  for (const s of shells) {
    if (queued.has(s.en.toLowerCase())) continue
    queued.add(s.en.toLowerCase())
    const at = Date.parse(s.firstSeen)
    items.push({ name: s.en, project: s.project, at: Number.isNaN(at) ? 0 : at })
  }
  try {
    const f = pendingFile()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify({ items }, null, 2))
    writeUser(terms.filter((t) => t.logic.trim() || t.svg.trim()))
  } catch {
    /* 写不动就维持原样，下次启动再试 */
  }
}

export function registerDictHandlers(): void {
  migrateLegacyShells()

  /** 读用户词条（词典气泡把它和内置的 242 条合并显示） */
  ipcMain.handle('dict:userTerms', (): UserTerm[] => readUser())

  /** 钩子记下的待补全候选（agent 读它来知道要写哪些词） */
  ipcMain.handle('dict:pending', (): DictPending[] => readPending())

  ipcMain.handle(
    'dict:sinkStatus',
    (): DictSinkStatus => ({ enabled: sinkEnabled(), pending: readPending().length })
  )

  ipcMain.handle('dict:setSink', (_e, on: boolean): DictSinkStatus => {
    try {
      const f = sinkFile()
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, JSON.stringify({ enabled: !!on }, null, 2))
    } catch {
      /* 写不进去就维持原状，下面照实报告 */
    }
    return { enabled: sinkEnabled(), pending: readPending().length }
  })

  /**
   * agent 补全后写入。**格式必须和内置词条同构**，缺关键字段一律拒收——
   * 宁可少一条，也不能让半截词条混进去（那正是上一版的问题）。
   */
  ipcMain.handle(
    'dict:add',
    (_e, raw: unknown): { ok: boolean; added: string[]; rejected: { name: string; why: string }[] } => {
      const list = Array.isArray(raw) ? raw : []
      const cur = readUser()
      const have = new Set(cur.map((t) => t.id.toLowerCase()))
      const added: string[] = []
      const rejected: { name: string; why: string }[] = []
      const today = new Date().toISOString().slice(0, 10)

      for (const it of list) {
        const t = (it ?? {}) as Record<string, unknown>
        const en = typeof t.en === 'string' ? t.en.trim() : ''
        const zh = typeof t.zh === 'string' ? t.zh.trim() : ''
        const logic = typeof t.logic === 'string' ? t.logic.trim() : ''
        const cat = typeof t.category === 'string' ? t.category : ''
        const name = en || zh || '(无名)'
        if (!en) {
          rejected.push({ name, why: '缺 en（英文名）' })
          continue
        }
        if (!zh) {
          rejected.push({ name, why: '缺 zh（中文名）' })
          continue
        }
        if (logic.length < 20) {
          rejected.push({ name, why: 'logic 太短——要写清实现思路，不是一句同义反复' })
          continue
        }
        if (!CATS.has(cat)) {
          rejected.push({ name, why: 'category 必须是 interaction / motion / visual 之一' })
          continue
        }
        const id = (typeof t.id === 'string' && t.id.trim() ? t.id : en).toLowerCase().replace(/\s+/g, '-')
        if (have.has(id)) {
          rejected.push({ name, why: '已经收录过了' })
          continue
        }
        const svg = sanitizeSvg(t.svg)
        have.add(id)
        cur.push({
          id,
          zh,
          en,
          category: cat as UserTerm['category'],
          keywords: Array.isArray(t.keywords)
            ? t.keywords.filter((k): k is string => typeof k === 'string')
            : [en, zh],
          logic,
          svg,
          firstSeen: today,
          project: typeof t.project === 'string' ? t.project : ''
        })
        added.push(en)
      }

      if (added.length) {
        try {
          writeUser(cur.slice(-500)) // 上限：再多就不是「随手查」而是负担了
        } catch (e) {
          return { ok: false, added: [], rejected: [{ name: '写盘', why: String(e) }] }
        }
        // 补全过的候选从待办里划掉，免得下次又提醒一遍
        try {
          const p = pendingFile()
          const raw2 = JSON.parse(fs.readFileSync(p, 'utf8')) as { items?: { name: string }[] }
          const done = new Set(added.map((x) => x.toLowerCase()))
          const left = (raw2.items ?? []).filter((x) => !done.has(String(x.name).toLowerCase()))
          fs.writeFileSync(p, JSON.stringify({ items: left }, null, 2))
        } catch {
          /* 没有待办文件就算了 */
        }
      }
      return { ok: true, added, rejected }
    }
  )

  ipcMain.handle('dict:remove', (_e, id: string) => {
    const next = readUser().filter((t) => t.id !== id)
    try {
      writeUser(next)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  void app
}
