import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const renderer = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? cssFiles(path) : entry.name.endsWith('.css') ? [path] : []
  })
}

function blackAlphas(value) {
  const hex = [...value.matchAll(/#(?:000|000000)([0-9a-f]{1,2})\b/gi)]
    .map((match) => parseInt(match[1], 16) / (match[1].length === 1 ? 15 : 255))
  const rgba = [...value.matchAll(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0?\.\d+|1)\s*\)/gi)]
    .map((match) => Number(match[1]))
  return [...hex, ...rgba]
}

test('投影不使用超过 25% 的固定黑色，明暗主题都保持轻量', () => {
  const offenders = []
  for (const file of cssFiles(renderer)) {
    postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkDecls((decl) => {
      if (!['box-shadow', 'text-shadow', 'filter', '--shadow-pop', '--ink-1', '--ink-2', '--ink-3'].includes(decl.prop)) return
      if (decl.prop === 'filter' && !decl.value.includes('drop-shadow')) return
      if (blackAlphas(decl.value).some((alpha) => alpha > 0.25)) {
        offenders.push(`${file.slice(renderer.length + 1)}:${decl.source.start.line} ${decl.parent?.selector ?? decl.prop}`)
      }
    })
  }
  assert.deepEqual(offenders, [])
})
