// 内置词库：lexicon/*.json（随插件分发，只读）。首次用到时加载并编译，之后复用。
// 任何一条不合格（缺依据、正则写错）→ 整个词库加载失败并报出是哪个文件哪一条，
// 不静默跳过：跳过会让用户以为「检过了、没问题」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from './lexicon.mjs'

const DIR = fileURLToPath(new URL('../lexicon/', import.meta.url))
let cache

export function builtinEntries() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  const all = [], ids = new Set()
  for (const f of files) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) } catch (e) { throw Error(`内置词库 ${f} 不是合法 JSON：${e.message}`) }
    if (!Array.isArray(data?.entries)) throw Error(`内置词库 ${f} 缺 entries`)
    for (const e of data.entries) {
      if (ids.has(e?.id)) throw Error(`内置词库 id 重复：${e.id}`)
      ids.add(e?.id)
      all.push(e)
    }
  }
  return all
}

export function builtin() {
  if (!cache) {
    const entries = builtinEntries()
    try { cache = compile(entries) } catch (e) { throw Error(`内置词库加载失败：${e.message}`) }
  }
  return cache
}
