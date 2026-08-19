// markdown 开头的 YAML frontmatter：从正文里摘出来，**单独渲染成一张元数据卡片**。
//
// 一开始的做法是直接剥掉不显示，被用户当场否掉 —— 对 SKILL.md 这类文件，
// frontmatter 里的 `name` / `description` 恰恰是最要紧的内容（description 决定
// skill 什么时候被触发，是会反复调的东西）。藏进「源代码」视图等于藏起来了。
//
// 所以：从正文里摘出去（不再糊成一堆 `name:` `description: >` 混在文章开头），
// 但在顶部单独显示。
//
// 单独一个文件而不是塞进 markdown.ts：那个文件引了 ../canvas/media，
// node --test 直接跑 .ts 时解析不了（值 import 必须带扩展名）。纯函数零依赖。

export interface Frontmatter {
  /** 原始的 YAML 文本（不解析成对象 —— 我们只是显示它，不消费它） */
  raw: string
  /** 摘掉 frontmatter 之后的正文 */
  body: string
  /** 顶层的简单键值对，用来做卡片上的字段行。折叠块标量会拍平成一行。 */
  fields: { key: string; value: string }[]
}

/**
 * 判据从严：**必须第一行就是 `---`**，且后面存在闭合的 `---`。
 * 松一点的话，正文里拿 `---` 当分割线的文档会被从头切掉一大块。
 */
export function splitFrontmatter(src: string): Frontmatter | null {
  const t = src.replace(/^\uFEFF/, '')
  if (!/^---[ \t]*\r?\n/.test(t)) return null
  const m = t.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return null
  return { raw: m[1], body: t.slice(m[0].length), fields: parseFields(m[1]) }
}

/**
 * 只认**顶层的 `key:` 行**，值可能跟在同一行，也可能是下面缩进的折叠块（`>` / `|`）。
 * 不做完整 YAML 解析 —— 这里只为显示，解析器的复杂度和它的收益不成比例，
 * 而且解析失败时我们仍然想把原文显示出来。
 */
function parseFields(raw: string): { key: string; value: string }[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const out: { key: string; value: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    // 折叠块标量：把后面缩进的行拍平成一行（跟主进程 skillLibrary/parse.ts 同款处理）
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts: string[] = []
      while (i + 1 < lines.length && (lines[i + 1].startsWith('  ') || !lines[i + 1].trim())) {
        i++
        const t2 = lines[i].trim()
        if (t2) parts.push(t2)
      }
      value = parts.join(' ')
    }
    out.push({ key: m[1], value })
  }
  return out
}
