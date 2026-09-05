// 角色编辑面板。抽屉里点某个角色打开。
//
// 只做真正影响产出的三样：**职责契约**、模型/思考档位、用哪个 CLI。
// 颜色分组那类装饰项不给表单——为了个配色写一堆控件不划算，需要的话直接改
// ~/.eas/roles.json（编辑器保存的就是那个文件）。
//
// 弹成独立面板而不是塞进抽屉：抽屉只有 238px 宽，契约是多行长文本，挤在那里没法写。
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { AgentRole, AgentProbe, AgentKind, HarnessId, RoleCaps } from '../../../../shared/types'
import { getProbe } from './CanvasAgentBar'
import { CloseIcon, TrashIcon, UndoIcon } from '../../ui/Icons'
import { BUILTIN_HINT } from './roleDefaults'

type Kind = HarnessId

const EFFORT_ZH: Record<string, string> = {
  off: '关',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极限'
}

const OMP_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function CanvasRoleEditor({
  roleId,
  onClose
}: {
  /** 空串 = 新建 */
  roleId: string
  onClose: () => void
}): JSX.Element | null {
  const roles = useStore((s) => s.roles)
  const saveRoles = useStore((s) => s.saveRoles)
  const resetRoles = useStore((s) => s.resetRoles)
  const [probe, setProbe] = useState<AgentProbe | null>(null)
  // 本机实际配了哪些 Codex MCP server —— 摆出来让用户点，别让他手打
  const [servers, setServers] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 手写框默认收着 —— 点选够用了。已经写过自定义规则的角色打开就展开，否则那些规则藏着看不见
  const [showRaw, setShowRaw] = useState(false)

  const original = useMemo(
    () => roles.find((r) => r.id === roleId) ?? null,
    // 只在打开时取一次原始值：保存后 roles 会变，不该把用户正在编辑的内容冲掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleId]
  )
  const [draft, setDraft] = useState<AgentRole>(
    () =>
      original ?? {
        // 新建：id 用时间戳兜底唯一；用户改名字不改 id，避免绑了这个角色的终端失联
        id: 'custom-' + Math.random().toString(36).slice(2, 8),
        name: '新角色',
        desc: '',
        group: 'output',
        color: '#a3a3a3',
        kind: 'auto',
        model: {},
        effort: {},
        contract: ''
      }
  )

  // 已经写过自定义规则的角色：打开就把手写框展开，否则那几条规则等于藏起来了
  useEffect(() => {
    if (original?.raw?.claude?.deny?.length) setShowRaw(true)
  }, [original])

  useEffect(() => {
    let live = true
    void getProbe().then((p) => live && setProbe(p))
    void window.api.agent.codexServers().then((v) => live && setServers(v))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const set = (patch: Partial<AgentRole>): void => setDraft((d) => ({ ...d, ...patch }))
  const setPer = (field: 'model' | 'effort', k: Kind, v: string): void =>
    setDraft((d) => ({ ...d, [field]: { ...(d[field] ?? {}), [k]: v || undefined } }))
  const setCap = (k: 'write' | 'shell' | 'imageGen', off: boolean): void =>
    setDraft((d) => {
      const caps = { ...(d.caps ?? {}) }
      if (off) caps[k] = false
      else delete caps[k]
      return { ...d, caps: Object.keys(caps).length ? caps : undefined }
    })
  /** 改 caps.mcp 的某一列；空了就把 mcp / caps 整个收掉，保持「缺省即允许」 */
  const withMcp = (d: AgentRole, field: 'denyServers' | 'denyTools', list: string[]): AgentRole => {
    const mcp: NonNullable<RoleCaps['mcp']> = { ...(d.caps?.mcp ?? {}) }
    if (list.length) mcp[field] = list
    else delete mcp[field]
    const caps: RoleCaps = { ...(d.caps ?? {}) }
    if (mcp.denyServers || mcp.denyTools) caps.mcp = mcp
    else delete caps.mcp
    return { ...d, caps: Object.keys(caps).length ? caps : undefined }
  }
  const setMcp = (field: 'denyServers' | 'denyTools', list: string[]): void => setDraft((d) => withMcp(d, field, list))
  const lines = (text: string): string[] => text.split('\n').map((x) => x.trim()).filter(Boolean)
  /** 点一下切换某个 server。**必须在函数式更新里读当前值**（连点两个 chip 的旧 bug） */
  const toggleServer = (name: string): void =>
    setDraft((d) => {
      const cur = d.caps?.mcp?.denyServers ?? []
      return withMcp(d, 'denyServers', cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name])
    })
  const setRawClaude = (text: string): void =>
    setDraft((d) => {
      const deny = lines(text)
      const raw = { ...(d.raw ?? {}), claude: deny.length ? { deny } : undefined }
      if (!raw.claude) delete raw.claude
      return { ...d, raw: Object.keys(raw).length ? raw : undefined }
    })

  const commit = async (next: AgentRole[]): Promise<void> => {
    setBusy(true)
    const e = await saveRoles(next)
    setBusy(false)
    if (e) setErr(e)
    else onClose()
  }

  const onSave = (): void => {
    if (!draft.name.trim()) {
      setErr('名字不能为空')
      return
    }
    const exists = roles.some((r) => r.id === draft.id)
    void commit(exists ? roles.map((r) => (r.id === draft.id ? draft : r)) : [...roles, draft])
  }

  const onDelete = (): void => void commit(roles.filter((r) => r.id !== draft.id))

  const rawDeny = draft.raw?.claude?.deny ?? []
  const denyServers = draft.caps?.mcp?.denyServers ?? []
  const denyTools = draft.caps?.mcp?.denyTools ?? []

  const kinds: { k: AgentKind | 'auto'; label: string; note: string }[] = [
    { k: 'auto', label: '跟随', note: '装了哪个用哪个' },
    { k: 'claude', label: 'Claude', note: '钉死' },
    { k: 'codex', label: 'Codex', note: '钉死' }
  ]

  const perKind = (k: Kind): JSX.Element => {
    const disabled = draft.kind !== 'auto' && draft.kind !== k
    if (k === 'omp') {
      return (
        <div className={`re-kind${disabled ? ' off' : ''}`} key={k}>
          <div className="re-kind-name">默认 harness</div>
          <input
            value={draft.model?.omp ?? ''}
            onChange={(e) => setPer('model', 'omp', e.target.value)}
            placeholder="provider/model，留空跟随"
            disabled={disabled}
          />
          <select
            value={draft.effort?.omp ?? ''}
            onChange={(e) => setPer('effort', 'omp', e.target.value)}
            disabled={disabled}
          >
            <option value="">默认档位</option>
            {OMP_THINKING.map((x) => (
              <option key={x} value={x}>
                {EFFORT_ZH[x] ?? x}
              </option>
            ))}
          </select>
        </div>
      )
    }
    const models = probe?.[k].models ?? []
    const efforts = probe?.[k].efforts ?? []
    return (
      <div className={`re-kind${disabled ? ' off' : ''}`} key={k}>
        <div className="re-kind-name">{{ claude: 'Claude', codex: 'Codex', omp: '默认 harness' }[k]}</div>
        <select
          value={draft.model?.[k] ?? ''}
          onChange={(e) => setPer('model', k, e.target.value)}
          disabled={disabled}
        >
          <option value="">默认模型</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={draft.effort?.[k] ?? ''}
          onChange={(e) => setPer('effort', k, e.target.value)}
          disabled={disabled}
        >
          <option value="">默认档位</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {EFFORT_ZH[x] ?? x}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return createPortal(
    <div className="re-mask" onMouseDown={onClose}>
      <div className="re-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="re-head">
          <span className="re-dot" style={{ background: draft.color }} />
          <input
            className="re-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="角色名"
          />
          {draft.builtin && <span className="re-badge">内置</span>}
          <button className="re-x" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="re-body">
          <label className="re-field">
            <span className="re-label">一句话说明</span>
            <input
              value={draft.desc}
              onChange={(e) => set({ desc: e.target.value })}
              placeholder="抽屉里悬停时显示"
            />
          </label>

          <div className="re-field">
            <span className="re-label">用哪个 CLI</span>
            <div className="re-seg">
              {kinds.map((x) => (
                <button
                  key={x.k}
                  className={draft.kind === x.k ? 'on' : ''}
                  onClick={() => set({ kind: x.k })}
                  data-tip={x.note}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>

          <div className="re-field">
            <span className="re-label">模型 / 思考档位</span>
            <div className="re-kinds">
              {perKind('claude')}
              {perKind('codex')}
              {perKind('omp')}
            </div>
            <span className="re-hint">
              留「默认」就跟随全局默认。这只是<b>默认值</b> —— 在终端的控制条上改过，以那次为准。
            </span>
          </div>

          <div className="re-field re-grow">
            <span className="re-label">职责契约</span>
            <textarea
              className="re-contract"
              value={draft.contract}
              onChange={(e) => set({ contract: e.target.value })}
              placeholder={BUILTIN_HINT}
              spellCheck={false}
            />
            <span className="re-hint">
              全新启动时拼进命令（Claude 走 <code>--append-system-prompt[-file]</code>，
              Codex 走 <code>-c instructions=</code>，默认 harness 走 <code>--append-system-prompt</code>）。
              <b>回溯不生效</b> —— CLI 的 resume 不重放系统提示词。
              写产出、落点、完成判据，别写人设。
            </span>
          </div>

          <div className="re-field">
            <span className="re-label">能力边界</span>
            <div className="re-caps">
              {(
                [
                  {
                    k: 'write',
                    label: '不许改文件',
                    how: 'Claude 去掉 Write/Edit/NotebookEdit · Codex 只读沙箱（连命令行写入一起挡）· 默认 harness 去掉 write/edit/ast_edit'
                  },
                  {
                    k: 'shell',
                    label: '不许跑命令',
                    how: 'Claude 去掉 Bash · Codex 关掉 shell 工具 · 默认 harness 去掉 bash'
                  },
                  {
                    k: 'imageGen',
                    label: '不许生图',
                    how: 'Claude 按通配禁图像类 MCP · Codex 的内置生图开关实测未生效，只按名关 MCP server · 默认 harness 按名不连'
                  }
                ] as const
              ).map((it) => {
                const on = draft.caps?.[it.k] === false
                return (
                  <button
                    key={it.k}
                    className={`re-chip re-cap${on ? ' on' : ''}`}
                    data-tip={it.how}
                    onClick={() => setCap(it.k, !on)}
                  >
                    {it.label}
                  </button>
                )
              })}
            </div>
            <span className="re-hint">
              三家都生效，硬度不同 —— 鼠标停在开关上看各家怎么落。<b>只能收紧</b>：没点的就是允许。
            </span>
            <span className="re-hint warn">
              「不许改文件」在 Claude 与默认 harness 上留着命令行就仍能 <code>echo &gt; 文件</code>；
              要封死连「不许跑命令」一起点。Codex 的只读沙箱没有这个漏洞。
            </span>

            <button className="re-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? '收起' : 'Claude 专属手写'}
              <em>{rawDeny.length ? `已禁 ${rawDeny.length} 项` : '未手写'}</em>
            </button>
            {showRaw && (
              <textarea
                className="re-list"
                value={rawDeny.join('\n')}
                onChange={(e) => setRawClaude(e.target.value)}
                placeholder={'一行一条 Claude 工具名或通配，例如\nWebFetch\nmcp__*'}
                spellCheck={false}
              />
            )}
          </div>

          <div className="re-field">
            <span className="re-label">禁用的 MCP 工具（通配）</span>
            <textarea
              className="re-list re-list-sm"
              value={denyTools.join('\n')}
              onChange={(e) => setMcp('denyTools', lines(e.target.value))}
              placeholder={'一行一条，不带 mcp__ 前缀，例如\n*canvas*'}
              spellCheck={false}
            />
            <span className="re-hint">
              Claude 按工具名通配禁；Codex 与默认 harness 没有工具级开关，<b>降级为按 server 名匹配后整个关掉</b>。
            </span>
          </div>

          <div className="re-field">
            <span className="re-label">禁用的 MCP server</span>
            <textarea
              className="re-list re-list-sm"
              value={denyServers.join('\n')}
              onChange={(e) => setMcp('denyServers', lines(e.target.value))}
              placeholder={'一行一个 server 名字'}
              spellCheck={false}
            />
            {!!servers.length && (
              <div className="re-chips">
                <span className="re-chips-k">本机已配置：</span>
                {servers.map((n) => {
                  const on = denyServers.includes(n)
                  return (
                    <button
                      key={n}
                      className={`re-chip${on ? ' on' : ''}`}
                      onClick={() => toggleServer(n)}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            )}
            <span className="re-hint">
              三家都生效：Claude 展开成 <code>mcp__&lt;名&gt;__*</code>；Codex <code>-c mcp_servers.&lt;名&gt;.enabled=false</code>；默认 harness 建会话时不连它。
            </span>
            <span className="re-hint warn">
              名字必须和 <code>~/.codex/config.toml</code> 里的完全一致 —— 写错的话 Codex 会<b>直接拒绝启动</b>，所以下发前会按本机清单过滤。
            </span>
          </div>
        </div>

        {!!err && <div className="re-err">{err}</div>}

        <div className="re-foot">
          {draft.builtin ? (
            <button
              className="re-ghost"
              disabled={busy}
              data-tip="把所有内置角色恢复成出厂内容（你自建的角色不受影响）"
              onClick={() => void resetRoles().then(onClose)}
            >
              <UndoIcon size={12} /> 恢复内置
            </button>
          ) : roles.some((r) => r.id === draft.id) ? (
            <button className="re-ghost danger" disabled={busy} onClick={onDelete}>
              <TrashIcon size={12} /> 删除
            </button>
          ) : null}
          <span className="re-spacer" />
          <button className="re-ghost" onClick={onClose}>
            取消
          </button>
          <button className="re-primary" disabled={busy} onClick={onSave}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
