// 极简 Markdown 渲染器（零依赖）。
//
// 为什么不用 marked/markdown-it：那要连带引入 DOMPurify 才安全，两个新依赖换一个
// 「把标题渲染大一点」的功能不划算。这里的策略是**先把所有文本转义，再拼我们自己生成的标签**，
// 所以文档里写的原始 HTML 一律当纯文本显示，天然没有 XSS 面。
//
// 覆盖：标题 / 围栏代码 / 引用 / 有序无序列表(含嵌套、任务列表) / 表格 / 分隔线 /
//       行内的 代码·粗体·斜体·删除线·链接·图片。够读技术文档，不追求 CommonMark 全兼容。
import { easfileUrl, isImagePath } from '../canvas/media'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** md 里的相对图片路径 → 能真正加载的 URL（否则文档里的图全是裂的） */
function resolveSrc(src: string, baseDir: string): string {
  if (/^(https?:|data:|easfile:)/i.test(src)) return src
  let abs = src
  if (!src.startsWith('/')) {
    const parts: string[] = baseDir.split('/').filter(Boolean)
    for (const seg of src.replace(/^\.\//, '').split('/')) {
      if (seg === '..') parts.pop()
      else if (seg && seg !== '.') parts.push(seg)
    }
    abs = '/' + parts.join('/')
  }
  return isImagePath(abs) ? easfileUrl(abs) : ''
}

/** 行内元素。输入必须是**已转义**的文本，这里只往里插标签。 */
function inline(t: string, baseDir: string): string {
  // 行内代码先抽出来占位，免得里面的 * _ 被当成强调解析。
  // 占位符用 NUL：正文里不可能出现。曾经用「空格+序号+空格」，结果正文一句
  // 「共 123 个」就被当成占位符还原成了代码块。
  const codes: string[] = []
  let s = t.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_m, alt: string, src: string) => {
    const u = resolveSrc(src, baseDir)
    return u ? `<img src="${u}" alt="${alt}" loading="lazy">` : `<span class="md-img-miss">[图片：${alt || src}]</span>`
  })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_m, txt: string, href: string) =>
    /^(https?:|mailto:)/i.test(href) ? `<a href="${href}" target="_blank" rel="noreferrer">${txt}</a>` : `<span class="md-link">${txt}</span>`
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`)
}

const RULE = /^\s*([-*_])\s*\1\s*\1[\s\S]*$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const isBlank = (l: string): boolean => !l.trim()

export function renderMarkdown(src: string, filePath: string): string {
  const baseDir = filePath.slice(0, filePath.lastIndexOf('/'))
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const inl = (t: string): string => inline(esc(t), baseDir)

  while (i < lines.length) {
    const line = lines[i]

    if (isBlank(line)) {
      i++
      continue
    }

    // 围栏代码块
    const fence = line.match(/^\s*(```+|~~~+)\s*(\S*)/)
    if (fence) {
      const mark = fence[1][0].repeat(3)
      const lang = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(lines[i++])
      i++ // 吃掉收尾的围栏
      out.push(
        `<pre class="md-pre"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`
      )
      continue
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const lv = h[1].length
      out.push(`<h${lv} class="md-h md-h${lv}">${inl(h[2].replace(/\s+#+\s*$/, ''))}</h${lv}>`)
      i++
      continue
    }

    // 分隔线
    if (RULE.test(line) && line.trim().length >= 3) {
      out.push('<hr class="md-hr">')
      i++
      continue
    }

    // 表格：本行有 |，下一行是 |---|---|
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*-[\s|:-]*$/.test(lines[i + 1])) {
      const cells = (l: string): string[] =>
        l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      const align = cells(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'
      )
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(cells(lines[i++]))
      const th = head.map((c, k) => `<th style="text-align:${align[k] ?? 'left'}">${inl(c)}</th>`).join('')
      const tb = rows
        .map(
          (r) =>
            '<tr>' +
            head.map((_c, k) => `<td style="text-align:${align[k] ?? 'left'}">${inl(r[k] ?? '')}</td>`).join('') +
            '</tr>'
        )
        .join('')
      out.push(`<div class="md-tw"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`)
      continue
    }

    // 引用：连续的 > 行，内容递归渲染（引用里也能有标题/列表）
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote class="md-quote">${renderMarkdown(body.join('\n'), filePath)}</blockquote>`)
      continue
    }

    // 列表（按缩进处理嵌套）
    if (LIST.test(line)) {
      const consume = (minIndent: number): string => {
        const first = lines[i].match(LIST)!
        const ordered = /\d/.test(first[2])
        const items: string[] = []
        while (i < lines.length) {
          const m = lines[i].match(LIST)
          if (!m) {
            // 列表项的续行（缩进的普通文本）并进当前项
            if (!isBlank(lines[i]) && lines[i].search(/\S/) > minIndent && items.length) {
              items[items.length - 1] += '<br>' + inl(lines[i].trim())
              i++
              continue
            }
            break
          }
          const indent = m[1].length
          if (indent < minIndent) break
          if (indent > minIndent) {
            items[items.length - 1] += consume(indent)
            continue
          }
          // 任务列表
          const task = m[3].match(/^\[([ xX])\]\s+(.*)$/)
          i++
          if (task) {
            const on = task[1] !== ' '
            items.push(
              `<span class="md-task${on ? ' on' : ''}">${on ? '✓' : ''}</span>${inl(task[2])}`
            )
          } else {
            items.push(inl(m[3]))
          }
        }
        const tag = ordered ? 'ol' : 'ul'
        const cls = ordered ? 'md-ol' : 'md-ul'
        return `<${tag} class="${cls}">` + items.map((x) => `<li>${x}</li>`).join('') + `</${tag}>`
      }
      out.push(consume(line.match(LIST)![1].length))
      continue
    }

    // 段落：连续非空行合并，单换行保留为 <br>（技术文档常靠换行断句，全并成一行反而难读）
    const para: string[] = []
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,6}\s|\s*>|\s*(```|~~~))/.test(lines[i]) &&
      !LIST.test(lines[i])
    ) {
      para.push(lines[i++])
    }
    if (para.length) out.push(`<p class="md-p">${para.map((l) => inl(l.trim())).join('<br>')}</p>`)
  }

  return out.join('\n')
}
