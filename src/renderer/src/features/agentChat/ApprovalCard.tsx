// 审批卡片：唯一会卡住任务、必须人动手的东西——所以它**不用弱视觉层级**
// （spec §B.2 例外一）。执行区整体是弱对比度小字，这张卡片是故意的反例：
// 用户要看清「要跑什么命令 / 要改哪个文件」才有得选，埋进小字里等于没给他选择权。
import { useEffect, useState } from 'react'
import type { ApprovalPending } from './reduce.ts'
import { CheckIcon, ChevronDownIcon, CloseIcon, PencilIcon, PlugIcon, TerminalIcon } from '../../ui/Icons'

export type ApprovalDecision = 'allow' | 'deny'

/** detail / exec 的 output 都是 `JSON.stringify(input ?? {})` 拼出来的（见
 *  approvalRegistry.ts / claudeEvents.ts 的 safeStringify）——原样甩给用户是一坨
 *  没有换行的对象字面量。能 parse 就转成缩进 2 格的可读文本；parse 不了（比如
 *  exec 的 output 可能是命令行的纯文本 stdout，不是 JSON）就原样返回，不报错、
 *  不改内容——这是「格式化后再显示」的字面意思，不是「假设一切都是 JSON」。 */
export function prettyJson(raw: string): string {
  if (!raw) return raw
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function KindIcon({ kind }: { kind: ApprovalPending['kind'] }): JSX.Element {
  if (kind === 'exec') return <TerminalIcon size={13} />
  if (kind === 'patch') return <PencilIcon size={13} />
  return <PlugIcon size={13} />
}

const KIND_LABEL: Record<ApprovalPending['kind'], string> = {
  exec: '执行命令',
  patch: '修改文件',
  tool: '调用工具'
}

export function ApprovalCard({
  pending,
  onDecide
}: {
  pending: ApprovalPending
  onDecide: (decision: ApprovalDecision) => void
}): JSX.Element | null {
  const [decided, setDecided] = useState<ApprovalDecision | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // 新的一条审批请求到达（approvalId 变了）——不管上一条是怎么结束的，这里都要
  // 重新可见、重新可点，不能被上一条留下的「已点过」状态锁住。
  useEffect(() => {
    setDecided(null)
    setDetailOpen(false)
  }, [pending.approvalId])

  // 乐观隐藏：点了就立刻消失，不等 approval.resolved 事件回来才有反应。
  // 真正的状态仍然以事件为准——resolveApproval 无论命中与否，主进程
  // （approvalRoute.ts 的 onApprovalSettled）都保证最终会广播一次 approval.resolved：
  // 命中就是这次点击的决定；没命中（这个 approvalId 已经超时兜底 deny）也已经在
  // 超时那一刻广播过了。两条路径都会让 view.pending 清空，不存在「点了但卡死在
  // 隐藏状态、事件永远不来」的情况，所以这里不需要为失败做回滚。
  if (decided) return null

  function handleClick(decision: ApprovalDecision): void {
    setDecided(decision)
    onDecide(decision)
  }

  return (
    <div className="ac-approval">
      <div className="ac-approval-kind">
        <KindIcon kind={pending.kind} />
        <span>{KIND_LABEL[pending.kind]} · 需要你确认</span>
      </div>
      <div className="ac-approval-title">{pending.title}</div>
      {pending.cwd && <div className="ac-approval-cwd">{pending.cwd}</div>}
      {pending.detail && (
        <>
          <button
            type="button"
            className="ac-approval-detail-toggle"
            onClick={() => setDetailOpen((v) => !v)}
          >
            <ChevronDownIcon size={11} className={detailOpen ? 'expanded' : ''} />
            {detailOpen ? '收起详情' : '查看详情'}
          </button>
          {detailOpen && <pre className="ac-approval-detail">{prettyJson(pending.detail)}</pre>}
        </>
      )}
      <div className="ac-approval-actions">
        <button type="button" className="ac-approval-btn deny" onClick={() => handleClick('deny')}>
          <CloseIcon size={13} />
          拒绝
        </button>
        <button type="button" className="ac-approval-btn allow" onClick={() => handleClick('allow')}>
          <CheckIcon size={13} />
          允许
        </button>
      </div>
    </div>
  )
}
