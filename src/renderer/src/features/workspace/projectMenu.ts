// 项目行右键菜单的菜单项。终端侧栏和画布抽屉共用一份——
// 同一个动作在两个地方措辞不一样，用户会怀疑它们干的不是同一件事。
import { useStore } from '../../store'
import { collectLeaves } from '../../layout'
import type { CanvasMenuItem } from '../canvas/CanvasContextMenu'
import { FRAME_STATUS_LIST } from '../canvas/frameStatus'

export function projectMenuItems(
  projectId: string,
  /** 让调用方接管「进入内联改名态」（侧栏有输入框，画布抽屉没有就不传） */
  onStartRename?: (projectId: string) => void
): CanvasMenuItem[] {
  const s = useStore.getState()
  const p = s.projects.find((x) => x.id === projectId)
  if (!p) return []
  // 该项目名下还开着几个终端：移除会连它们一起关掉，得先说
  const ptys = s.tabs
    .filter((t) => t.projectId === projectId)
    .flatMap((t) => collectLeaves(t.root))
    .filter((l) => l.pane.kind === 'terminal').length

  return [
    // 状态标签。**分屏模式下打标的入口就是这里** —— 状态是项目的属性，
    // 不需要这个项目在画布上有 Frame。看板按它分列，画布 Frame 按它染色，三处同一份。
    ...FRAME_STATUS_LIST.map((x) => ({
      label: x.label,
      hint: p.status === x.key ? '当前' : undefined,
      onClick: () => void s.setProjectStatus(projectId, p.status === x.key ? null : x.key)
    })),
    {
      label: '未分类',
      disabled: !p.status,
      onClick: () => void s.setProjectStatus(projectId, null)
    },
    { sep: true, label: '', onClick: () => {} },
    {
      label: '在此项目打开新终端',
      // 双击项目行原来是这个动作，现在双击让位给重命名了，这里是它的主入口
      onClick: () => void s.openTerminal({ projectId })
    },
    ...(onStartRename
      ? [
          {
            label: '重命名',
            hint: '只改显示名，不动文件夹',
            onClick: () => onStartRename(projectId)
          } as CanvasMenuItem
        ]
      : []),
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
