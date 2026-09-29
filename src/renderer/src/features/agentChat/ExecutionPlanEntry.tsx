import type { ChatView } from './reduce.ts'
import type { T } from '../../../../shared/i18n/index.ts'

// 单测用 vm 直接跑这个文件（没有 require），所以这里不能 import i18n 模块：
// 调用方把 t 传进来；没传时（只有测试会这样）退回下面这份中文。文案的真身在 dict/chat.zh.ts。
const ZH_FALLBACK: Record<string, string> = { // i18n-allow: 仅测试回退
  'chat.plan.entryAria': '查看执行清单：{done}/{total}，当前：{current}', // i18n-allow: 仅测试回退
  'chat.plan.entryLabel': '执行清单', // i18n-allow: 仅测试回退
  'chat.plan.entryCurrent': '当前：{title}', // i18n-allow: 仅测试回退
  'chat.plan.tbd': '待确认', // i18n-allow: 仅测试回退
  'chat.plan.executedNoPlan': '已执行但未建清单', // i18n-allow: 仅测试回退
  'chat.plan.noPlanThisTurn': '本轮未建立执行清单', // i18n-allow: 仅测试回退
  'chat.plan.askAiDraft': '让 AI 补建' // i18n-allow: 仅测试回退
}
const zhOnly = ((key: string, params?: Record<string, string | number>) =>
  (ZH_FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m))) as unknown as T

export function ExecutionPlanEntry({ summary, onOpen, t = zhOnly }: { summary: NonNullable<ChatView['plan']>; onOpen: () => void; t?: T }): JSX.Element {
  return <button type="button" className="ac-plan-entry" aria-label={t('chat.plan.entryAria', { done: summary.done, total: summary.total, current: summary.currentTitle })} onClick={onOpen}>
    <span className="ac-plan-entry-mark" aria-hidden="true">✓</span>
    <span>{t('chat.plan.entryLabel')} <strong>{summary.done}/{summary.total}</strong></span>
    <span className="ac-plan-entry-current">{t('chat.plan.entryCurrent', { title: summary.currentTitle || t('chat.plan.tbd') })}</span>
    <span aria-hidden="true">›</span>
  </button>
}

export function PlanMissingNotice({ state, onDraft, t = zhOnly }: { state: 'neutral' | 'executed'; onDraft?: () => void; t?: T }): JSX.Element {
  return <div className={`ac-plan-missing${state === 'executed' ? ' is-executed' : ''}`}>
    <span>{state === 'executed' ? t('chat.plan.executedNoPlan') : t('chat.plan.noPlanThisTurn')}</span>
    {onDraft && <button type="button" onClick={onDraft}>{t('chat.plan.askAiDraft')}</button>}
  </div>
}
