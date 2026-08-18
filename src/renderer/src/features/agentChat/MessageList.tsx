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
//
// 审批卡片（Task 5）挂在这里：view.pending 非空时插在「当前最后一个轮次」的执行区
// 上方——它是唯一不弱化的例外（ApprovalCard.tsx 头部注释），别的都遵守规则①。
import { useEffect, useRef, useState } from 'react'
import type { ChatView, ExecItem, Turn } from './reduce.ts'
import { visibleExecs } from './reduce.ts'
import { ApprovalCard, prettyJson, type ApprovalDecision } from './ApprovalCard'
import { ChevronDownIcon } from '../../ui/Icons'
import { CanvasContextMenu } from '../canvas/CanvasContextMenu'
import { renderMarkdown, bindCodeCopy } from '../editor/markdown'
import { useLinkify } from './useLinkify.ts'
import '../editor/editor.css'

export function MessageList({
  view,
  onApprovalDecide
}: {
  view: ChatView
  onApprovalDecide: (approvalId: string, decision: ApprovalDecision) => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 贴底滚动：新内容到达时，如果用户本来就在（接近）底部，跟着滚下去；如果用户
  // 手动往上翻了历史，不打断他——判据是「滚动前离底部够不够近」，不是「有新内容就强制滚」。
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [view])

  // 代码块的复制按钮：渲染器生成 .md-copy，行为要单独绑一次（同 WikiView / CodeView）
  useEffect(() => bindCodeCopy(scrollRef.current), [])

  // 选中文字后右键 → 复制。沿用画布那套 CanvasContextMenu（终端输入框也是它），
  // 不另起一套菜单。**没选中就不接管**：那时候右键该交给底下的画布菜单
  // （新建节点之类），凭空弹一个只有「复制」且点了没用的菜单更糟。
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const onContextMenu = (e: React.MouseEvent): void => {
    const sel = window.getSelection()?.toString() ?? ''
    if (!sel.trim()) return
    e.preventDefault()
    // 画布/终端各自还挂着别的右键监听，这里既然接管了就摁住别往外冒
    // （同 TerminalInput 的处理）
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, text: sel })
  }

  function handleScroll(): void {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const lastIdx = view.turns.length - 1
  // 审批卡片挂在「当前最后一个轮次」的执行区上方（task-5-brief.md Step 2）。
  // 但 pending 到达时轮次列表可能还是空的（比如第一个工具调用在任何文字之前就要审批），
  // 或者最后一个轮次恰好是刚合并进来的用户消息（还没有对应的 assistant 轮次）——
  // 这两种情况都没有「执行区」可挂，卡片改为单独渲染在消息列表末尾，见下面的兜底分支。
  const lastTurnIsAssistant = lastIdx >= 0 && view.turns[lastIdx].role === 'assistant'
  const pendingOnLastTurn = view.pending !== null && lastTurnIsAssistant

  return (
    <div className="ac-messages" ref={scrollRef} onScroll={handleScroll} onContextMenu={onContextMenu}>
      {view.turns.map((turn, i) => (
        <MessageTurn
          key={i}
          turn={turn}
          approval={i === lastIdx && pendingOnLastTurn ? view.pending : null}
          onApprovalDecide={onApprovalDecide}
        />
      ))}
      {view.pending && !pendingOnLastTurn && (
        <ApprovalCard
          pending={view.pending}
          onDecide={(d) => onApprovalDecide(view.pending!.approvalId, d)}
        />
      )}
      {/* busy 但没有正在跑的 exec 的空档期（比如刚跑完一个工具、还没轮到下一段文字）——
          这条信息 Task 3 占位阶段就已经在显示了，这里只是把它挪进真实 UI，不是新概念。 */}
      {/* 忙不忙**只有一个真相**：归约器从事件流推出来的 view.busy
          （turn.start 起、turn.done 止）。渲染层曾经自己另记一个 awaiting，
          于是同一件事记在两处，必然漏掉某条路径——先是漏了「首字之前」，
          补上之后又漏了「第二条消息」。见 reduce.ts 里 turnActive 的说明。 */}
      {view.busy && (
        <div className="ac-busy-hint">
          <span className="ac-dot" aria-hidden="true" />
          <span className="ac-dot" aria-hidden="true" />
          <span className="ac-dot" aria-hidden="true" />
          正在处理…
        </div>
      )}
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: '复制',
              onClick: () => void navigator.clipboard.writeText(ctxMenu.text)
            }
          ]}
        />
      )}
    </div>
  )
}

