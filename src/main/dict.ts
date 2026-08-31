// 辞典的用户自建词条：~/.eas/dict-user.json
//
// ── 2026-08-31：自动沉淀整条链路拆掉了 ──────────────────────────────
// 上一版是「钩子扫出没收录的术语 → 记进待办 → agent 事后补全」。拆掉的理由
// （见 docs/辞典改造方案.html 第五节）：从代码里扫出来的英文标识符判不出该归哪一类、
// 补全写不出 hover 要看的示意图、而且**在用户没看的时候花钱**。
//
// 现在只剩一条入口：用户主动说「把 X 收进辞典」，agent 走完分类/结构/演示图/提示词
// 四步，最后调 dict_add 落盘。写入路径一个字没变 —— 变的是**谁发起**。
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import type { UserTerm } from '../shared/types'

const userFile = (): string => path.join(os.homedir(), '.eas', 'dict-user.json')
// ~/.eas/dict-pending.json 与 dict-sink.json 不再读写（自动沉淀已拆，见文件头）。
// **已有文件不删** —— 删掉等于动用户的数据，而留着没有任何代价。

const CATS = new Set(['interaction', 'motion', 'visual'])

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

/**
 * 清掉旧版自动沉淀留下的空壳词条。
 *
 * 空壳 = logic 和 svg 都是空的，在辞典里只是个点开什么都没有的名字。占着位置还挡着路。
 *
 * ── 2026-08-31：这个函数原来还会把它们转回待补全队列 ──────────────────
 * 自动沉淀整条链路已经拆掉（见 hooks/scan-commit.mjs 文件头），队列不再有人读，
 * 所以那一半去掉了。**删空壳这一半留着** —— 它跟队列无关，是在收拾上一版的烂摊子。
 * 改前照旧留一份 .eas-backup；跑完就没有空壳了，自然不会再触发。
 */
function dropLegacyShells(): void {
  const terms = readUser()
  const shells = terms.filter((t) => !t.logic.trim() && !t.svg.trim())
  if (!shells.length) return
  try {
    fs.copyFileSync(userFile(), userFile() + '.eas-backup')
  } catch {
    /* 没有原文件就无所谓备份 */
  }
  try {
    writeUser(terms.filter((t) => t.logic.trim() || t.svg.trim()))
  } catch {
    /* 写不动就维持原样，下次启动再试 */
  }
}

export function registerDictHandlers(): void {
  dropLegacyShells()

  /** 读用户词条（词典气泡把它和内置的 242 条合并显示） */
  ipcMain.handle('dict:userTerms', (): UserTerm[] => readUser())

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
