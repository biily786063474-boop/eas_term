// 扫一遍全库的笔记，产出图谱和体检共用的原始信息。
//
// 抽出来的关键理由：图谱和体检**必须看同一份数据**。分头各扫各的时候，
// 图谱说某页是孤儿、体检说它有反链，这种自相矛盾最消耗信任。
import fs from 'fs'
import path from 'path'

import { walkNotes } from './paths'

/** 一篇笔记的原始信息：给图谱和体检共用，只扫一遍盘 */
export interface NoteInfo {
  rel: string
  title: string
  summary: string
  tags: string[]
  links: string[]
  mtime: number
  /** 去掉 front-matter 后的正文字数（按字符不按字节：中文一个字三字节，
   *  用字节判「太薄」会把正常长度的中文笔记全误报） */
  bodyChars: number
}

export function scanNotes(root: string): NoteInfo[] {
  const out: NoteInfo[] = []
  for (const rel of walkNotes(root)) {
    let text = ''
    let mtime = 0
    try {
      const full = path.join(root, rel)
      text = fs.readFileSync(full, 'utf8')
      mtime = fs.statSync(full).mtimeMs
    } catch {
      continue
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    let summary = ''
    let tags: string[] = []
    if (fm) {
      for (const line of fm[1].split('\n')) {
        const kv = /^(\w+)\s*:\s*(.*)$/.exec(line.trim())
        if (!kv) continue
        if (kv[1] === 'summary') summary = kv[2].trim()
        else if (kv[1] === 'tags')
          tags = kv[2].replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
      }
    }
    const links = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) =>
      path.basename(m[1].trim())
    )
    const body = fm ? text.slice(fm[0].length) : text
    out.push({
      rel,
      title: path.basename(rel, path.extname(rel)),
      summary,
      tags,
      links,
      mtime,
      bodyChars: body.replace(/\s/g, '').length
    })
  }
  return out
}

