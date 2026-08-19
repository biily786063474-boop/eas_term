// 极简 Markdown 渲染器（零依赖）。
//
// 为什么不用 marked/markdown-it：那要连带引入 DOMPurify 才安全，两个新依赖换一个
// 「把标题渲染大一点」的功能不划算。这里的策略是**先把所有文本转义，再拼我们自己生成的标签**，
// 所以文档里写的原始 HTML 一律当纯文本显示，天然没有 XSS 面。
//
// 覆盖：标题 / 围栏代码 / 引用 / 有序无序列表(含嵌套、任务列表) / 表格 / 分隔线 /
//       行内的 代码·粗体·斜体·删除线·链接·图片。够读技术文档，不追求 CommonMark 全兼容。
import { easfileUrl, isImagePath } from '../canvas/media'
import { stripFrontmatter } from './frontmatter'

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

// 代码块右上角那个复制图标。**只能拼字符串**：renderMarkdown 的产出是一段交给
// dangerouslySetInnerHTML 的 HTML 文本，里面没有 React 节点，复用不了 Icons.tsx 的
// CopyIcon 组件。几何形状直接照搬那两个，描边参数也对齐 Svg 基座（24 viewBox /
// 1.6 描边 / round 端点 / currentColor），免得这一个图标跟全局图标语言脱节。
const svg = (body: string, cls: string): string =>
  `<svg class="${cls}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const COPY_ICON = svg(
  '<rect x="9" y="9" width="13" height="13" rx="3"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'md-copy-i'
)
const DONE_ICON = svg('<polyline points="20 6 9 17 4 12"/>', 'md-copy-ok')

/** 给 renderMarkdown 产出的代码块复制按钮接上点击，返回解绑函数。
 *
 *  用事件委托而不是逐个 addEventListener：正文是整块 innerHTML 换掉的，
 *  切一次文件所有按钮节点就全没了，一个个挂的监听会跟着失效（而且旧节点还留在
 *  监听表里）。委托在容器上，换多少次内容都不用管。 */
export function bindCodeCopy(root: HTMLElement | null): () => void {
  if (!root) return () => {}
  const onClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest?.('.md-copy') as HTMLButtonElement | null
    if (!btn || !root.contains(btn)) return
    const code = btn.parentElement?.querySelector('code')
    if (!code) return
    // 取 textContent 不取 innerHTML：正文在渲染时被 esc() 转义过（`<` 存成 `&lt;`），
    // 读 HTML 会把这些实体原样复制出去，粘到终端里就是坏代码。
    void window.api.clipboard.writeText(code.textContent ?? '')
    btn.classList.add('done')
    window.setTimeout(() => {
      // 这 1.4s 里正文可能已经被换掉了，节点不在文档里就别碰
      if (btn.isConnected) btn.classList.remove('done')
    }, 1400)
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}

const RULE = /^\s*([-*_])\s*\1\s*\1[\s\S]*$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const isBlank = (l: string): boolean => !l.trim()

export function renderMarkdown(src: string, filePath: string): string {
  const baseDir = filePath.slice(0, filePath.lastIndexOf('/'))
  const lines = stripFrontmatter(src).replace(/\r\n?/g, '\n').split('\n')
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
      // 外面套一层 .md-codewrap 才能放复制按钮。**不能直接塞进 `<pre>`**：
      // `<pre>` 自己是 `overflow-x:auto` 的滚动容器，绝对定位的子元素属于它的可滚动内容，
      // 代码一宽、往右滚，按钮就跟着滑出视野。语言角标（data-lang）本来也有这个毛病，
      // 一并挪到外层顺手修掉。
      out.push(
        `<div class="md-codewrap"${lang ? ` data-lang="${esc(lang)}"` : ''}>` +
          `<button class="md-copy" type="button" title="复制代码" aria-label="复制代码">${COPY_ICON}${DONE_ICON}</button>` +
          `<pre class="md-pre"><code>${esc(body.join('\n'))}</code></pre>` +
          `</div>`
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