function MessageTurn({
  turn,
  approval,
  onApprovalDecide
}: {
  turn: Turn
  approval: ChatView['pending']
  onApprovalDecide: (approvalId: string, decision: ApprovalDecision) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // 正文里的网址/本地路径 → Ctrl+点击可跳。**依赖 turn.text**：流式输出时正文每帧
  // 都在变，不跟着重做的话只有第一帧那部分是可点的
  const mdRef = useRef<HTMLDivElement>(null)
  useLinkify(mdRef, turn.text)
  const visible = turn.role === 'assistant' ? visibleExecs(turn.execs, expanded) : []
  const hasHidden = !expanded && visible.length < turn.execs.length

  return (
    <div className={`ac-turn ac-turn-${turn.role}`}>
      {/* 模型的回答按 Markdown 渲染 —— 它本来就是拿 Markdown 写的（标题、列表、代码块、
          粗体），当纯文本铺开就丢掉了全部层级，长回答会糊成一片。
          复用仓库里那个零依赖渲染器（WikiView / CodeView 同一个）：它**先把所有文本
          转义、再拼自己生成的标签**，所以模型输出里的原始 HTML 一律当纯文本显示 ——
          渲染别人生成的内容，这个性质比功能覆盖更要紧。
          第二个参数是「相对图片路径的基准目录」，对话没有对应的文件，给空串。
          用户自己发的消息保持纯文本：那是他刚敲进输入框的原话，照他写的样子显示才对。 */}
      {/* 用户带的图：显示图本身，不是那串路径。
          发给 CLI 的始终是磁盘路径（agent 认那个），这里只是让你看见自己发了什么。
          点一下用系统默认程序打开原图——缩略图只有 96px，看细节得开原件。 */}
      {turn.role === 'user' && turn.images && turn.images.length > 0 && (
        <div className="ac-turn-imgs">
          {turn.images.map((im) => (
            <img
              key={im.path}
              src={im.url}
              alt={im.path.split('/').pop() ?? ''}
              data-tip={im.path}
              onClick={() => void window.api.fs.showInFolder(im.path)}
            />
          ))}
        </div>
      )}
      {turn.text &&
        (turn.role === 'assistant' ? (
          <div
            ref={mdRef}
            // **md-view 这个类不能少** —— editor.css 里所有 markdown 样式都写成
            // `.md-view .md-h1` 这种带容器前缀的形式，少了它渲染器生成的类一条都匹配不上，
            // 出来的是浏览器默认样式的裸 HTML（标题巨大、间距全乱）。
            // ac-md 只做对话场景的收紧覆盖，见 agentChat.css。
            className="ac-turn-text ac-md md-view"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text, '') }}
          />
        ) : (
          <div className="ac-turn-text">{turn.text}</div>
        ))}
      {approval && (
        <ApprovalCard pending={approval} onDecide={(d) => onApprovalDecide(approval!.approvalId, d)} />
      )}
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
 *  expanded 时额外露出 detail 与 output（点击「展开详情」时统一打开，不是逐行单独展开），
 *  两者都过一遍 prettyJson——detail/output 常是 JSON.stringify 出来的一坨，原样甩给
 *  用户不算「展开完整执行历史」。head（圆点+label）单独一层 flex row，body 作为下一行——
 *  不能让 body 和 head 挤在同一个 align-items:center 的行里，那会把展开的文本挤成一团。 */
function ExecRow({ item, expanded }: { item: ExecItem; expanded: boolean }): JSX.Element {
  return (
    <div className={`ac-exec-row ac-exec-${item.state}`}>
      <div className="ac-exec-row-head">
        <span className="ac-dot" aria-hidden="true" />
        <span className="ac-exec-label">{item.label}</span>
      </div>
      {expanded && (item.detail || item.output) && (
        <div className="ac-exec-body">
          {item.detail && <pre className="ac-exec-pre">{prettyJson(item.detail)}</pre>}
          {item.output && <pre className="ac-exec-pre">{prettyJson(item.output)}</pre>}
        </div>
      )}
    </div>
  )
}
