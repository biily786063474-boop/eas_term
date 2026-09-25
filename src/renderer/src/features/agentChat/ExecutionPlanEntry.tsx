import type { ChatView } from './reduce.ts'

export function ExecutionPlanEntry({ summary, onOpen }: { summary: NonNullable<ChatView['plan']>; onOpen: () => void }): JSX.Element {
  return <button type="button" className="ac-plan-entry" aria-label={`查看执行清单：${summary.done}/${summary.total}，当前：${summary.currentTitle}`} onClick={onOpen}>
    <span className="ac-plan-entry-mark" aria-hidden="true">✓</span>
    <span>执行清单 <strong>{summary.done}/{summary.total}</strong></span>
    <span className="ac-plan-entry-current">当前：{summary.currentTitle || '待确认'}</span>
    <span aria-hidden="true">›</span>
  </button>
}

export function PlanMissingNotice({ state, onDraft }: { state: 'neutral' | 'executed'; onDraft?: () => void }): JSX.Element {
  return <div className={`ac-plan-missing${state === 'executed' ? ' is-executed' : ''}`}>
    <span>{state === 'executed' ? '已执行但未建清单' : '本轮未建立执行清单'}</span>
    {onDraft && <button type="button" onClick={onDraft}>让 AI 补建</button>}
  </div>
}
