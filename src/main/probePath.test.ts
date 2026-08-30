// 终端路径链接的解析与缓存。
//
// 这层原来夹在 fs.ts 的 ipc handler 里，一条测试都没有 —— 而它是
// 「Windows 卡死未响应」那条 bug 的所在地（主进程里 statSync，
// 鼠标每划过终端一行调一次、一行最多 15 个候选）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'

import { createProbeCache, MAX_CANDIDATES, resolveProbePath } from './probePath.ts'

const H = {
  isAbsolute: path.isAbsolute,
  resolve: path.resolve,
  join: path.join,
  home: () => '/Users/me',
  fromFileUrl: (u: string) => decodeURIComponent(u.replace('file://', ''))
}
const R = (input: string, base = '/work/proj'): string | null => resolveProbePath(input, base, H)

// ── 解析 ──────────────────────────────────────────────────────────
test('绝对路径原样返回', () => {
  assert.equal(R('/etc/hosts'), '/etc/hosts')
})

test('相对路径按终端的 cwd 解析', () => {
  assert.equal(R('src/a.ts'), '/work/proj/src/a.ts')
})

test('**去掉 :行 和 :行:列 后缀** —— 编译器和 grep 都这么打', () => {
  assert.equal(R('src/a.ts:42'), '/work/proj/src/a.ts')
  assert.equal(R('src/a.ts:42:8'), '/work/proj/src/a.ts')
})

test('冒号后面不是数字就不动它 —— 文件名里本来就能有冒号', () => {
  assert.equal(R('weird:name'), '/work/proj/weird:name')
})

test('~ 展开到 home', () => {
  assert.equal(R('~'), '/Users/me')
  assert.equal(R('~/.zshrc'), '/Users/me/.zshrc')
})

test('**~notauser 不当成 home** —— 那是别人的家目录写法，不是我们的', () => {
  assert.equal(R('~other/file'), '/work/proj/~other/file')
})

test('file:// 交给 URL 解析', () => {
  assert.equal(R('file:///tmp/a.txt'), '/tmp/a.txt')
})

test('空的、纯空白的返回 null', () => {
  assert.equal(R(''), null)
  assert.equal(R('   '), null)
  assert.equal(R('   :12'), null)
})

test('只有 :行 后缀、去掉就空了 → null，不要变成 cwd 本身', () => {
  // 返回 cwd 的话，终端里一个孤零零的 ":42" 会被画成指向项目根目录的链接
  assert.equal(R(':42'), null)
})

// ── 上限 ──────────────────────────────────────────────────────────
test('**一行的候选上限** —— 上限不是省事，是止血', () => {
  // 一行长命令能拆出几十个词，每个都去 stat 一遍，
  // 鼠标划过去就是几十次文件操作（Windows 上每次还要过 Defender）
  assert.equal(MAX_CANDIDATES, 15)
})

// ── 缓存 ──────────────────────────────────────────────────────────
test('缓存命中，且**失败结果也缓存**', () => {
  const c = createProbeCache(4000, 10)
  c.set('/a', { absPath: '/a', isDir: false }, 1000)
  c.set('/nope', null, 1000)
  assert.deepEqual(c.get('/a', 1000)?.v, { absPath: '/a', isDir: false })
  // 不缓存失败的话，一行里那些永远不存在的词（命令名、参数）每次 hover 都要再查
  assert.equal(c.get('/nope', 1000)?.v, null, '失败结果也该命中缓存')
  assert.notEqual(c.get('/nope', 1000), undefined, '「缓存里没有」和「缓存里是 null」是两回事')
})

test('**过期就重查** —— 文件会新建也会被删', () => {
  const c = createProbeCache(4000, 10)
  c.set('/a', null, 1000)
  assert.notEqual(c.get('/a', 4500), undefined, '还没过期')
  assert.equal(c.get('/a', 6000), undefined, '过期了应该重查')
})

test('条数有上限，不会一直涨', () => {
  const c = createProbeCache(4000, 5)
  for (let i = 0; i < 100; i++) c.set(`/p${i}`, null, 1000)
  assert.ok(c.size() <= 5, `涨到了 ${c.size()}`)
})
