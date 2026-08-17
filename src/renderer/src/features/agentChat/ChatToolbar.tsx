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
// 模型/effort/沙箱的可选项全部来自 toolbarModel(caps)——不判断是哪个 CLI（spec §B.3）。
// **沙箱只做只读展示**：agentChat:setParams 的 patch 类型只收 { model?, effort? }
// （preload/index.ts 与 session.ts 的 IPC handler 都明确只读这两个字段），没有能中途
// 改沙箱的通道——沙箱只能在 start() 时定一次。渲染一个看着能选、点了却没反应的下拉，
// 比不渲染更糟，所以这里只把 sandboxLevels 列出来给用户看，不做成可交互控件。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CliCapabilities, CliInfo, AgentApprovalHookStatus } from '../../../../shared/agentChat.ts'
import type { ChatView } from './reduce.ts'
import { toolbarModel, formatUsage } from './toolbarModel.ts'
import { VoiceButton } from '../voice/VoiceButton'
import { stopVoiceOnSend } from '../voice/voiceControl'
import { useStore } from '../../store'
import { ChipIcon, CompressIcon, GaugeIcon, LockIcon, TrashIcon } from '../../ui/Icons'

const MAX_ROWS = 4
const LINE_H = 19

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
  onSend: (text: string) => void
  onSetParams: (patch: { model?: string; effort?: string }) => void
  /** 上一次 send() 失败的原因（会话已关闭/消息为空/正在处理上一条等)——AgentChatView
   *  持有 sessionId、由它 await window.api.agentChat.send() 的结果,这里只负责显示。 */
  sendError?: string | null
}): JSX.Element {
  const model = toolbarModel(caps, approvalHook)
  const [text, setText] = useState('')
  // 本地"当前选中"只是给下拉一个初始展示值——它不保证等于会话此刻真正在用的模型/effort
  // （start() 目前不传 model/effort,adapter 用自己的默认值;这里选中第一项只是合理的起点）。
  // 一旦用户真的改过一次,onSetParams 生效后这个本地值就和"下一条消息会用的值"对齐了。
  const [modelSel, setModelSel] = useState(() => model.models[0]?.id ?? '')
  const [effortSel, setEffortSel] = useState(() => model.effortLevels[0]?.id ?? '')
  const [hook, setHook] = useState<AgentApprovalHookStatus | null>(null)
  const [hookBusy, setHookBusy] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const aliveRef = useRef(true)
  useEffect(() => () => {
    aliveRef.current = false
  }, [])

  // 不走这套 hook 机制的 CLI 连查都不该查——那次 hookStatus() 查的是 Claude 的
  // <cwd>/.claude/settings.json，对它来说是一次毫无意义的文件读，读回来还会被拿去
  // 渲染一个跟它无关的开关（评审 I2）。
  const showApprovalHook = model.showApprovalHook
  const refreshHook = useCallback(async (): Promise<void> => {
    if (!showApprovalHook) return
    const s = await window.api.agentChat.hookStatus(cwd)
    if (aliveRef.current) setHook(s)
  }, [cwd, showApprovalHook])

  useEffect(() => {
    void refreshHook()
  }, [refreshHook])

  // notice 一来（典型就是"hook 装不上"那条)多半意味着 hook 状态刚变过,顺手刷新一次,
  // 不用等用户自己点开工具栏才发现状态是旧的。只按数量变化触发,不需要整个 view 做依赖。
  const noticeCount = view.notices.length
  useEffect(() => {
    if (noticeCount > 0) void refreshHook()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeCount])

  const handleUninstall = async (): Promise<void> => {
    setHookBusy(true)
    await window.api.agentChat.hookUninstall(cwd)
    await refreshHook()
    if (aliveRef.current) setHookBusy(false)
  }

  const submit = (): void => {
    const t = text.trim()
    if (!t) return
    // 任何"把用户的话发出去"的路径都该停一次麦——照抄 voiceControl.ts 的约定
    // （TerminalInput.tsx 的 send() 是唯一先例：不 await,消息该立刻走,收麦是它旁边的事）。
    void stopVoiceOnSend()
    setText('')
    if (taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.focus()
    }
    onSend(t)
  }

  const appendVoice = (t: string): void => {
    setText((prev) => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + t)
    requestAnimationFrame(() => {
      if (taRef.current) autoGrow(taRef.current)
    })
  }

  const usageText = model.showUsage ? formatUsage(view.usage, view.costUsd) : ''

  return (
    <div className="ac-toolbar">
      {(view.notices.length > 0 || sendError) && (
        <div className="ac-notices">
          {view.notices.map((n) => (
            <div key={n.id} className={`ac-notice${n.fatal ? ' ac-notice-fatal' : ''}`}>
              {n.text}
            </div>
          ))}
          {sendError && <div className="ac-notice ac-notice-fatal">{sendError}</div>}
        </div>
      )}

      <div className="ac-toolbar-meta">
        {!!usageText && (
          <span className="ac-meta-item">
            <GaugeIcon size={11} />
            {usageText}
          </span>
        )}

        {/* 只有声明「逐次审批靠那份 PreToolUse hook 文件」的 CLI 才渲染这一块——判据是
            能力声明（model.showApprovalHook ← CliInfo.approvalHook），不是 CLI 名字，
            也不是 capabilities.approval 非空那个碰巧重合的替身（评审 I2/I3）。 */}
        {model.showApprovalHook && (
          <span className="ac-meta-item">
            <LockIcon size={11} className={hook?.installed ? 'ac-hook-on' : 'ac-hook-off'} />
            审批保护 {hook ? (hook.installed ? '已开启' : '未开启') : '查询中…'}
            {hook?.installed && (
              <button
                type="button"
                className="ac-meta-btn"
                disabled={hookBusy}
                onClick={() => void handleUninstall()}
              >
                <TrashIcon size={10} />
                {hookBusy ? '卸载中…' : '卸载'}
              </button>
            )}
          </span>
        )}

        {model.showCompact && (
          <button
            type="button"
            className="ac-meta-btn"
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
            压缩上下文
          </button>
        )}

        {model.showSandbox && model.sandboxLevels.length > 0 && (
          <span
            className="ac-meta-item ac-sandbox-note"
            data-tip="沙箱级别在启动会话时就定下了，当前版本暂不支持中途切换"
          >
            沙箱：{model.sandboxLevels.map((s) => s.label).join(' / ')}
          </span>
        )}
      </div>

      <div className="ac-toolbar-row">
        <VoiceButton ptyId={sessionId} inline onText={appendVoice} />
        <textarea
          ref={taRef}
          className="ac-composer"
          rows={1}
          value={text}
          placeholder="继续和它说…（Enter 发送，Shift+Enter 换行）"
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
        />

        {model.showModel && (
          <div className="ac-param-group">
            <div className="ac-param-control">
              <ChipIcon size={11} />
              <select
                className="ac-param-select"
                value={modelSel}
                onChange={(e) => {
                  setModelSel(e.target.value)
                  onSetParams({ model: e.target.value })
                }}
              >
                {model.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="ac-param-hint">下条起生效</span>
          </div>
        )}

        {model.showEffort && (
          <div className="ac-param-group">
            <div className="ac-param-control">
              <span className="ac-param-label">强度</span>
              <select
                className="ac-param-select"
                value={effortSel}
                onChange={(e) => {
                  setEffortSel(e.target.value)
                  onSetParams({ effort: e.target.value })
                }}
              >
                {model.effortLevels.map((lv) => (
                  <option key={lv.id} value={lv.id}>
                    {lv.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="ac-param-hint">下条起生效</span>
          </div>
        )}

        <button type="button" className="ac-toolbar-send" onClick={submit} disabled={!text.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}
