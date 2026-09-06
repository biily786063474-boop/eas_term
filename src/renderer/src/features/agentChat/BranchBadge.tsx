// 分支徽标：这次会话跑在哪棵 worktree、哪条分支上。
//
// **两处渲染同一个组件**（空态的上下文条 `ac-ctxbar`、对话态的控件行
// `ac-composer-bar`）—— 会话跑着的时候正是最需要看到分支的时候，
// 而两条 return 是完全独立的 JSX 树，不抽出来就得抄两遍、日后改一处漏一处。
//
// 它和「角色选择器」不是一回事，别拿 ChatToolbar 里那条「角色入口不许放对话态」
// 的禁令套过来：角色契约走系统提示、只在 spawn 时读一次，摆在对话态是个改了
// 也不生效的开关；而分支是**这一刻的事实**，跑着的时候读它永远是对的。
// 会跑偏的只有「删 worktree」那一条，那条由调用方在有活会话时置 disabled。
//
// tooltip 只写事实：真正的目录、以及「有别的分支在改同一个文件」这一句。
// 不写各家怎么落地。
import { GitBranchIcon } from '../../ui/Icons'

export function BranchBadge({
  worktree,
  effectiveCwd,
  overlap,
  onOpenMenu,
  className = 'ac-ctxbar-item as-btn'
}: {
  worktree: { relPath: string; branch: string }
  /** 真正跑在哪 —— 项目根 + relPath，不是项目根 */
  effectiveCwd: string
  /** 协同板上有没有别的分支在改同一个文件 */
  overlap: boolean
  onOpenMenu: (e: React.MouseEvent) => void
  /** 宿主那条工具栏自己的胶囊样式。空态给 `ac-ctxbar-item as-btn`，
   *  对话态给 `ac-bar-btn` —— 两条工具栏的字号/边框本来就不是一套，
   *  硬统一会让徽标在其中一条里显得不合群。 */
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      className={`${className} ac-branch${overlap ? ' warn' : ''}`}
      data-tip={`${effectiveCwd}${overlap ? '\n⚠ 有别的分支在改同一个文件，改前先 board_read' : ''}`}
      onClick={onOpenMenu}
    >
      <GitBranchIcon size={12} />
      <span className="ac-ctxbar-name">{worktree.branch}</span>
    </button>
  )
}
