// 聊天记录文件名的校验。抽出来是因为它是一道**路径穿越防线**，值得单独测。
//
// leafId 由渲染层传来。渲染层是我们自己的代码，但 IPC 边界上「来源可信」不是理由 ——
// 一个 `../../.claude.json` 就能让写入落到用户的配置文件上。这条判断不依赖任何调用方。

/** 只放行纯 id 形状的 key；其余一律拒绝（返回 null，调用方跳过读写）。 */
export function safeHistoryKey(id: string): string | null {
  if (!id || id.length > 120) return null
  // 画布 leafId 形如 `leaf-57-kk9qf`；只认字母数字、连字符、下划线。
  // **不做「过滤掉危险字符」式的清洗** —— 那种写法总有漏网（`....//`、URL 编码、
  // Unicode 同形字），白名单是唯一稳的做法。
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}
