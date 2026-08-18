// 灵动岛错误兜底里那行摘要。单独一个文件是为了能测 —— 零 import，node --test 直接跑。
//
// **这是给人看的，不是给日志看的。** 岛只有一条胶囊那么宽，塞整个 stack 会把窗口撑坏；
// 完整错误落在 <userData>/island-error.log 里，这行只负责让用户一眼说得出
// 「它报的是 TypeError xxx」—— 用户原话是「我又报错了，我看不到错误」。

/** 一行能读的错误摘要：类型名 + 头一句，超长截断。 */
export function briefError(e: { name?: string; message?: string } | null | undefined): string {
  if (!e) return '未知错误'
  const name = e.name && e.name !== 'Error' ? `${e.name}: ` : ''
  // **不能 String(e) 兜底**：没有 message 的对象会变成 "[object Object]"，
  // 显示给用户等于没说。宁可回一句「未知错误」，至少不误导。
  const msg = String(e.message ?? '').split('\n')[0].trim()
  const full = (name + msg).trim()
  if (!full) return '未知错误'
  return full.length > 90 ? full.slice(0, 88) + '…' : full
}
