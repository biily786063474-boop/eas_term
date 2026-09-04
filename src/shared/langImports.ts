// 各语言的 import 提取。**纯字符串进、说明符出，零 fs、零依赖。**
//
// ── 为什么用正则而不是真解析器 ──────────────────────────────────────────────
// import 语句是每种语言里最规整的一小块语法：都在文件靠前、都是单行（Python 的
// 括号续行是唯一例外）、都不嵌套。为它引一个 tree-sitter（WASM 也有几 MB、
// 每种语言一份语法）不划算 —— 而**难的从来不是找出 import 语句，是解析路径**，
// 那部分在下一层（`multiLang.ts`），跟用什么解析器无关。
//
// 代价说清楚：注释和字符串里的伪 import 要自己挡（下面每种语言都有测试钉着），
// 宏拼出来的 `#include` 这类拿不到 —— 和 JS 那侧「动态 import 拼字符串」是同一类边界。

/** 先把注释干掉，免得注释里的 import 被当真。
 *  **不处理字符串里的注释符**（`"http://x"` 里的 `//`）—— 那会误伤，
 *  而 import 语句本身不会出现在字符串里，误判的方向是「少挡一次」，安全。 */
function stripComments(src: string, line: string, blockOpen?: string, blockClose?: string): string {
  let s = src
  if (blockOpen && blockClose) {
    s = s.split(blockOpen).map((part, i) => (i === 0 ? part : part.split(blockClose).slice(1).join(blockClose))).join('')
  }
  return s
    .split('\n')
    .map((l) => {
      const i = l.indexOf(line)
      return i < 0 ? l : l.slice(0, i)
    })
    .join('\n')
}

// ── Python ──────────────────────────────────────────────────────────────────

export interface PyImport {
  /** 点号形式的模块名。相对 import 里是**点后面**那一段（可能为空串） */
  module: string
  /** 前导点的个数。0 = 绝对 import，1 = 当前包，2 = 上一层…… */
  level: number
  /** `from X import a, b` 里的那些名字。它们**可能是子模块也可能是符号**，
   *  两种都要试（`from pkg import mod` 与 `from pkg import CONST` 长得一样）。 */
  names?: string[]
}

export function extractPythonImport(src: string): PyImport[] {
  const s = stripComments(src, '#')
  const out: PyImport[] = []

  // from ... import ...（支持括号续行）
  const fromRe = /^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm
  for (const m of s.matchAll(fromRe)) {
    const names = m[3]
      .replace(/^\(|\)$/g, '')
      .split(',')
      .map((x) => x.trim().split(/\s+as\s+/)[0].trim())
      .filter((x) => x && x !== '*')
    out.push({ module: m[2] ?? '', level: m[1].length, ...(names.length ? { names } : {}) })
  }

  // import a, b.c as d
  const impRe = /^[ \t]*import[ \t]+([^\n]+)/gm
  for (const m of s.matchAll(impRe)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[A-Za-z_][\w.]*$/.test(name)) out.push({ module: name, level: 0 })
    }
  }
  return out
}

// ── C / C++ ─────────────────────────────────────────────────────────────────

export interface CInclude {
  path: string
  /** `"..."` 是本地头，`<...>` 是系统头。
   *  **必须分开** —— 不分的话图上会长出一堆 stdio.h / vector 这类节点。 */
  local: boolean
}

export function extractCInclude(src: string): CInclude[] {
  const s = stripComments(src, '//', '/*', '*/')
  const out: CInclude[] = []
  for (const m of s.matchAll(/^[ \t]*#[ \t]*include[ \t]*(?:"([^"]+)"|<([^>]+)>)/gm)) {
    if (m[1] !== undefined) out.push({ path: m[1], local: true })
    else out.push({ path: m[2], local: false })
  }
  return out
}

// ── Swift ───────────────────────────────────────────────────────────────────

/** Swift 的 import 是**模块级**的，不是文件级。
 *
 *  ⚠️ **同一个 module 里的文件互相可见、不需要 import** ——
 *  实测用户的 `Ipad延伸`：159 个 `.swift` 文件里，指向本项目内某个文件的 import **0 条**。
 *  所以 Swift 画不出文件级依赖图，只能画 target 之间的，
 *  界面上必须说清这一点，别让人以为「这个项目耦合很低」。
 *
 *  返回的是模块名（去重、保持出现顺序）。 */
export function extractSwiftImport(src: string): string[] {
  const s = stripComments(src, '//', '/*', '*/')
  const out: string[] = []
  // `import Foo` · `@testable import Foo` · `import struct Foo.Bar`（模块是 Foo）
  const KINDS = 'typealias|struct|class|enum|protocol|let|var|func'
  const re = new RegExp(`^[ \\t]*(?:@testable[ \\t]+)?import[ \\t]+(?:(?:${KINDS})[ \\t]+)?([A-Za-z_]\\w*)`, 'gm')
  for (const m of s.matchAll(re)) if (!out.includes(m[1])) out.push(m[1])
  return out
}
