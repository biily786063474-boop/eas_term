// tool-result 该发给哪些面板。**纯函数，有测试。**
//
// 2026-09-05 真机事故：面板自己调 tools/call → 宿主把 tool-result 广播给**所有**面板（含调用者）
// → 面板收到就 refresh → 又一次 tools/call → 又一次广播 …… 无限循环。面板不停重绘，
// 按钮在 mousedown 与 mouseup 之间被换掉，用户看到的是「面板操作不了」；日志里是成千上万条
// 没有响应的 tools/call。
//
// 规矩：**调用者自己不收自己那次调用的 tool-result** —— 它已经拿到了响应。别的面板收（同插件
// 多块面板要同步），模型那边（shim 路径）调的所有面板都收。
export interface FanoutPanel {
  session: string
  pluginName: string
}

export function recipients<T extends FanoutPanel>(panels: Iterable<T>, pluginName: string, excludeSession: string | null): T[] {
  const out: T[] = []
  for (const p of panels) {
    if (p.pluginName !== pluginName) continue
    if (excludeSession !== null && p.session === excludeSession) continue
    out.push(p)
  }
  return out
}
