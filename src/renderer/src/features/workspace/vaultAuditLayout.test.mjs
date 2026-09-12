import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
test('审计折叠区不复用解锁居中大面板的 sec-lock 布局',()=>{const src=fs.readFileSync(new URL('./SecretsPanel.tsx',import.meta.url),'utf8');assert.match(src,/<details className="sec-audit">/);assert.doesNotMatch(src,/<details className="sec-lock">/)})
