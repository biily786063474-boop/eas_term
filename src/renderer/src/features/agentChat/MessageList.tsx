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
import { useEffect, useRef, useState, useMemo } from 'react'
import { optionsOf } from './options'
import type { ChatView, ExecItem, Turn } from './reduce.ts'
import { visibleExecs } from './reduce.ts'
import { ApprovalCard, prettyJson, type ApprovalDecision } from './ApprovalCard'
import { ChevronDownIcon } from '../../ui/Icons'
import { CanvasContextMenu } from '../../ui/CanvasContextMenu'
import { renderMarkdown, bindCodeCopy } from '../editor/markdown'
import { useLinkify } from './useLinkify.ts'
import { ThinkingOrb } from './ThinkingOrb'
import '../editor/editor.css'

export function MessageList({
  view,
  onApprovalDecide,
  leafId,
  onPickOption
}: {
  view: ChatView
  onApprovalDecide: (approvalId: string, decision: ApprovalDecision) => void
  /** 点了某个选项。**填进输入框，不自动发送** —— 选完常常还要补一句
   *  「但是 xxx」；而且不自动发意味着误点零代价，这是敢用启发式识别的前提之一 */
  onPickOption?: (text: string) => void
  /** 这个对话节点自己的 leafId —— 正文里点开网址时用它找「同一个 Frame」，
   *  好把网页开在旁边而不是系统浏览器里 */
  leafId?: string
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
      {view.turns.map((turn, i) =>
        // 压缩标记不是一条消息，走另一条渲染路径。**在这里分流而不是在
        // MessageTurn 里提前返回**：那个组件顶上有一串 hook，条件返回会违反
        // hook 规则（返回的分支少调几个 hook，React 直接报错）。
        turn.compact ? (
          <CompactDivider key={i} c={turn.compact} />
        ) : (
          <MessageTurn
            key={i}
            turn={turn}
            approval={i === lastIdx && pendingOnLastTurn ? view.pending : null}
            onApprovalDecide={onApprovalDecide}
            leafId={leafId}
            onPickOption={onPickOption}
          />
        )
      )}
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
          <ThinkingOrb />
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

/** 「上下文在这里被压缩了」的那道线。
 *
 *  **它的用途是止损，不是报喜**：这条线以上的内容 agent 已经不记得了，
 *  用户必须一眼看见，否则会拿着满屏历史继续追问「你刚才不是说过吗」。
 *  所以文案写的是「不再记得」而不是「已优化」。
 *
 *  token 数拿得到就写出来（「从 100 万压到 3.7 万」比「已压缩」有信息量得多），
 *  拿不到就不写 —— 不编。 */
function CompactDivider({ c }: { c: NonNullable<Turn['compact']> }): JSX.Element {
  const k = (n: number): string =>
    n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n)
  const nums = c.preTokens > 0 && c.postTokens > 0 ? `${k(c.preTokens)} → ${k(c.postTokens)} token` : ''
  return (
    <div className="ac-compact" role="separator">
      <span className="ac-compact-line" />
      <span className="ac-compact-txt">
        {/* **不知道就说中性的话。** stream 里多数时候不带 trigger，
            默认说成「自动」会把手动压缩说成「上下文满了」—— 编一件没发生的事 */}
        {c.trigger === 'auto'
          ? '上下文满了，自动压缩过'
          : c.trigger === 'manual'
            ? '你在这里压缩过上下文'
            : '这里压缩过上下文'}
        {c.droppedTurns > 0 && ` · 收起 ${c.droppedTurns} 轮`}
        {nums && ` · ${nums}`}
        <em>以上内容 agent 不再记得细节</em>
      </span>
      <span className="ac-compact-line" />
    </div>
  )
}

function MessageTurn({
  turn,
  approval,
  onApprovalDecide,
  leafId,
  onPickOption
}: {
  turn: Turn
  approval: ChatView['pending']
  onApprovalDecide: (approvalId: string, decision: ApprovalDecision) => void
  leafId?: string
  onPickOption?: (text: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // 正文里的网址/本地路径 → Ctrl+点击可跳。**依赖 turn.text**：流式输出时正文每帧
  // 都在变，不跟着重做的话只有第一帧那部分是可点的
  const mdRef = useRef<HTMLDivElement>(null)
  useLinkify(mdRef, turn.text, leafId)
  const visible = turn.role === 'assistant' ? visibleExecs(turn.execs, expanded) : []
  // 认不认得出「它在问你选哪个」。**流式输出时正文每帧都在变**，所以要跟着 text 走；
  // 但识别只在 assistant 轮次上做，用户自己发的话不解析
  const opts = useMemo(
    () => (turn.role === 'assistant' ? optionsOf(turn.text) : null),
    [turn.role, turn.text]
  )
  // 提问吸顶的两种形态：**在原位**时把话完整摊开（那是用户刚敲的原话，
  // 凭什么只给看两行）；**滚过去之后**收成一行路标，点它能滚回来。
  //
  // 为什么要哨兵：CSS 没有 `:stuck` 伪类，而 IntersectionObserver 直接观察
  // sticky 元素**测不出来** —— 它粘住时相对 root 静止、交叉比例不再变化，
  // 回调根本不触发。所以放一个高度为 0 的探针在它**外面**（放里面会跟着一起
  // 粘住、永远可见），探针滚出容器顶部的那一刻，就是这条开始吸顶的那一刻。
  const isUser = turn.role === 'user'
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const s = sentinelRef.current
    if (!isUser || !s) return
    const root = s.closest('.ac-messages')
    if (!root) return
    // rootMargin 把顶边上放 1px：滚动位置是小数、边界判定会抖，
    // 差一个像素就在「原位」和「吸顶」之间来回跳，看着像闪烁
    // 判据只有一处，IO 和滚动兜底都用它。
    //
    // **不能只看「不相交」** —— IntersectionObserver 对「滚出顶部」和「还在下方
    // 没滚到」报的是同一件事（都不相交）。只判 !isIntersecting 的话，一屏之外
    // **下方**那些还没读到的提问会被一起判成吸顶：提前收成一行、图片提前隐藏，
    // 滚到它跟前时再弹回原样——那一下又是一次高度突变。
    // 2026-08-23 实测：滚动位置 0% 时，5 条提问里有 4 条被误判成吸顶。
    const compute = (): void => {
      const r = s.getBoundingClientRect()
      setStuck(r.bottom <= root.getBoundingClientRect().top + 1)
    }
    const io = new IntersectionObserver(compute, { root, rootMargin: '1px 0px 0px 0px' })
    io.observe(s)

    // **IO 单独用不够**：它只在相交状态**发生变化**时回调，而
    // `el.scrollTop = el.scrollHeight`（上面那个自动滚到底）是一步到位的跳跃——
    // 哨兵从「下方不相交」直接变成「上方不相交」，布尔值没变，回调根本不触发，
    // 状态就此停在错的那一档。实测：跳着设 scrollTop 时，滚到底也只有第一条亮。
    // 用 debounce 而不是每帧重算：跳跃后内容已经静止，晚 120ms 校正看不出来，
    // 而每帧给每条提问读一次 rect 会在长对话里拖慢滚动。
    let t: number | undefined
    const onScroll = (): void => {
      window.clearTimeout(t)
      t = window.setTimeout(compute, 120)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    compute()
    return () => {
      io.disconnect()
      root.removeEventListener('scroll', onScroll)
      window.clearTimeout(t)
    }
  }, [isUser])
  const hasHidden = !expanded && visible.length < turn.execs.length

  return (
    <>
      {isUser && <div ref={sentinelRef} className="ac-stick-sentinel" aria-hidden="true" />}
      {/* 吸顶路标：**零高度 sticky 壳 + 绝对定位的条**，完全不占流。
          
          为什么不能像原来那样「让提问本身 sticky、吸顶时把图片收起来」——
          2026-08-23 在真实样式表上量到的自激振荡：图片一 display:none，
          这条提问的流内高度掉 104px，滚动容器随之变矮，浏览器的滚动锚定
          把 scrollTop 补偿回去，哨兵又回到视野内 → 判定翻回「在原位」→
          图片重现 → 再翻。实测是个稳定极限环：
            top=456 stuck=true  H=2549
            top=560 stuck=false H=2653   ← 无限来回
          一次匀速滚过全程，带图的提问翻转 7 次、不带图的 1 次。
          **状态的后果抵消了状态的成因**，这类环只能靠「让后果不影响成因」来断。
          
          只加 `overflow-anchor: none` 也能不闪（实测翻转降到 1 次），但那只是
          切断反馈路径 —— 高度突变还在，滚动中容器仍出现 6 种高度，表现为内容跳。
          路标改成不占流之后，全程只有 1 种高度（实测），两个毛病一起没。 */}
      {isUser && (
        <div className={`ac-signpost-wrap${stuck ? ' on' : ''}`} aria-hidden={!stuck}>
          <div
            className="ac-signpost"
            role="button"
            tabIndex={stuck ? 0 : -1}
            data-tip="回到这条提问"
            // 滚回**哨兵**而不是路标本身 —— 路标是固定在顶上的覆盖层，
            // scrollIntoView 到它等于原地不动
            onClick={(): void =>
              sentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            {turn.text}
          </div>
        </div>
      )}
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
          // 提问正文**永远是摊开的原位形态**，不再随吸顶变形 ——
          // 「收成一行」那件事交给上面那个不占流的路标做。
          // 这是高度恒定的前提：这个盒子一旦会变形，振荡就回来了。
          <div className="ac-turn-text">{turn.text}</div>
        ))}
      {approval && (
        <ApprovalCard pending={approval} onDecide={(d) => onApprovalDecide(approval!.approvalId, d)} />
      )}
      {/* 选项卡：**挂在正文下面，不替换也不折叠任何内容**。
          识别是启发式的（两个 CLI 都只把选项写进正文，没有结构化工具可用，
          见 options.ts 顶部那段），所以误判必须无害 ——
          认错了就是多几个能无视的按钮，认漏了跟现在一样。 */}
      {turn.role === 'assistant' && onPickOption && opts && (
        <div className="ac-opts">
          <div className="ac-opts-hd">{opts.lead}</div>
          {opts.options.map((o, i) => (
            <button
              key={i}
              className="ac-opt"
              onClick={() => onPickOption(o.label)}
              // 2026-09-02 起点了**直接发出去**（用户要的就是这个）。
              // 提示语得跟着改 —— 留着旧的比没有更糟：它明写「不会直接发出去」，
              // 用户照着这句话点，结果消息已经走了。
              title="点一下就把这条发出去"
            >
              <span className="ac-opt-n">{i + 1}</span>
              <span className="ac-opt-b">
                <span className="ac-opt-l">{o.label}</span>
                {o.detail && <span className="ac-opt-d">{o.detail}</span>}
              </span>
            </button>
          ))}
        </div>
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
    </>
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
