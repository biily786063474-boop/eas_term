// 剥掉 markdown 开头的 YAML frontmatter。
//
// **只在排版视图剥，源码视图仍看得到全文** —— 那是元数据不是正文，渲染出来就是
// 一堆 `name:` `description: >` 糊在文章开头（SKILL.md 在灯箱里打开时最明显）。
// 但它确实是文件内容的一部分，要改 description 的人得看得见，所以只在渲染这一侧
// 去掉，切「源代码」照旧完整。
//
// 单独一个文件而不是塞进 markdown.ts：那个文件引了 ../canvas/media，
// node --test 直接跑 .ts 时解析不了（值 import 必须带扩展名）。纯函数零依赖，
// 才测得动。

/**
 * 判据从严：**必须第一行就是 `---`**，且后面存在闭合的 `---`。
 * 松一点的话，正文里拿 `---` 当分割线的文档会被从头切掉一大块。
 */
export function stripFrontmatter(src: string): string {
  const t = src.replace(/^\uFEFF/, '')
  if (!/^---[ \t]*\r?\n/.test(t)) return src
  const m = t.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
  return m ? t.slice(m[0].length) : src
}
