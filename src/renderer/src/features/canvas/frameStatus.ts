// 状态标签的查询工具。
//
// **列表本身已经不在这儿了** —— 看板的列是用户自己建的（存 board.json，
// 见 store 的 boardColumns），这里只提供「按 id 查名字 / 查颜色」和
// 「一个 Frame 归哪个项目、那个项目是什么状态」。
//
// 状态在 0.4.8 从 frame.status 提升到了 project.status：分屏里的 tab 和画布的 Frame
// 是两套结构，没进过画布的项目根本没有 Frame 可打标，所以状态只能归项目。
import type { BoardColumn, ProjectStatus } from '../../../../shared/types'
import { useStore } from '../../store'
import { projectIdOfFrame } from '../../store/canvasSlice'

/** 当前的列定义。给非 React 上下文用（右键菜单是普通函数，拿不到 hook） */
export const boardColumnsNow = (): BoardColumn[] => useStore.getState().boardColumns

/** 未设 / 指向一个已经被删掉的列 → 都算「未分类」。
 *  后者很重要：列删了但项目的 status 还留着旧 id，不兜住的话它在哪列都不显示 */
export const statusLabel = (s: ProjectStatus | undefined): string =>
  boardColumnsNow().find((c) => c.id === s)?.name ?? '未分类'

export const statusColor = (s: ProjectStatus | undefined): string | undefined =>
  boardColumnsNow().find((c) => c.id === s)?.color

/** 一个 Frame 显示什么状态 —— **查它所属项目**，不是查 Frame 自己。
 *  子 Frame（文件夹）跟着所属项目走，它没有独立的进度。 */
export function statusOfFrame(
  frames: { id: string; projectId: string | null; parentId?: string | null }[],
  projects: { id: string; status?: ProjectStatus }[],
  frameId: string
): ProjectStatus | undefined {
  const pid = projectIdOfFrame(frames, frameId)
  return pid ? projects.find((p) => p.id === pid)?.status : undefined
}
