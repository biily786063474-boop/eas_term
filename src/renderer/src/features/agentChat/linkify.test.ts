import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLinks, isFollowClick, splitByLinks } from './linkify.ts'

const kinds = (t: string) => findLinks(t).map((h) => `${h.kind}:${h.target}${h.line ? ':' + h.line : ''}`)

test('裸网址认得出来', () => {
  assert.deepEqual(kinds('详见 https://example.com/a/b 这里'), ['url:https://example.com/a/b'])
})

// 中文写作里这个每天都在发生：句号吞进 URL 会打开一个 404
test('句末中文标点不算 URL 的一部分', () => {
  assert.deepEqual(kinds('详见 https://example.com/a。'), ['url:https://example.com/a'])
  assert.deepEqual(kinds('见 https://x.com/y，然后'), ['url:https://x.com/y'])
})

test('括号里的网址不吞右括号', () => {
  assert.deepEqual(kinds('（https://x.com/y）'), ['url:https://x.com/y'])
  assert.deepEqual(kinds('(https://x.com/y)'), ['url:https://x.com/y'])
})

test('三种本地路径都认', () => {
  assert.deepEqual(kinds('改了 src/main/index.ts 这个文件'), ['path:src/main/index.ts'])
  assert.deepEqual(kinds('看 /Users/me/a/b.md'), ['path:/Users/me/a/b.md'])
  assert.deepEqual(kinds('放在 ~/Documents/x/y.json'), ['path:~/Documents/x/y.json'])
})

// agent 最常见的写法：路径带行号
test('路径带行号：行号单独取出，target 不含它', () => {
  const h = findLinks('见 src/main/pty.ts:539 那行')[0]
  assert.equal(h.kind, 'path')
  assert.equal(h.target, 'src/main/pty.ts')
  assert.equal(h.line, 539)
})

// 只有 README 两个字的话，那更可能是正文在说这份文件
test('没有分隔符的裸文件名不认 —— 宁可漏认也不要误认', () => {
  assert.deepEqual(kinds('看一下 README 里写的'), [])
  assert.deepEqual(kinds('package.json 里有'), [])
})

test('URL 里的斜杠不会被当成路径再认一遍', () => {
  const hs = findLinks('https://example.com/a/b/c')
  assert.equal(hs.length, 1)
  assert.equal(hs[0].kind, 'url')
})

test('一段话里多个目标，按出现顺序', () => {
  assert.deepEqual(kinds('先看 src/a.ts 再访问 https://x.com/y 最后 ~/b/c.md'), [
    'path:src/a.ts',
    'url:https://x.com/y',
    'path:~/b/c.md'
  ])
})

test('start/end 能正确切回原文', () => {
  const t = '改了 src/main/index.ts 这个文件'
  const h = findLinks(t)[0]
  assert.equal(t.slice(h.start, h.end), 'src/main/index.ts')
})

test('普通中文句子不产生误认', () => {
  assert.deepEqual(kinds('这个功能已经做完了，测试也过了'), [])
  assert.deepEqual(kinds('比例是 3/4，时间 12:30'), [])
})

// 用户要的是 Ctrl 点击；mac 上 Cmd 也收
test('只有 Ctrl/Cmd + 左键才算跳转', () => {
  assert.equal(isFollowClick({ ctrlKey: true, button: 0 }), true)
  assert.equal(isFollowClick({ metaKey: true, button: 0 }), true)
  assert.equal(isFollowClick({ button: 0 }), false, '裸点击不该跳转 —— 那会妨碍选中文字')
  assert.equal(isFollowClick({ ctrlKey: true, button: 2 }), false, '右键不算')
})

// 切片拼回去必须和原文一字不差 —— 渲染层拿它替换文本节点，丢字就是改了模型的话
test('切片拼回去 === 原文', () => {
  for (const t of [
    '改了 src/main/index.ts:42 和 https://x.com/y，然后呢',
    '没有任何链接的一句话',
    'https://a.com 开头',
    '结尾 ~/b/c.md',
    ''
  ]) {
    assert.equal(splitByLinks(t).map((p) => p.text).join(''), t, JSON.stringify(t))
  }
})

test('切片里带 hit 的那些正是命中', () => {
  const parts = splitByLinks('见 src/a.ts 和 https://x.com/y')
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['src/a.ts', 'https://x.com/y'])
})
