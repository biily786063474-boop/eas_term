// LSP 的**分帧**：`Content-Length: N\r\n\r\n<N 字节的 JSON>`。纯函数、零依赖。
//
// ── 为什么这一层值得单独测 ────────────────────────────────────────────────
// 它有三个都不报错、只会静默出错的地方：
//
// 1. **Content-Length 数的是字节，不是字符。** 头里带中文（LSP 的响应里到处
//    是文件路径和符号名）时，按 `string.length` 切会切在半个字符上，
//    之后所有消息全部错位 —— 表现是「用一会儿就再也收不到回复」。
// 2. **一次 data 事件里可能有半条、也可能有好几条。** 按「收到就 parse」写，
//    在服务器答得快的时候会碎，在答得慢的时候正常 —— 最难复现的那种。
// 3. **头和体之间是 `\r\n\r\n`**，不是 `\n\n`。有的实现两种都发，
//    只认一种的话遇到另一种就永远等下去。
//
// 所以这里只做一件事：**喂字节进去，吐完整消息出来**。不碰进程、不碰 JSON 语义。

/** 把一条消息编成 LSP 的线上格式。 */
export function encodeLsp(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  // **按字节算长度**（见文件头第 1 条）
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** 增量解码器。喂 Buffer，吐出已经完整的那些消息（未完整的留在内部等下一次）。 */
export class LspDecoder {
  private buf: Buffer = Buffer.alloc(0)

  /** 喂一段字节，返回这一次能凑齐的所有完整消息（已 JSON.parse）。
   *
   *  **坏 JSON 不抛**：LSP 服务器偶尔会在 stdout 上混进非协议输出
   *  （clangd 的某些日志级别就会）。抛的话整条连接就死了，
   *  而丢掉一条坏消息只是少一次回复。 */
  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: unknown[] = []
    for (;;) {
      // 头结束标记：`\r\n\r\n`，但也认 `\n\n`（见文件头第 3 条）
      let headEnd = this.buf.indexOf('\r\n\r\n')
      let sepLen = 4
      if (headEnd < 0) {
        headEnd = this.buf.indexOf('\n\n')
        sepLen = 2
      }
      if (headEnd < 0) return out // 头都没收全
      const head = this.buf.subarray(0, headEnd).toString('ascii')
      const m = /content-length:\s*(\d+)/i.exec(head)
      if (!m) {
        // 头里没有 Content-Length —— 这一段不是协议消息，整段丢掉往前走，
        // **不要停在这儿**（停下来就是永远收不到后续消息了）
        this.buf = this.buf.subarray(headEnd + sepLen)
        continue
      }
      const len = Number(m[1])
      const start = headEnd + sepLen
      if (this.buf.length < start + len) return out // 体没收全，等下一块
      const body = this.buf.subarray(start, start + len).toString('utf8')
      this.buf = this.buf.subarray(start + len)
      try {
        out.push(JSON.parse(body))
      } catch {
        /* 坏 JSON 丢掉，连接继续（见 push 的注释） */
      }
    }
  }

  /** 内部还剩多少字节没凑齐（排障用）。 */
  get pending(): number {
    return this.buf.length
  }
}

// ── URI ↔ 路径 ──────────────────────────────────────────────────────────────
//
// LSP 里的文件是 `file:///绝对/路径`，而且**是百分号编码的**。
// 不解码的后果在中文路径下立刻可见：
//   file:///Users/x/Projects/%E6%8A%95%E5%B1%8F%E8%BD%AF%E4%BB%B6/a.cpp
// 直接去掉前缀会得到一串 %E6%8A%95…，`path.relative` 算出来是 `../%E6%8A%95…`，
// 界面上显示成乱码、点进去也找不到文件（2026-09-03 clangd 实测撞到）。

/** `file:///a/b` → `/a/b`（解码百分号）。不是 file: 协议时原样返回。 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  // `file://` 后面紧跟的那个 `/` 是路径的一部分，所以只去掉 7 个字符
  const raw = uri.slice(7)
  try {
    return decodeURIComponent(raw)
  } catch {
    // 编码坏了就原样用 —— 总比抛异常让整次查询失败强
    return raw
  }
}

/** `/a/b` → `file:///a/b`（编码非 ASCII）。**只编路径段，不编分隔符。** */
export function pathToUri(p: string): string {
  return 'file://' + p.split('/').map((seg) => encodeURIComponent(seg)).join('/')
}
