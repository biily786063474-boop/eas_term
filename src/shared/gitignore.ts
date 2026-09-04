// `.gitignore` 的**目录**匹配。只回答一个问题：扫源码时该不该进这个目录。
//
// **不是完整的 gitignore 实现**，也不需要是。完整语义包含否定、目录/文件区分、
// 相对嵌套 .gitignore、`**` 等等；这里只取「能判出目录该不该进」的那个子集，
// 判不了的一律**放行**（多扫一个目录只是图上多点东西，漏扫一个是图不全，
// 后者严重得多）。
//
// 为什么值得做：硬编「哪些目录不是源码」的名单永远列不全 ——
// 实测「美颜」把 696 个第三方 C/C++ 文件放在 `third_party/`、
// 「口播相机」的构建产物在 `build-dev/`，两个都不在任何通用名单里，
// 但两个项目的 `.gitignore` 里都写着。

/** 把一条 gitignore 模式编成正则。`*` 只在段内匹配，`?` 匹配一个字符。 */
function toRegExp(pattern: string, anchored: boolean): RegExp {
  const body = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*'
      if (ch === '?') return '[^/]'
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  // 锚定的：从根开始完整匹配；不锚定的：任意深度上的**一整段**
  return anchored ? new RegExp(`^${body}$`) : new RegExp(`(?:^|/)${body}$`)
}

/**
 * 从 `.gitignore` 的正文造一个「这个目录该不该跳过」的判断函数。
 *
 * @param text `.gitignore` 全文（没有就传空串）
 * @returns `(relDir) => boolean`，`relDir` 是相对项目根、`/` 分隔、不带尾斜杠
 */
export function gitignoreDirMatcher(text: string): (relDir: string) => boolean {
  const res: RegExp[] = []
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // **否定规则整条忽略。** 支持它要先算出「被否定的那部分」，
    // 而算错的方向是「跳过了本该扫的目录」—— 宁可不支持。
    if (line.startsWith('!')) continue
    // 看起来是文件模式（带扩展名且没有尾斜杠）就跳过 —— 我们只判目录
    const hadSlash = line.endsWith('/')
    line = line.replace(/\/+$/, '')
    if (!line) continue
    if (!hadSlash && /\.[A-Za-z0-9]+$/.test(line)) continue
    const anchored = line.startsWith('/') || line.includes('/')
    res.push(toRegExp(line.replace(/^\//, ''), anchored))
  }
  if (!res.length) return () => false
  return (relDir: string): boolean => res.some((re) => re.test(relDir))
}
