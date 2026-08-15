// 对话流渲染：把 ChatView 变成看得见的消息列表。
//
// 三条视觉规则（task-4-brief.md，背景 spec §B.2）：
// ① 对话区只有用户消息与模型文字是主体（正常字号/对比度）；执行内容整体弱视觉层级。
// ② 执行区默认三行、随任务推进滚动刷新——三行窗口的判定不自己重写，直接调
//    visibleExecs()（Task 1 的产出，被 38 条测试锁住）。
// ③ 失败项必须有可辨识的样式，不能和成功项长得一样——不然 visibleExecs 保证的
//    「失败项常驻可见」在视觉上等于没发生（实测过 Claude 在 Write 被拒后仍说
//    「已创建完成」，界面必须让用户一眼看出这行执行是失败的，不能靠读文字反应过来）。
//
// **不要给这里任何一层加 React.memo，也不要按 ExecItem/Turn 的引用做 useMemo 依赖**：
// reduce.ts 的 view() 里 ExecItem 是原地 mutate（running → ok/failed 不换对象引用，
// turns 数组也是同一个引用被 push）。按引用比较的优化会把「状态变了」判定成「没变」，
// 第③条会因此彻底失效——这不是随手的代码风格建议，是专门为这条坑写的注释。
import { useEffect, useRef, useState } from 'react'
import type { ChatView, ExecItem, Turn } from './reduce.ts'
import { visibleExecs } from './reduce.ts'
import { ChevronDownIcon } from '../../ui/Icons'

export function MessageList({ view }: { view: ChatView }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 贴底滚动：新内容到达时，如果用户本来就在（接近）底部，跟着滚下去；如果用户
  // 手动往上翻了历史，不打断他——判据是「滚动前离底部够不够近」，不是「有新内容就强制滚」。
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [view])

  function handleScroll(): void {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div className="ac-messages" ref={scrollRef} onScroll={handleScroll}>
      {view.turns.map((turn, i) => (
        <MessageTurn key={i} turn={turn} />
      ))}
      {/* busy 但没有正在跑的 exec 的空档期（比如刚跑完一个工具、还没轮到下一段文字）——
          这条信息 Task 3 占位阶段就已经在显示了，这里只是把它挪进真实 UI，不是新概念。 */}
      {view.busy && (
        <div className="ac-busy-hint">
          <span className="ac-dot" aria-hidden="true" />
          处理中…
        </div>
      )}
    </div>
  )
}

function MessageTurn({ turn }: { turn: Turn }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const visible = turn.role === 'assistant' ? visibleExecs(turn.execs, expanded) : []
  const hasHidden = !expanded && visible.length < turn.execs.length

  return (
    <div className={`ac-turn ac-turn-${turn.role}`}>
      {turn.text && <div className="ac-turn-text">{turn.text}</div>}
      {turn.role === 'assistant' && turn.execs.length > 0 && (
        <div className="ac-execs">
          {visible.map((item) => (
            <ExecRow key={item.execId} item={item} expanded={expanded} />
          ))}
          <button
            type="button"
            className="ac-execs-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDownIcon size={11} className={expanded ? 'expanded' : ''} />
            {expanded ? '收起' : hasHidden ? `展开全部 ${turn.execs.length} 项` : '展开详情'}
          </button>
        </div>
      )}
    </div>
  )
}

/** 单条执行行。state 决定样式（running 轻微脉动 / failed 错误色常驻可见 / ok 弱层级），
 *  expanded 时额外露出 detail 与 output（点击「展开详情」时统一打开，不是逐行单独展开）。
 *  head（圆点+label）单独一层 flex row，body 作为下一行——不能让 body 和 head 挤在
 *  同一个 align-items:center 的行里，那会把展开的文本挤成一团。 */
function ExecRow({ item, expanded }: { item: ExecItem; expanded: boolean }): JSX.Element {
  return (
    <div className={`ac-exec-row ac-exec-${item.state}`}>
      <div className="ac-exec-row-head">
        <span className="ac-dot" aria-hidden="true" />
        <span className="ac-exec-label">{item.label}</span>
      </div>
      {expanded && (item.detail || item.output) && (
        <div className="ac-exec-body">
          {item.detail && <pre className="ac-exec-pre">{item.detail}</pre>}
          {item.output && <pre className="ac-exec-pre">{item.output}</pre>}
        </div>
      )}
    </div>
  )
}
