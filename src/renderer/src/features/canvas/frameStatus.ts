// Frame 颜色状态标签的显示元数据：一个状态叫什么、排第几。
//
// 单独一份的理由：同一组状态要在三个地方出现——标题栏色点的下拉色板、
// 右键菜单、以及 CSS 里的配色规则。前两处的文案必须一字不差（同一个东西在
// 两个入口叫两个名字，用户会以为是两个功能），所以文案只留一份。
// 色值不在这儿——那是 canvas.css 里 .cframe.st-* 的事，改配色不该动 TS。
import type { FrameStatus } from '../../store'

export interface FrameStatusMeta {
  key: FrameStatus
  label: string
}

/** 顺序即色板/菜单里的顺序：按「事情往前走」的时间顺序排，不是按颜色排 */
export const FRAME_STATUS_LIST: FrameStatusMeta[] = [
  { key: 'todo', label: '待执行' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完结' }
]

export const frameStatusLabel = (s: FrameStatus | undefined): string =>
  FRAME_STATUS_LIST.find((x) => x.key === s)?.label ?? '无标签'
