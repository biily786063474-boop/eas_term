import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LspDecoder, encodeLsp, pathToUri, uriToPath } from './lspFraming.ts'

const enc = (o: unknown): Buffer => encodeLsp(o)

describe('encodeLsp', () => {
  it('**Content-Length 数字节不数字符** —— 带中文时按字符算会切在半个字上', () => {
    const b = enc({ m: '你好' })
    const head = b.subarray(0, b.indexOf('\r\n\r\n')).toString('ascii')
    const len = Number(/Content-Length: (\d+)/.exec(head)![1])
    const body = b.subarray(b.indexOf('\r\n\r\n') + 4)
    assert.equal(len, body.length)
    assert.equal(JSON.parse(body.toString('utf8')).m, '你好')
  })
  it('头体之间是 \\r\\n\\r\\n', () => {
    assert.ok(enc({ a: 1 }).includes('\r\n\r\n'))
  })
})

describe('LspDecoder', () => {
  it('一次喂一条完整消息', () => {
    const d = new LspDecoder()
    assert.deepEqual(d.push(enc({ id: 1 })), [{ id: 1 }])
  })

  it('**一次喂好几条要全吐出来**（粘包）', () => {
    const d = new LspDecoder()
    const r = d.push(Buffer.concat([enc({ id: 1 }), enc({ id: 2 }), enc({ id: 3 })]))
    assert.deepEqual(r, [{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('**半条要等下一块**（半包）—— 按「收到就 parse」写，服务器答得快时会碎', () => {
    const d = new LspDecoder()
    const full = enc({ id: 7, big: 'x'.repeat(50) })
    assert.deepEqual(d.push(full.subarray(0, 20)), [], '半条不该吐东西')
    assert.deepEqual(d.push(full.subarray(20)), [{ id: 7, big: 'x'.repeat(50) }])
  })

  it('逐字节喂也能凑齐 —— 最极端的半包', () => {
    const d = new LspDecoder()
    const full = enc({ id: 9, s: '中文也要过' })
    const out: unknown[] = []
    for (const b of full) out.push(...d.push(Buffer.from([b])))
    assert.deepEqual(out, [{ id: 9, s: '中文也要过' }])
  })

  it('中文体的字节长度要按 utf8 切', () => {
    const d = new LspDecoder()
    const msg = { path: '/Users/x/项目/代码地图.ts', name: '领地聚合' }
    assert.deepEqual(d.push(enc(msg)), [msg])
  })

  it('也认 \\n\\n 分隔 —— 有的实现这么发，只认一种就永远等下去', () => {
    const d = new LspDecoder()
    const body = Buffer.from(JSON.stringify({ id: 5 }), 'utf8')
    const b = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\n\n`, 'ascii'), body])
    assert.deepEqual(d.push(b), [{ id: 5 }])
  })

  it('**坏 JSON 丢掉但连接继续** —— 抛的话整条连接就死了', () => {
    const d = new LspDecoder()
    const bad = Buffer.from('Content-Length: 3\r\n\r\n{{{', 'utf8')
    assert.deepEqual(d.push(bad), [])
    assert.deepEqual(d.push(enc({ id: 2 })), [{ id: 2 }], '坏包之后还得能收')
  })

  it('**没有 Content-Length 的段整段丢掉，不能停住** —— clangd 某些日志级别会混进 stdout', () => {
    const d = new LspDecoder()
    const noise = Buffer.from('I[12:00:00] some clangd log\r\n\r\n', 'utf8')
    d.push(noise)
    assert.deepEqual(d.push(enc({ id: 3 })), [{ id: 3 }], '噪声之后还得能收')
  })

  it('大小写不敏感（content-length）', () => {
    const d = new LspDecoder()
    const body = Buffer.from('{"id":4}', 'utf8')
    const b = Buffer.concat([Buffer.from(`content-length: ${body.length}\r\n\r\n`, 'ascii'), body])
    assert.deepEqual(d.push(b), [{ id: 4 }])
  })

  it('pending 反映还没凑齐的字节数', () => {
    const d = new LspDecoder()
    const full = enc({ id: 1, s: 'abcdefghij' })
    d.push(full.subarray(0, 10))
    assert.equal(d.pending, 10)
    d.push(full.subarray(10))
    assert.equal(d.pending, 0)
  })
})

describe('URI ↔ 路径', () => {
  it('**中文路径要解码** —— 不解的话界面上是一串 %E6%8A%95…，点进去也找不到文件', () => {
    assert.equal(
      uriToPath('file:///Users/x/Projects/%E6%8A%95%E5%B1%8F%E8%BD%AF%E4%BB%B6/a.cpp'),
      '/Users/x/Projects/投屏软件/a.cpp'
    )
  })
  it('空格也要解码', () => {
    assert.equal(uriToPath('file:///Users/x/vibe%20coding/a.ts'), '/Users/x/vibe coding/a.ts')
  })
  it('普通路径原样', () => {
    assert.equal(uriToPath('file:///a/b.c'), '/a/b.c')
  })
  it('不是 file: 就原样返回', () => {
    assert.equal(uriToPath('untitled:1'), 'untitled:1')
  })
  it('坏编码不抛 —— 抛的话整次查询都失败', () => {
    assert.equal(typeof uriToPath('file:///a/%ZZ'), 'string')
  })
  it('**pathToUri 只编路径段，不编分隔符**', () => {
    assert.equal(pathToUri('/Users/x/投屏软件/a.cpp'), 'file:///Users/x/%E6%8A%95%E5%B1%8F%E8%BD%AF%E4%BB%B6/a.cpp')
  })
  it('往返一致', () => {
    for (const p of ['/a/b.c', '/Users/x/vibe coding/t.ts', '/项目/代码.cpp']) {
      assert.equal(uriToPath(pathToUri(p)), p)
    }
  })
})
