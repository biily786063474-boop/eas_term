// 从对话文本里认出「网址」和「本地路径」。纯函数、零 import，node --test 直接跑。
//
// 为什么要可测：这类识别最容易想当然 —— `src/main.ts:42` 是路径带行号还是
// 「路径 + 冒号 + 数字」？句末的 `见 http://x.com。` 那个句号算不算 URL 的一部分？
// 中文写作里这些边界每天都在发生，靠肉眼看渲染结果验不出来。

export type LinkKind = 'url' | 'path'

export interface LinkHit {
  kind: LinkKind
  /** 原文里的起止（用于切片，不做替换） */
  start: number
  end: number
  /** 要打开的目标：url 原样；path 去掉行号后缀 */
  target: string
  /** 路径带的行号（`file.ts:42` 的 42），没有则 undefined */
  line?: number
}

// 裸网址。**末尾的中英文标点不算 URL 的一部分** —— 中文写作里
// 「详见 https://x.com/a。」那个句号属于句子，吞进去会打开一个 404。
// **中文标点直接排除在字符类外**，不能指望事后剥尾巴：
// 「见 https://x.com/y，然后」里逗号后面还有字，只剥结尾根本剥不到它。
// URL 里合法但中文写作中几乎不出现的字符（，。、；：！？）一律不吃。
const URL_RE = /\bhttps?:\/\/[^\s<>"'）)】\]，。、；：！？…]+/g
// 尾部要剥掉的标点（成对括号已在字符类里排除，这里处理句末标点）
// **中文标点必须逐个列全**：第一版漏了「，」，于是「见 https://x.com/y，然后」
// 会把逗号吞进 URL。这类漏字肉眼看渲染结果验不出来，只能靠测试逐个钉住。
const TRAIL = /[。，、；：！？…·。,.;:!?]+$/

// 本地路径。**必须带路径分隔符** —— 只有 `README` 两个字的话，
// 那更可能是正文里在说这份文件，而不是一个可点的路径。
// 认三种：绝对路径 /a/b、家目录 ~/a/b、相对路径 src/a/b（至少一层目录）。
const PATH_RE = /(?:^|[\s(（「『"'`])((?:~\/|\/|\.{1,2}\/)?(?:[\w.@+-]+\/)+[\w.@+-]+)(?::(\d+))?/g
// 纯数字构成的「路径」是分数或日期，不是文件：`比例 3/4`、`12/25`。
// 判据是**至少有一段含非数字字符** —— 只看有没有扩展名不够，
// `src/main` 这种没扩展名的目录路径也该认。
const ALL_NUMERIC = /^[\d/]+$/

/** 尾部标点剥离后的 URL。 */
function trimUrl(raw: string): string {
  return raw.replace(TRAIL, '')
}

/**
 * 扫出文本里所有可点的目标。**按出现顺序、不重叠**。
 *
 * 只认「看起来确实是」的：URL 必须带 http(s) 协议头，路径必须含分隔符。
 * 宁可漏认，也不要把正文里的普通词变成可点的东西 —— 误认会让人点开一堆无关的东西，
 * 比漏认烦人得多。
 */
export function findLinks(text: string): LinkHit[] {
  const hits: LinkHit[] = []
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const target = trimUrl(m[0])
    if (!target) continue
    hits.push({ kind: 'url', start: m.index, end: m.index + target.length, target })
  }
  PATH_RE.lastIndex = 0
  for (let m = PATH_RE.exec(text); m; m = PATH_RE.exec(text)) {
    const raw = m[1]
    if (!raw) continue
    if (ALL_NUMERIC.test(raw)) continue // 3/4、12/25 这类是分数或日期
    // 前导分隔符不算进命中范围
    const start = m.index + m[0].indexOf(raw)
    const end = start + raw.length + (m[2] ? m[2].length + 1 : 0)
    // 与已认出的 URL 重叠就跳过 —— URL 里的 // 会被路径正则再认一次
    if (hits.some((h) => start < h.end && end > h.start)) continue
    hits.push({
      kind: 'path',
      start,
      end,
      target: raw,
      line: m[2] ? Number(m[2]) : undefined
    })
  }
  return hits.sort((a, b) => a.start - b.start)
}

/** 这次点击算不算「要跳转」。用户要的是 Ctrl 点击；mac 上 Cmd 也收。 */
export function isFollowClick(e: { ctrlKey?: boolean; metaKey?: boolean; button?: number }): boolean {
  if (e.button !== undefined && e.button !== 0) return false // 只认左键
  return e.ctrlKey === true || e.metaKey === true
}

/**
 * 把一段纯文本按命中切成片段，供渲染层包 <a>。
 * 返回的片段拼起来 === 原文（不丢字、不改字）—— 这条由测试钉住。
 */
export function splitByLinks(text: string): { text: string; hit?: LinkHit }[] {
  const hits = findLinks(text)
  if (!hits.length) return [{ text }]
  const out: { text: string; hit?: LinkHit }[] = []
  let at = 0
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start) })
    out.push({ text: text.slice(h.start, h.end), hit: h })
    at = h.end
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
