// 解析 SKILL.md 的 frontmatter，只取 name / description 两个字段。
//
// **不是完整 YAML 解析器**——那是故意的。真实的 SKILL.md 只用得到两种形态：
//   name: xxx                    单行标量
//   description: >               折叠块标量（长描述几乎都这么写，见本仓库
//     一段可能很长的话…            .claude/skills/agent-onboarding/SKILL.md）
// 按这个子集实现，认不出的形态一律降级返回 null，不抛错——调用方（skillLibrary/index.ts）
// 会在 name 缺失时回落成目录名。这份文件不碰 fs/electron，node --test 直接加载。

export interface ParsedSkillMeta {
  name: string | null
  description: string | null
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1)
    }
  }
  return t
}

/**
 * 读一个折叠/字面块标量（`description:` 后面跟 `>` 或 `|` 开头的多行缩进文本）。
 *
 * 缩进基准取块内第一行非空行的缩进量；遇到缩进比它浅的行（或文件结束）就收尾。
 * 折叠（`>`）把内部的换行压成空格——真实文件里这只是给面板一行预览用，
 * 不需要严格区分 YAML 折叠标量的段落规则（空行=段落分隔那一套），
 * 一律拍平成单行更适合列表展示。
 */
function readBlockScalar(lines: string[], start: number, folded: boolean): { text: string; next: number } {
  let i = start
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length) return { text: '', next: i }
  const indent = lines[i].match(/^\s*/)?.[0].length ?? 0
  if (indent === 0) return { text: '', next: start } // 下一行没有缩进，说明这个块标量其实是空的

  const collected: string[] = []
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      collected.push('')
      i++
      continue
    }
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0
    if (lineIndent < indent) break
    collected.push(line.slice(indent))
    i++
  }
  while (collected.length && collected[collected.length - 1] === '') collected.pop()

  const text = folded ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n').trim()
  return { text, next: i }
}

/** 解析一份 SKILL.md 全文，只要 frontmatter 里的 name / description。
 *  没有 frontmatter（缺开头/结尾的 `---`）→ 两个字段都是 null，不抛错。 */
export function parseSkillFrontmatter(raw: string): ParsedSkillMeta {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!m) return { name: null, description: null }

  const lines = m[1].split(/\r?\n/)
  let name: string | null = null
  let description: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const kv = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    const [, key, rest] = kv
    if (key === 'name') {
      const v = unquote(rest)
      if (v) name = v
      continue
    }
    if (key === 'description') {
      const trimmed = rest.trim()
      if (trimmed === '>' || trimmed === '>-' || trimmed === '>+' || trimmed === '|' || trimmed === '|-' || trimmed === '|+') {
        const { text, next } = readBlockScalar(lines, i + 1, trimmed.startsWith('>'))
        description = text
        i = next - 1
      } else {
        description = unquote(trimmed)
      }
    }
  }

  return { name, description }
}
