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
import { ChipIcon } from '../../ui/Icons'
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
  return usd < 0.1 ? '<$0.1' : `约 $${usd.toFixed(1)}`
}

export function TeamBatchHost(): JSX.Element | null {
  const req = useSyncExternalStore(subscribeBatchRequest, currentBatchRequest)
  if (!req) return null
  const { spec, cwd } = req

  return createPortal(
    <div className="tbm-mask">
      <div className="tbm" role="dialog" aria-modal="true">
        <div className="tbm-flag">
          <ChipIcon size={13} />
          <b>AI 想开一批 agent 并行做这件事</b> —— 每个都是独立进程，各自烧额度
        </div>

        {/* 规矩 2：AI 的原话原样摆着。React 默认转义，不要改成 innerHTML */}
        <div className="tbm-goal">{spec.goal}</div>
        <div className="tbm-cwd" title={cwd}>
          在 {cwd.split('/').filter(Boolean).pop() ?? cwd} 里跑
        </div>

        <div className="tbm-list">
          {spec.agents.map((a) => (
            <div className="tbm-row" key={a.role}>
              <span className="tbm-role">{a.role}</span>
              <span className="tbm-task">{a.task}</span>
            </div>
          ))}
        </div>

        <div className="tbm-est">
          {spec.agents.length} 个 agent
          {spec.estimateTokens ? (
            <>
              {' · '}
              <span className="tbm-est-num">
                约 {Math.round(spec.estimateTokens / 1000)}K tok（{roughCost(spec.estimateTokens)}）
              </span>
              {/* 规矩 3：标明它是估的 */}
              <span className="tbm-est-hint">AI 自己的估计，面板上会显示真实累计</span>
            </>
          ) : (
            <span className="tbm-est-hint">AI 没给用量估计</span>
          )}
        </div>

        <div className="tbm-btns">
          <button className="tbm-ghost" onClick={() => resolveBatchRequest({ go: false })}>
            算了
          </button>
          <button className="tbm-primary" onClick={() => resolveBatchRequest({ go: true })}>
            开工
          </button>
        </div>
        <div className="tbm-foot">
          开工后这一批跑到底，中途不再打断你。任何时候都能在团队面板里停。
        </div>
      </div>
    </div>,
    document.body
  )
}
