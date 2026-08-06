// Frame 颜色状态标签的显示元数据：一个状态叫什么、排第几。
//
// 单独一份的理由：同一组状态要在三个地方出现——标题栏色点的下拉色板、
// 右键菜单、以及 CSS 里的配色规则。前两处的文案必须一字不差（同一个东西在
// 两个入口叫两个名字，用户会以为是两个功能），所以文案只留一份。
// 色值不在这儿——那是 canvas.css 里 .cframe.st-* 的事，改配色不该动 TS。
import type { FrameStatus } from '../../store'
import { projectIdOfFrame } from '../../store/canvasSlice'

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

/** 一个 Frame 显示什么状态 —— **查它所属项目**，不是查 Frame 自己。
 *  状态在 0.4.8 从 frame.status 提升到了 project.status：分屏里的 tab 和画布的 Frame
 *  是两套结构，没进过画布的项目根本没有 Frame 可打标，所以状态只能归项目。
 *  子 Frame（文件夹）跟着所属项目走，它没有独立的进度。 */
export function statusOfFrame(
  frames: { id: string; projectId: string | null; parentId?: string | null }[],
  projects: { id: string; status?: FrameStatus }[],
  frameId: string
): FrameStatus | undefined {
  const pid = projectIdOfFrame(frames, frameId)
  return pid ? projects.find((p) => p.id === pid)?.status : undefined
}
