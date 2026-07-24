// 画布终端节点的「Agent 控制台」控制条（画布独有 chrome；分屏模式 PaneView 不渲染这层）。
// 底层始终是真实 CLI：把 模型 / effort / 权限 等控件拼成一条命令，点「启动」写进真实终端执行。
// P0：只做 Claude Code（本机已装、参数已核对）；Codex 占位待接（P1）。

import { useStore } from '../../store'
import type { NodeAgent } from '../../store'
import { PlayIcon } from '../../ui/Icons'

const CLAUDE_MODELS: { v: string; label: string }[] = [
  { v: 'opus', label: 'Opus 4.8' },
  { v: 'sonnet', label: 'Sonnet 5' },
  { v: 'haiku', label: 'Haiku 4.5' },
  { v: 'fable', label: 'Fable 5' }
]
const EFFORTS: NodeAgent['effort'][] = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极限'
}
const PERMS: { v: NonNullable<NodeAgent['permission']>; label: string }[] = [
  { v: 'default', label: '默认询问' },
  { v: 'acceptEdits', label: '接受编辑' },
  { v: 'plan', label: '规划模式' },
  { v: 'skip', label: '跳过全部(危险)' }
]

/** 把 agent 配置拼成 Claude Code 启动命令 */
function buildClaudeCmd(a: NodeAgent): string {
  const parts = ['claude']
  if (a.cont) parts.push('-c')
  if (a.model) parts.push('--model', a.model)
  if (a.effort) parts.push('--effort', a.effort)
  if (a.permission === 'acceptEdits') parts.push('--permission-mode', 'acceptEdits')
  else if (a.permission === 'plan') parts.push('--permission-mode', 'plan')
  else if (a.permission === 'skip') parts.push('--dangerously-skip-permissions')
  return parts.join(' ')
}

export function CanvasAgentBar({
  frameId,
  nodeId,
  ptyId
}: {
  frameId: string
  nodeId: string
  ptyId: string
}): JSX.Element {
  const agent = useStore(
    (s) => s.canvas.frames.find((f) => f.id === frameId)?.nodes.find((n) => n.id === nodeId)?.agent
  )
  const setNodeAgent = useStore((s) => s.setNodeAgent)

  const patch = (p: Partial<NodeAgent>): void =>
    setNodeAgent(frameId, nodeId, { kind: 'claude', ...(agent ?? {}), ...p } as NodeAgent)

  const launch = (): void => {
    if (!agent) return
    const cmd = agent.kind === 'claude' ? buildClaudeCmd(agent) : ''
    if (cmd) window.api.pty.write(ptyId, cmd + '\r')
  }

  return (
    <div className="agentbar" onMouseDown={(e) => e.stopPropagation()}>
      {/* Agent 切换段控件 */}
      <div className="ab-seg">
        <button
          className={!agent ? 'on' : ''}
          onClick={() => setNodeAgent(frameId, nodeId, null)}
          title="纯终端"
        >
          无
        </button>
        <button
          className={agent?.kind === 'claude' ? 'on' : ''}
          onClick={() =>
            setNodeAgent(frameId, nodeId, {
              kind: 'claude',
              model: 'opus',
              effort: 'high',
              permission: 'default'
            })
          }
        >
          Claude Code
        </button>
        <button className="soon" disabled title="即将支持">
          Codex
        </button>
      </div>

      {agent?.kind === 'claude' && (
        <>
          <label className="ab-ctl">
            <span>模型</span>
            <select value={agent.model ?? 'opus'} onChange={(e) => patch({ model: e.target.value })}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ab-ctl">
            <span>Effort</span>
            <div className="ab-effort">
              {EFFORTS.map((e) => (
                <button
                  key={e}
                  className={agent.effort === e ? 'on' : ''}
                  onClick={() => patch({ effort: e })}
                >
                  {EFFORT_LABEL[e as string]}
                </button>
              ))}
            </div>
          </div>

          <label className="ab-ctl">
            <span>权限</span>
            <select
              value={agent.permission ?? 'default'}
              onChange={(e) => patch({ permission: e.target.value as NodeAgent['permission'] })}
            >
              {PERMS.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className={`ab-cont${agent.cont ? ' on' : ''}`}
            onClick={() => patch({ cont: !agent.cont })}
            title="启动时带 -c 继续上次会话"
          >
            继续会话
          </button>

          <button className="ab-launch" onClick={launch} title="把命令写入终端并启动">
            <PlayIcon size={12} /> 启动
          </button>
        </>
      )}
    </div>
  )
}
