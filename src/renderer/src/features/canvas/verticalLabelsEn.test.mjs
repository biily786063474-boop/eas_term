// 英文界面下的竖排标签（2026-09-30）：`text-orientation: upright` 是给汉字的，英文会一个字母一行地堆，
// 固定高度的页签（.wk-seg-btn 52px）还会被撑出去压到画布。规则：CJK 保持逐字竖排；
// 英文整行旋转 90°（vertical-rl + mixed），高度随文字，不溢出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('./canvas.css', import.meta.url), 'utf8')

/** canvas.css 里所有「vertical-rl + upright」的选择器 */
function uprightSelectors() {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2]
    if (/writing-mode:\s*vertical-rl/.test(body) && /text-orientation:\s*upright/.test(body))
      out.push(...m[1].split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter(Boolean))
  }
  return out
}

/** 英文覆盖块：html:lang(en) 前缀 + text-orientation: mixed */
function enOverrides() {
  const out = new Map()
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/text-orientation:\s*mixed/.test(m[2])) continue
    for (const s of m[1].split(',')) {
      const sel = s.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      const k = sel.match(/^html:lang\(en\)\s+(.+)$/)
      if (k) out.set(k[1].trim(), m[2])
    }
  }
  return out
}

test('每一个中文逐字竖排的选择器，在英文界面都有整行旋转的覆盖', () => {
  const ups = uprightSelectors()
  assert.ok(ups.includes('.wk-seg-btn'), '前提：抽屉页签是竖排')
  assert.ok(ups.includes('.cd-edge-label'), '前提：左缘「文件信息」是竖排')
  assert.ok(ups.includes('.wk-edge-label'), '前提：右缘「更多」是竖排')
  const en = enOverrides()
  for (const sel of ups) assert.ok(en.has(sel), `${sel} 缺英文覆盖（会逐字母竖排）`)
})

test('抽屉页签在英文下高度随文字（不再固定 52px 被撑出去），且不换行', () => {
  const body = enOverrides().get('.wk-seg-btn')
  assert.ok(body)
  assert.match(body, /height:\s*auto/)
  assert.match(body, /min-height:\s*52px/)
  assert.match(body, /white-space:\s*nowrap/)
})

test('中文基线不动：各竖排块仍是 upright（逐字竖排）', () => {
  for (const sel of ['.wk-seg-btn', '.cd-edge-label', '.wk-edge-label']) assert.ok(uprightSelectors().includes(sel), sel)
})
