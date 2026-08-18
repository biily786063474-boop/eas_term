// 对话态底部工具栏：继续对话的常驻入口 + 模型/effort 选择 + 系统提示。
//
// 常驻四件（用户明确指定）：语音输入按钮、模型选择、effort 选择、发送 CTA。
// 用量与压缩按钮"次级"——次级不等于"藏起来点了才看到"，沿用 MessageList 执行区那套
// 语言（task-4-brief.md 规则①）：小字弱层级，但**始终可见**，不需要额外点击才能看见。
//
// notices 的显示是硬验收项：view.notices 里的每条都要渲染出来，不能只进 console——
// 那是"审批 hook 装不上时告知而非阻断"这条裁定唯一的说服力所在（见 reduce.ts 文件头、
// task-6-brief.md Step 2）。
//
// 这条硬约束要求的是「显示」，**不是「永久占据版面且不可关闭」**（2026-08-17 全分支
// 最终评审 I5）。所以现在：内容相同的合并成一条 + 计数（归约器负责）、数组有上限、
// 容器有 max-height + overflow（CSS 负责）、每条可以关掉（本文件负责）。
// 关闭记的是"关闭那一刻它发生过几次"——同一条之后又发生一次就会重新出现，
// 不会因为关过一次就把一次**新的**"这次会话没有审批保护"永久静音掉。
//
// 模型/effort/沙箱的可选项全部来自 toolbarModel(caps)——不判断是哪个 CLI（spec §B.3）。
// **沙箱只做只读展示**：agentChat:setParams 的 patch 类型只收 { model?, effort? }
// （preload/index.ts 与 session.ts 的 IPC handler 都明确只读这两个字段），没有能中途
// 改沙箱的通道——沙箱只能在 start() 时定一次。渲染一个看着能选、点了却没反应的下拉，
// 比不渲染更糟，所以这里只把 sandboxLevels 列出来给用户看，不做成可交互控件。
import { useEffect, useRef, useState } from 'react'
import type { CliCapabilities, CliInfo } from '../../../../shared/agentChat.ts'
import type { ChatView } from './reduce.ts'
import { toolbarModel, formatUsage } from './toolbarModel.ts'
import { VoiceButton } from '../voice/VoiceButton'
import { stopVoiceOnSend } from '../voice/voiceControl'
import { useStore } from '../../store'
import { ChipIcon, CloseIcon, CompressIcon, GaugeIcon, ImageIcon, SendIcon } from '../../ui/Icons'
import { usePastedImages } from '../terminal/usePastedImages'

const MAX_ROWS = 4
const LINE_H = 19
/** 用量仪表盘的展开状态。**默认收起** —— 想知道的时候才看，常驻会把要用的控件挤走 */
const GAUGE_KEY = 'eas.agentchat.gauge'

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, LINE_H * MAX_ROWS) + 'px'
}

