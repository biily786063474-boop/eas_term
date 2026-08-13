// 往终端里插路径前的引号处理：路径含空格等 shell 特殊字符时包一层单引号，
// 内部单引号按 POSIX 写法转义（' → '\''）。
// CanvasDrawer（拖文件插文件路径）和 CanvasStage（拖模块/Frame 插项目路径）共用同一份——
// 引号规则要是分叉成两份，迟早对不上。
export function shellQuote(p: string): string {
  return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}
