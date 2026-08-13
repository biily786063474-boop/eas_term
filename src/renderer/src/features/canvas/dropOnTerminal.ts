// 拖模块（Frame / 文件节点 / 组件节点 / 自由文件节点）落到终端上 → 把它所属项目的根路径
// 写进那个终端。拖文件插文件路径这条已经在资源抽屉里了（CanvasDrawer 的 startFileDrag），
// 这里是同一个手势的另一半：拖模块插项目路径。落点判定与写入方式照抄那边。
//
// 四个拖拽入口（CanvasStage 的 Frame 头部、CanvasFileNode、CanvasComponentNode、
// CanvasFreeFileNode）共用这一份实现——"怎么判定落点是终端、怎么写"完全一致，抄四遍的话
// 以后改一处漏三处是必然的。"怎么算出 projectPath"留给各自调用方：Frame/文件节点/组件节点
// 都是通过它们所在 Frame 的 projectId 解出来，自由节点不在任何 Frame 里，只能按路径前缀猜
// （猜不出就传 undefined，本函数会老实地什么都不做）。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import { shellQuote } from './shellQuote'

/**
 * @param ev mouseup 事件，用它的屏幕坐标判定落点
 * @param projectPath 要插入的项目根路径；调用方解不出项目就传 undefined/null，本函数直接
 *   返回 false，不吞、不插——移动本身不受影响，插路径只是附加动作
 * @returns 是否真的插入了（落点是终端 && projectPath 有值）
 */
export function dropModuleOnTerminal(ev: MouseEvent, projectPath: string | null | undefined): boolean {
  const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
  // 判据是 data-leaf-id 不是 pty id —— PaneLayer 上挂的是前者
  const termPane = el?.closest('.pane[data-leaf-id]') as HTMLElement | null
  if (!termPane?.dataset.leafId) return false
  const leaf = useStore
    .getState()
    .tabs.flatMap((t) => collectLeaves(t.root))
    .find((l) => l.id === termPane.dataset.leafId)
  if (leaf?.pane.kind !== 'terminal') return false
  if (!projectPath) return false
  // 和 startFileDrag 一样：直接写进 PTY，末尾带一个空格。
  // **不是**「插进输入栏」—— 那条路不存在，现有实现走的就是 pty.write
  window.api.pty.write(leaf.pane.ptyId, shellQuote(projectPath) + ' ')
  return true
}