export function ChatToolbar({
  caps,
  approvalHook,
  view,
  cwd,
  sessionId,
  onSend,
  onSetParams,
  sendError
}: {
  caps: CliCapabilities
  /** 这个 CLI 的逐次审批用哪种机制（原样来自 CliInfo.approvalHook）。**决定了工具栏
   *  那个「审批保护」chip 与「卸载」按钮出不出现**——它们读写的是
   *  <cwd>/.claude/settings.json 里 Claude 的 PreToolUse hook，对不走这套机制的 CLI
   *  显示它就是错的信息（2026-08-17 全分支最终评审 I2：在 Codex 节点上 chip 会显示
   *  「已开启」，而 Codex 根本没有逐次审批、权限由沙箱决定，工具栏另一侧同时还在显示
   *  沙箱级别，两条信息互相矛盾；那个「卸载」点下去删的还是 Claude 的 hook）。 */
  approvalHook?: CliInfo['approvalHook']
  view: ChatView
  /** 装/查/卸审批 hook 都是按项目走的,不是按会话——同一个项目下别的 agent 节点/
   *  别的会话装过的痕迹,这里也要如实显示（见 shared/agentChat.ts 的 AgentApprovalHookStatus
   *  注释：状态按 cwd 查,不是全局唯一一份）。 */
  cwd: string
  /** 只用来给 VoiceButton 占位。它只在 onText 缺失时才会把定稿写去
   *  window.api.pty.write(ptyId, ...)——这里始终提供了 onText,那条兜底路径永远不会被真正
   *  调用。传会话 id 只是给它一个稳定、每个会话独立的占位值,不是真的 pty id。 */
  sessionId: string
  /** 返回「这条真的送出去了吗」。false = 没送成，工具栏会把文字放回输入框（评审 I4）。
   *  返回 void 也允许（比如将来某个调用方不关心结果），那时按"不知道"处理、不回填。 */
  /** 第一个参数是**真正发给 CLI 的内容**（图片路径拼在文字前面）。
   *  第二个是给界面用的：纯文字 + 缩略图，让对话流显示图本身而不是一串路径。 */
  onSend: (
    text: string,
    meta?: { text: string; images: { path: string; url: string }[] }
  ) => Promise<boolean> | void
  onSetParams: (patch: { model?: string; effort?: string }) => void
  /** 上一次 send() 失败的原因（会话已关闭/消息为空/正在处理上一条等)——AgentChatView
   *  持有 sessionId、由它 await window.api.agentChat.send() 的结果,这里只负责显示。 */
  sendError?: string | null
}): JSX.Element {
  const model = toolbarModel(caps, approvalHook)
  const [text, setText] = useState('')
  // 初始选中必须是空串——那是下面下拉里的「（默认）」占位项，代表"我们不覆盖 CLI 自己的
  // 默认值"（2026-08-17 全分支最终评审 I7）。
  //
  // 修复前这里是 `model.models[0]?.id`，两处同时出错：
  //   ① 显示的是假值。AgentChatView 调 start() 时**根本不传 model/effort**，CLI 用的是
  //      自己的默认；而工具栏写着 Claude 的 models[0]=「Fable」、effortLevels[0]=「低」，
  //      旁边还标着「下条起生效」——等于对着一个错的"当前值"声称它是当前值。
  //   ② 那个值还点不动。它在下拉里已经是选中态，onChange 不触发，想真用 Fable 得先切走
  //      再切回来。
  // 没有改成"start() 时把这两个值一起传下去"（评审给的另一条）：那会把 models[0] 变成
  // 事实上的强制默认，静默覆盖用户在 CLI 自己的配置/GUI 菜单里设好的模型——为修一个
  // 显示问题去改所有人的实际行为，方向反了。占位项这条则让控件如实说话：没选就是
  // "跟随 CLI 默认"，选了才有覆盖，而且每一个真实选项都点得动。
  const [modelSel, setModelSel] = useState('')
  const [effortSel, setEffortSel] = useState('')
  const [showGauge, setShowGauge] = useState(() => localStorage.getItem(GAUGE_KEY) === '1')
  // 粘贴/拖入图片、带入画布快照——**与终端输入框共用同一份实现**（用户要求两边一致）。
  // 复用连同那几条踩过坑的规则一起继承：拖进来的原地引用不复制、剪贴板位图先落盘、
  // 缩略图不能用 blob URL（file:// 页面下 origin 是 null，<img> 会静默失败）。
  const pics = usePastedImages()
  const [dragOver, setDragOver] = useState(false)
  const lastSnapshot = useStore((s) => s.lastSnapshot)
  const setLastSnapshot = useStore((s) => s.setLastSnapshot)
  /** noticeId → 关闭那一刻它的 count（见下面 visibleNotices 的注释） */
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const taRef = useRef<HTMLTextAreaElement>(null)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const aliveRef = useRef(true)
  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  // 审批保护的开关、状态与卸载入口 2026-08-17 全部搬到了右上角设置面板。
  // 工具栏这里原来有一个「审批保护 已开启/未开启」chip 加一个「卸载」按钮 ——
  // 它们占着每天都要看的那一行，说的却是一件装完就基本不动的事。
  // 内核那侧一个字没动（隔离标记 / 写前备份 / 一键卸载都还在），只是入口换了地方。

  const submit = (): void => {
    const t = text.trim()
    // 只有图没有字也该能发（同终端输入框：图本身就是内容）
    if (!t && !pics.imgs.length) return
    // 图片路径排在文字前面，跟终端那边同一套拼法（agent 先看到「有图」再读要求）
    const paths = pics.pathPrefix()
    const payload = paths ? (t ? `${paths} ${t}` : paths) : t
    // 界面要显示的是图本身和你打的字，不是拼好的那串路径 —— 缩略图这会儿还在内存里，
    // 跟着消息带过去就行，不用等下再去磁盘重读一遍。
    const shots = pics.imgs.map((i) => ({ path: i.path, url: i.url }))
    pics.clearImgs()
    // 任何"把用户的话发出去"的路径都该停一次麦——照抄 voiceControl.ts 的约定
    // （TerminalInput.tsx 的 send() 是唯一先例：不 await,消息该立刻走,收麦是它旁边的事）。
    void stopVoiceOnSend()
    setText('')
    if (taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.focus()
    }
    // 发送失败要把用户打的字放回输入框（2026-08-17 全分支最终评审 I4）。
    // 对 Codex 这是**常态路径而非边缘**：它的 stdin 是 'ignore'，上一轮还在跑时
    // deliverMessage 直接返回「当前会话正在处理上一条消息，请稍候再发送」。修复前
    // 用户看到的是：自己那句话已经出现在对话流里（看起来发出去了）、输入框空了、
    // 底下一行小字——想重发只能重新打一遍，长消息就是白打。
    void Promise.resolve(onSend(payload, { text: t, images: shots })).then((ok) => {
      if (ok !== false || !aliveRef.current) return
      // 这几十毫秒里用户可能已经开始打下一句：那就把失败的这条接在前面，
      // 绝不覆盖他新打的内容——"不丢用户打的字"是这条修复的全部意义。
      setText((cur) => (cur ? `${t}\n${cur}` : t))
      requestAnimationFrame(() => {
        if (!taRef.current) return
        autoGrow(taRef.current)
        taRef.current.focus()
      })
    })
  }

  const appendVoice = (t: string): void => {
    setText((prev) => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + t)
    requestAnimationFrame(() => {
      if (taRef.current) autoGrow(taRef.current)
    })
  }

  const usageText = model.showUsage ? formatUsage(view.usage, view.costUsd) : ''
  // 整数百分比：小数位在这个尺寸下读不出来，还会让数字宽度跳来跳去
  const ctxPct =
    model.showUsage && typeof view.usage?.contextRatio === 'number'
      ? Math.round(view.usage.contextRatio * 100)
      : null

  // 关掉过的 notice 记的是「关闭那一刻它已经发生过几次」，不是一个"关过就永远别再出现"
  // 的开关（评审 I5 要求可关闭，但硬约束要求 {k:'error',fatal:false} 必须显示）：
  // 同一条 notice 之后**又发生了一次**（count 涨了）就重新出现——那是新信息，
  // 不是刚才那条的残留。归约器把重复内容合并成一条，所以这里靠 count 而不是靠新 id。
  const visibleNotices = view.notices.filter((n) => n.count > (dismissed[n.id] ?? 0))

  return (
    <div className="ac-toolbar">
      {(visibleNotices.length > 0 || sendError) && (
        <div className="ac-notices">
          {visibleNotices.map((n) => (
            <div key={n.id} className={`ac-notice${n.fatal ? ' ac-notice-fatal' : ''}`}>
              <span className="ac-notice-text">
                {n.text}
                {n.count > 1 && <span className="ac-notice-count">×{n.count}</span>}
              </span>
              <button
                type="button"
                className="ac-notice-close"
                aria-label="关闭这条提醒"
                title="关闭这条提醒"
                onClick={() => setDismissed((prev) => ({ ...prev, [n.id]: n.count }))}
              >
                <CloseIcon size={10} />
              </button>
            </div>
          ))}
          {/* sendError 不给关闭按钮：它不是累积的 notice，是"上一次发送"的即时状态，
              下一次发送时 AgentChatView 会自己清掉（setSendError(null)）。 */}
          {sendError && (
            <div className="ac-notice ac-notice-fatal">
              <span className="ac-notice-text">{sendError}</span>
            </div>
          )}
        </div>
      )}

      {/* **输入区是一个容器，不是几条横带。**
          之前图片缩略图、快照提示、控制行、输入行各占一条，加上 notices 能叠到五层，
          界面被切成一片一片（用户原话「把图切的很碎」）。现在图片、文字、控件全部
          收进同一个圆角框内部分层，外面只剩 notices。
          拖放挂在容器上：整个框都是落点，不用瞄准某一行。 */}
      <div
        className={`ac-composer-box${dragOver ? ' dragover' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          // 进入子元素也会触发 dragleave，用坐标判断是不是真的离开了这个框
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(false)
          void pics.takeFiles([...e.dataTransfer.files])
        }}
      >
        {showGauge && !!usageText && <div className="ac-gauge-row">{usageText}</div>}
        {pics.err && <div className="ac-inline-err">{pics.err}</div>}

        {/* 图片区：快照占位块和已带上的图排在同一行，都是「这条消息要带的东西」 */}
        {(pics.imgs.length > 0 || lastSnapshot) && (
          <div className="ac-attach-row">
            {lastSnapshot && (
              <button
                type="button"
                className="ac-attach-snap"
                data-tip="把刚拍的画板快照带上"
                onClick={() => void pics.takeSnapshotIn()}
              >
                <ImageIcon size={13} />
                <span>刚拍的快照</span>
              </button>
            )}
            {pics.imgs.map((im) => (
              <div className="ac-attach" key={im.path} data-tip={im.path}>
                <img src={im.url} alt={im.name} />
                <button
                  type="button"
                  className="ac-attach-x"
                  aria-label="移除这张图"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pics.dropImg(im)
                  }}
                >
                  <CloseIcon size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          className="ac-composer"
          rows={1}
          value={text}
          placeholder="继续和它说…（Enter 发送，Shift+Enter 换行，可粘贴/拖入图片）"
          onChange={(e) => {
            setText(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (!files.length) return // 纯文本粘贴走默认行为
            e.preventDefault()
            void pics.takeFiles(files)
          }}
        />

        {/* 控件行在框内底部。模型/强度与压缩、用量同级——它们都是「这次对话怎么跑」，
            跟输入框是一体的，不该是上面另起的一条带子。 */}
        <div className="ac-composer-bar">
          {/* 上下文占用：**常驻**，不跟着用量数字一起收起来。
              它回答的是「还能聊多久」——那是随时想瞥一眼的东西，不是要主动去查的统计。
              分母来自 result 事件的 modelUsage[<model>].contextWindow（claudeEvents.ts
              的 contextRatioOf），拿不到就整个不渲染，绝不显示一个猜出来的比例。 */}
          {ctxPct !== null && (
            <div
              className={`ac-ctx${ctxPct >= 85 ? ' hot' : ctxPct >= 65 ? ' warm' : ''}`}
              data-tip={`上下文已用 ${ctxPct}%${model.showCompact ? '（可以点「压缩」腾地方）' : ''}`}
            >
              <span className="ac-ctx-track">
                <span className="ac-ctx-fill" style={{ width: `${ctxPct}%` }} />
              </span>
              <span className="ac-ctx-num">{ctxPct}%</span>
            </div>
          )}

          {model.showModel && (
            <div
              className={`ac-param-control${modelSel !== '' ? ' pending' : ''}`}
              // 提示里报的是 **CLI 自己说它在用什么**（view.model ← session.ready），
              // 不是我们记的选择。改模型走 /model 命令，实测那条命令本身那一轮仍用旧模型、
              // 下一条才切过去——所以「下条起生效」这句依然准确，只是现在能对照真值了。
              data-tip={
                view.model
                  ? modelSel !== ''
                    ? `当前实际在用 ${view.model}，下条消息起换成所选`
                    : `当前实际在用 ${view.model}`
                  : modelSel !== ''
                    ? '下条消息起生效'
                    : undefined
              }
            >
              <ChipIcon size={11} />
              <select
                className="ac-param-select"
                value={modelSel}
                onChange={(e) => {
                  setModelSel(e.target.value)
                  onSetParams({ model: e.target.value })
                }}
              >
                <option value="">模型：默认</option>
                {model.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 强度用滑块而不是下拉：这几档是**有序的**（低→最高），滑块能一眼看出
              「现在在哪一档、还能往上多少」，下拉只能看到一个孤立的值。
              第 0 格是「默认」（不覆盖 CLI 自己的设置），所以格数是档位数 + 1。
              档位数按 capabilities 来，不写死 —— Codex 只有三档。 */}
          {model.showEffort && (
            <div
              className={`ac-effort${effortSel !== '' ? ' pending' : ''}`}
              data-tip={
                effortSel === ''
                  ? '思考强度：跟随 CLI 默认。拖动可指定'
                  : `思考强度：${model.effortLevels.find((l) => l.id === effortSel)?.label ?? effortSel}（下条消息起生效）`
              }
            >
              <input
                className="ac-effort-range"
                type="range"
                min={0}
                max={model.effortLevels.length}
                step={1}
                value={effortSel === '' ? 0 : model.effortLevels.findIndex((l) => l.id === effortSel) + 1}
                aria-label="思考强度"
                onChange={(e) => {
                  const i = Number(e.target.value)
                  const id = i === 0 ? '' : (model.effortLevels[i - 1]?.id ?? '')
                  setEffortSel(id)
                  onSetParams({ effort: id })
                }}
              />
              <span className="ac-effort-label">
                {effortSel === ''
                  ? '默认'
                  : (model.effortLevels.find((l) => l.id === effortSel)?.label ?? effortSel)}
              </span>
            </div>
          )}

          {model.showCompact && (
            <button
              type="button"
              className="ac-bar-btn"
              data-tip="把之前的对话换成一份摘要"
              onClick={() => {
                void stopVoiceOnSend()
                requestConfirm({
                  message:
                    '压缩会把之前的对话换成一份摘要，细节不可恢复（agent 之后只记得摘要里的内容）。继续吗？',
                  confirmLabel: '压缩',
                  onConfirm: () => onSend('/compact')
                })
              }}
            >
              <CompressIcon size={11} />
              压缩
            </button>
          )}

          {!!usageText && (
            <button
              type="button"
              className={`ac-bar-btn${showGauge ? ' on' : ''}`}
              data-tip={showGauge ? '收起用量' : '展开用量（输入/输出/缓存/花费）'}
              onClick={() => {
                const next = !showGauge
                setShowGauge(next)
                if (next) localStorage.setItem(GAUGE_KEY, '1')
                else localStorage.removeItem(GAUGE_KEY)
              }}
            >
              <GaugeIcon size={11} />
            </button>
          )}

          {model.showSandbox && model.sandboxLevels.length > 0 && (
            <span
              className="ac-bar-note"
              data-tip="沙箱级别在启动会话时就定下了，当前版本暂不支持中途切换"
            >
              沙箱：{model.sandboxLevels.map((s) => s.label).join(' / ')}
            </span>
          )}

          <span className="ac-bar-spacer" />
          <VoiceButton ptyId={sessionId} inline onText={appendVoice} />
          <button
            type="button"
            className="ac-bar-send"
            data-tip="发送（Enter）"
            onClick={submit}
            disabled={!text.trim() && !pics.imgs.length}
          >
            <SendIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
