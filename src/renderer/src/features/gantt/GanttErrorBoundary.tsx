// 甘特图专用错误边界（2026-08-08 新需求：「甘特图数据如果有崩溃，不要影响其他正常的终端」）。
//
// 为什么不能只靠 main.tsx 那个根级 ErrorBoundary：根级边界包着整个 <App/>，
// GanttStage 只是它底下众多兄弟节点之一（跟 PaneLayer/Sidebar/TabBar 同级）——
// React 的错误边界规则是"冒泡到最近的一个"，GanttStage 抛错但自己这一层没有
// 边界接住的话，会一路冒泡到根级，根级一接住就把 <App/> 整棵树卸载成兜底页，
// 结果是甘特图崩了，终端、画布、看板全部跟着从屏幕上消失——正是用户明确要求
// 不能发生的事。这里在 <GanttStage/> 外面单独包一层，出事只掉这一块：标题栏、
// ModeSwitch、PaneLayer（终端真身）照常挂载、照常能用，用户可以直接点标题栏
// 切到别的视图，不需要等甘特图这边恢复。
//
// fallback 也不走根级那套 location.reload()——那会把整个渲染进程重启一遍，
// 所有终端的 xterm 视图要重新走一遍恢复流程，对"只是甘特图这一块坏了"来说
// 代价过重、也没必要。这里只需要清掉边界自己的 error state 就能让 <GanttStage/>
// 重新挂载，它挂载时本来就会重新拉一遍 gantt:list()。
import { ReactNode } from 'react'
import { useStore } from '../../store'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { TrashIcon } from '../../ui/Icons'

function GanttCrashFallback({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)

  // 「清空全部并重试」是最后一道自救手段：如果崩溃是某条历史记录的数值
  // 离谱到连渲染层的防线（isSaneTask 那道过滤、follow 的 Array.isArray 判断）
  // 都没能挡住的地步，光"重试"没用——remount 一次只会立刻在同一条记录上
  // 再炸一次。清空全部记录能保证下次挂载不会再摸到任何一条坏数据。
  // 仍然过 requestConfirm 确认：这个兜底页也可能是因为一次无关的、偶发的
  // 渲染异常触发（不是数据问题），此时"清空全部"是过度反应，不该没有确认就做。
  const clearAndRetry = (): void => {
    requestConfirm({
      message:
        '清空全部甘特图记录并重试？\n\n这会删掉全部历史记录（不影响终端本身、不影响项目文件），操作不可撤销。',
      confirmLabel: '清空并重试',
      onConfirm: () => {
        void window.api.gantt.clear().then(() => reset())
      }
    })
  }

  return (
    <div className="gantt-crash">
      <div className="gantt-crash-card">
        <div className="gantt-crash-title">甘特图视图遇到了一个错误</div>
        <div className="gantt-crash-desc">
          不影响终端、画布、看板——可以直接切到其他视图继续用。这里可以先重试；如果反复
          出错，大概率是某条历史记录的数据有问题，清空甘特图的全部记录后重试即可（只清
          历史记录，不影响正在跑的终端）。
        </div>
        <pre className="gantt-crash-msg">{error.message || String(error)}</pre>
        <div className="gantt-crash-btns">
          <button className="gantt-crash-btn primary" onClick={reset}>
            重试
          </button>
          <button className="gantt-crash-btn danger" onClick={clearAndRetry}>
            <TrashIcon size={12} />
            清空全部记录并重试
          </button>
        </div>
      </div>
    </div>
  )
}

export function GanttErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary
      label="gantt"
      fallback={(error, reset): ReactNode => <GanttCrashFallback error={error} reset={reset} />}
    >
      {children}
    </ErrorBoundary>
  )
}
