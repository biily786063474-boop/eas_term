import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deadCodeVerdict,
  isDeadCodeExempt,
  isTrustworthy,
  untrustReason,
  type SymbolNode
} from './symbolGraph.ts'

const sym = (o: Partial<SymbolNode>): SymbolNode => ({
  id: 'x#y', file: 'src/a.ts', name: 'y', kind: 'function', line: 1, exported: true, refs: 0, topLevel: true, ...o
})

describe('可信度（坑 3）', () => {
  it('TS/TSX 一律可信', () => {
    assert.ok(isTrustworthy('src/a.ts', false))
    assert.ok(isTrustworthy('src/a.tsx', false))
  })
  it('**checkJs:false 时 JS/JSX 不可信** —— 实测 24 条死代码里 8 条是它贡献的假阳性', () => {
    assert.ok(!isTrustworthy('src/a.jsx', false))
    assert.ok(!isTrustworthy('src/a.js', false))
    assert.ok(!isTrustworthy('src/a.mjs', false))
  })
  it('开了 checkJs 就可信', () => {
    assert.ok(isTrustworthy('src/a.jsx', true))
  })
  it('不可信时要给得出人话的原因', () => {
    assert.match(untrustReason('a.jsx', false) ?? '', /checkJs/)
    assert.equal(untrustReason('a.ts', false), null)
  })
})

describe('死代码豁免', () => {
  it('测试文件里的不算', () => {
    assert.ok(isDeadCodeExempt({ file: 'src/a.test.ts', name: 'helper' }))
    assert.ok(isDeadCodeExempt({ file: 'src/a.spec.ts', name: 'helper' }))
  })
  it('**下划线开头是约定俗成的「我知道它没人用」**', () => {
    assert.ok(isDeadCodeExempt({ file: 'src/a.ts', name: '_clearCache' }))
  })
  it('构建/配置文件里的导出是给工具读的', () => {
    assert.ok(isDeadCodeExempt({ file: 'vite.config.ts', name: 'default' }))
    assert.ok(isDeadCodeExempt({ file: 'electron.vite.config.ts', name: 'x' }))
  })
  it('普通源码不豁免', () => {
    assert.ok(!isDeadCodeExempt({ file: 'src/main/a.ts', name: 'doThing' }))
  })
})

describe('deadCodeVerdict', () => {
  it('有引用就是活的', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 1 }), true), 'alive')
  })
  it('零引用 ＋ 可信 = 死代码', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 0 }), true), 'dead')
  })
  it('**零引用 ＋ 不可信 = unsure，不是 dead** —— 这一条是整个清单可不可用的关键', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 0, file: 'src/a.jsx' }), false), 'unsure')
  })
  it('豁免优先于可信度', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 0, file: 'src/a.test.ts' }), true), 'exempt')
    assert.equal(deadCodeVerdict(sym({ refs: 0, file: 'src/a.jsx', name: '_x' }), false), 'exempt')
  })
})

describe('topLevel（接口实现的误判）', () => {
  it('**非顶层的一律豁免** —— 对象字面量方法是接口实现，调用方引的是接口那侧', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 0, topLevel: false }), true), 'exempt')
  })
  it('顶层的照旧判', () => {
    assert.equal(deadCodeVerdict(sym({ refs: 0, topLevel: true }), true), 'dead')
  })
})
