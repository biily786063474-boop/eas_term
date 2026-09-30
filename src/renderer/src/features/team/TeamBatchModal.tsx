// 派活确认清单。**这是整套多 agent 里唯一不可跳过的一道闸门。**
//
// Frame 上那个开关管「这个项目能不能用多 agent」（长期），这张清单管
// 「这一批值不值」（每次）。开关开着不代表每件事都该组队 —— 你看到清单上
// 「4 个 agent、预估 $1.2」，完全可能说「不用这么麻烦」。
//
// 三条不能动的规矩：
//   1. **起进程之前弹**，不是起完再问。点「算了」时应该一个进程都还没起
//   2. 清单原样显示 AI 给的 goal 和 task，不润色、不帮它说得更正当
//      （同 SecretRequestModal 的规矩 2 —— 那是同一类「AI 借刀」的风险面）
//   3. 预估**标明是 AI 估的**，别让它冒充精确值
import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { ChipIcon } from '../../ui/Icons'
import { useT, t } from '../../i18n.ts'
import {
  currentBatchRequest,
  resolveBatchRequest,
  subscribeBatchRequest
} from './batchRequest'
import './team.css'

/** 粗糙的价格换算，只为给一个量级感。**不追求准** ——
 *  方案里定的原则：与其显示一个精心计算但错的数字，不如显示一个粗糙但真实的。 */
function roughCost(tokens: number): string {
  const usd = (tokens / 1000) * 0.02
  return usd < 0.1 ? '<$0.1' : t('teamUi.batch.costApprox', { usd: usd.toFixed(1) })
}

export function TeamBatchHost(): JSX.Element | null {
  const tr = useT()
  const req = useSyncExternalStore(subscribeBatchRequest, currentBatchRequest)
  const roles = useStore((s) => s.roles)
  if (!req) return null
  const { spec, cwd } = req

  return createPortal(
    <div className="tbm-mask">
      <div className="tbm" role="dialog" aria-modal="true">
        <div className="tbm-flag">
          <ChipIcon size={13} />
          <b>{tr('teamUi.batch.flag')}</b>{tr('teamUi.batch.flagTail')}
        </div>

        {/* 规矩 2：AI 的原话原样摆着。React 默认转义，不要改成 innerHTML */}
        <div className="tbm-goal">{spec.goal}</div>
        <div className="tbm-cwd" title={cwd}>
          {tr('teamUi.batch.runsIn', { dir: cwd.split('/').filter(Boolean).pop() ?? cwd })}
        </div>

        <div className="tbm-list">
          {spec.agents.map((a) => (
            <div className="tbm-row" key={a.role}>
              <span className="tbm-role">{a.role}</span>
              {a.roleId && (
                <span className="tbm-card" title={tr('teamUi.batch.roleCardTip')}>
                  {roles.find((r) => r.id === a.roleId)?.name ?? a.roleId}
                </span>
              )}
              <span className="tbm-task">{a.task}</span>
            </div>
          ))}
        </div>

        <div className="tbm-est">
          {tr('teamUi.batch.agentCount', { n: spec.agents.length })}
          {spec.estimateTokens ? (
            <>
              {' · '}
              <span className="tbm-est-num">
                {tr('teamUi.batch.estimate', { k: Math.round(spec.estimateTokens / 1000), cost: roughCost(spec.estimateTokens) })}
              </span>
              {/* 规矩 3：标明它是估的 */}
              <span className="tbm-est-hint">{tr('teamUi.batch.estimateHint')}</span>
            </>
          ) : (
            <span className="tbm-est-hint">{tr('teamUi.batch.noEstimate')}</span>
          )}
        </div>

        <div className="tbm-btns">
          <button className="tbm-ghost" onClick={() => resolveBatchRequest({ go: false })}>
            {tr('teamUi.batch.cancel')}
          </button>
          <button className="tbm-primary" onClick={() => resolveBatchRequest({ go: true })}>
            {tr('teamUi.batch.go')}
          </button>
        </div>
        <div className="tbm-foot">
          {tr('teamUi.batch.foot')}
        </div>
      </div>
    </div>,
    document.body
  )
}
