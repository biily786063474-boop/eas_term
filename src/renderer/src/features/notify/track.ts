// 匿名使用统计的上报口。
//
// 单独包一层是为了两件事：
//   1. 调用点只写 track('term') 一行，不必到处判空
//   2. **能报什么一目了然** —— 想加新事件必须先来这里加名字，
//      顺手在业务代码里 bump 一个带项目名的 key 这条路是走不通的
//      （主进程还有一道白名单，见 main/telemetry.ts）
export type TrackKey =
  | 'term'
  | 'canvas'
  | 'voice'
  | 'image'
  | 'island'
  | 'approve'
  | 'view'
  | 'agent'

export function track(key: TrackKey): void {
  try {
    window.api?.telemetry?.bump(key)
  } catch {
    /* 统计永远不该让功能出错 */
  }
}
