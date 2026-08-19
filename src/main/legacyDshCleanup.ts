// 【历史残留清理】0.4.27–0.4.30 支持过 DeepSeek Harness，会往它每个 profile 的
// `cordis.patch.yml` 里写一段围栏包住的 MCP 配置。支持已经移除，但**装过的人机器上
// 还留着** —— 留着的话 dsh 每次启动都会去连一个已经不该存在的 MCP server。
//
// 这个文件只剩「摘掉那一段」这一半，生成那一半已经删了。纯函数、零 import，
// node --test 直接跑。清干净之后整个文件可以删掉。
//
// 为什么用围栏而不解析 YAML：这是**用户的 patch 层**（profile 里的注释原话
// 「Edit cordis.patch.yml, not this file」），他可能往里写任意条目。整份解析再回写
// 等于把他手写的注释、顺序、锚点按解析器的想法重排一遍。围栏只碰标记之间的行。
//
// 一个必须处理的边界：这个文件初始内容是 `[]`（空数组的 flow 写法）。摘掉围栏后
// 如果剩下的实质内容只是 `[]`，要一并去掉再补回去，否则同一文档里既有 flow 空数组
// 又有块序列，YAML 解析直接失败。

export const DSH_BEGIN = '# eas-term:begin 由 Eas-Term 自动维护，勿手改；删掉整段即可移除'
export const DSH_END = '# eas-term:end'

/** 摘掉我们那一段，围栏外原样保留。 */
export function stripDshRegion(raw: string): string {
  let body = raw
  const i = body.indexOf(DSH_BEGIN)
  const j = body.indexOf(DSH_END)
  if (i >= 0 && j > i) body = body.slice(0, i) + body.slice(j + DSH_END.length)

  // 判断剩下的实质内容：注释、空行不算
  const meaningful = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const onlyEmptyArray = meaningful.length === 1 && meaningful[0] === '[]'
  if (onlyEmptyArray) {
    body = body
      .split('\n')
      .filter((l) => l.trim() !== '[]')
      .join('\n')
  }

  body = body.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  // 清掉之后如果什么实质内容都不剩，把空数组还回去 —— 空文件不是合法的 patch 层
  const left = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  return left.length ? body + '\n' : body ? body + '\n[]\n' : '[]\n'
}
