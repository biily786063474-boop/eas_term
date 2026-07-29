// 项目行右键菜单的菜单项。终端侧栏和画布抽屉共用一份——
// 同一个动作在两个地方措辞不一样，用户会怀疑它们干的不是同一件事。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { CanvasMenuItem } from '../canvas/CanvasContextMenu'

export function projectMenuItems(projectId: string): CanvasMenuItem[] {
  const s = useStore.getState()
  const p = s.projects.find((x) => x.id === projectId)
  if (!p) return []
  // 该项目名下还开着几个终端：移除会连它们一起关掉，得先说
  const ptys = s.tabs
    .filter((t) => t.projectId === projectId)
    .flatMap((t) => collectLeaves(t.root))
    .filter((l) => l.pane.kind === 'terminal').length

  return [
    {
      label: '在此项目打开新终端',
      onClick: () => void s.openTerminal({ projectId })
    },
    {
      label: '在访达中显示',
      onClick: () => void window.api.fs.showInFolder(p.path)
    },
    { sep: true, label: '', onClick: () => {} },
    {
      label: '从列表移除',
      danger: true,
      // 说清楚不动文件：「移除」两个字本身没法让人放心，看到这行才敢点
      hint: ptys ? `会关掉 ${ptys} 个终端` : '不删除文件',
      onClick: () => void s.removeProject(projectId)
    }
  ]
}
