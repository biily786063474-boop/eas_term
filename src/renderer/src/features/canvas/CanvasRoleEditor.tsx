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
import { capMatrix, HARNESSES, harnessLabel, capLabel, levelLabel, howText } from '../../../../shared/roleBinding'
import { getProbe } from './CanvasAgentBar'
import { CloseIcon, TrashIcon, UndoIcon } from '../../ui/Icons'
import { roleContractHint } from './roleDefaults'
import { rich } from './pluginRich'
import { useT } from '../../i18n.ts'
import type { I18nKey } from '../../../../shared/i18n/index.ts'

type Kind = HarnessId

const EFFORT_KEYS: Record<string, I18nKey> = {
  off: 'panels.role.effortOff',
  minimal: 'panels.role.effortMinimal',
  low: 'panels.role.effortLow',
  medium: 'panels.role.effortMedium',
  high: 'panels.role.effortHigh',
  xhigh: 'panels.role.effortXhigh',
  max: 'panels.role.effortMax'
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
  const tr = useT()
  const effortLabel = (x: string): string => (EFFORT_KEYS[x] ? tr(EFFORT_KEYS[x]) : x)
  const roles = useStore((s) => s.roles)
  const saveRoles = useStore((s) => s.saveRoles)
  const resetRoles = useStore((s) => s.resetRoles)
  const [probe, setProbe] = useState<AgentProbe | null>(null)
  // 本机实际配了哪些 Codex MCP server —— 摆出来让用户点，别让他手打
  const [servers, setServers] = useState<string[]>([])
  // Codex 的配置目录，经 IPC 取一次——能力矩阵靠它判断 imageGen 在 Codex 上能不能升到 hard
  // （摘得掉 imagegen 系统 skill），拿不到就只能显示成 degraded
  const [codexHome, setCodexHome] = useState<string | undefined>(undefined)
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
        name: tr('panels.role.newRole'),
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
    void window.api.agent.codexHome().then((v) => live && setCodexHome(v))
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
      setErr(tr('panels.role.nameEmpty'))
      return
    }
    const exists = roles.some((r) => r.id === draft.id)
    void commit(exists ? roles.map((r) => (r.id === draft.id ? draft : r)) : [...roles, draft])
  }

  const onDelete = (): void => void commit(roles.filter((r) => r.id !== draft.id))

  const rawDeny = draft.raw?.claude?.deny ?? []
  const denyServers = draft.caps?.mcp?.denyServers ?? []
  const denyTools = draft.caps?.mcp?.denyTools ?? []
  // claudeWriteGuard: true —— 同 RolePicker 的口径：这里预览的是「开一个对话会话会怎样」，
  // 对话会话总会按 caps.write=false 算出 writeGuardSettings（阶段三第三项），矩阵里
  // write 行的 Claude 格因此要展示两道闸的说明，不是只有 --disallowedTools 那一道。
  const matrix = capMatrix({ caps: draft.caps, raw: draft.raw }, { knownMcpServers: servers, codexHome, claudeWriteGuard: true })

  const kinds: { k: AgentKind | 'auto'; label: string; note: string }[] = [
    { k: 'auto', label: tr('panels.role.kindAuto'), note: tr('panels.role.kindAutoNote') },
    { k: 'claude', label: 'Claude', note: tr('panels.role.kindPinned') },
    { k: 'codex', label: 'Codex', note: tr('panels.role.kindPinned') }
  ]

  const perKind = (k: Kind): JSX.Element => {
    const disabled = draft.kind !== 'auto' && draft.kind !== k
    if (k === 'omp') {
      return (
        <div className={`re-kind${disabled ? ' off' : ''}`} key={k}>
          <div className="re-kind-name">{tr('panels.role.nativeHarness')}</div>
          <input
            value={draft.model?.omp ?? ''}
            onChange={(e) => setPer('model', 'omp', e.target.value)}
            placeholder={tr('panels.role.ompModelPh')}
            disabled={disabled}
          />
          <select
            value={draft.effort?.omp ?? ''}
            onChange={(e) => setPer('effort', 'omp', e.target.value)}
            disabled={disabled}
          >
            <option value="">{tr('panels.role.defaultEffort')}</option>
            {OMP_THINKING.map((x) => (
              <option key={x} value={x}>
                {effortLabel(x)}
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
        <div className="re-kind-name">{{ claude: 'Claude', codex: 'Codex', omp: tr('panels.role.nativeHarness') }[k]}</div>
        <select
          value={draft.model?.[k] ?? ''}
          onChange={(e) => setPer('model', k, e.target.value)}
          disabled={disabled}
        >
          <option value="">{tr('panels.role.defaultModel')}</option>
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
          <option value="">{tr('panels.role.defaultEffort')}</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {effortLabel(x)}
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
            placeholder={tr('panels.role.namePh')}
          />
          {draft.builtin && <span className="re-badge">{tr('panels.role.builtin')}</span>}
          <button className="re-x" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="re-body">
          <label className="re-field">
            <span className="re-label">{tr('panels.role.descLabel')}</span>
            <input
              value={draft.desc}
              onChange={(e) => set({ desc: e.target.value })}
              placeholder={tr('panels.role.descPh')}
            />
          </label>

          <div className="re-field">
            <span className="re-label">{tr('panels.role.cliLabel')}</span>
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

          {/* 起会话时隔离到哪。**只有两档，而且不推断** —— 沿用 team_spawn 的纪律：
              系统不替你判断这个角色写不写代码，不选就是主工作区。
              存的值只有 'worktree' 与 undefined；老配置里的 'none' 按主工作区显示。 */}
          <div className="re-field">
            <span className="re-label">{tr('panels.role.sessionStart')}</span>
            <div className="re-seg">
              {([
                { v: undefined, label: tr('panels.role.isoMain'), note: tr('panels.role.isoMainNote') },
                {
                  v: 'worktree',
                  label: tr('panels.role.isoWorktree'),
                  note: tr('panels.role.isoWorktreeNote')
                }
              ] as const).map((x) => (
                <button
                  key={String(x.v)}
                  className={(draft.isolation === 'worktree' ? 'worktree' : undefined) === x.v ? 'on' : ''}
                  onClick={() => set({ isolation: x.v })}
                  data-tip={x.note}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <span className="re-hint">{tr('panels.role.isoHint')}</span>
          </div>

          <div className="re-field">
            <span className="re-label">{tr('panels.role.modelEffort')}</span>
            <div className="re-kinds">
              {perKind('claude')}
              {perKind('codex')}
              {perKind('omp')}
            </div>
            <span className="re-hint">{rich(tr('panels.role.modelHint'))}</span>
          </div>

          <div className="re-field re-grow">
            <span className="re-label">{tr('panels.role.contract')}</span>
            <textarea
              className="re-contract"
              value={draft.contract}
              onChange={(e) => set({ contract: e.target.value })}
              placeholder={roleContractHint()}
              spellCheck={false}
            />
            <span className="re-hint">{rich(tr('panels.role.contractHint'))}</span>
          </div>

          <div className="re-field">
            <span className="re-label">{tr('panels.role.caps')}</span>
            <div className="re-caps">
              {(
                [
                  { k: 'write', label: capLabel('write') },
                  { k: 'shell', label: capLabel('shell') },
                  { k: 'imageGen', label: capLabel('imageGen') }
                ] as const
              ).map((it) => {
                const on = draft.caps?.[it.k] === false
                return (
                  <button key={it.k} className={`re-chip re-cap${on ? ' on' : ''}`} onClick={() => setCap(it.k, !on)}>
                    {it.label}
                  </button>
                )
              })}
            </div>
            {/* 各家怎么落：**全部由绑定层现算**，这里一句落法都不手写。
                未点亮的行按「假设点亮」预览并压暗，用户不用先点再看。 */}
            <table className="re-matrix">
              <thead>
                <tr>
                  <th />
                  {HARNESSES.map((h) => (
                    <th key={h}>{harnessLabel(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.cap} className={row.active ? '' : 'off'}>
                    <th>{capLabel(row.cap)}</th>
                    {HARNESSES.map((h) => {
                      const c = row.cells[h]
                      return (
                        <td key={h}>
                          {c ? (
                            <>
                              <span className={`re-lv re-lv-${c.level}`}>{levelLabel(c.level)}</span>
                              <span className="re-how">{howText(c)}</span>
                            </>
                          ) : (
                            <span className="re-lv re-lv-none">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="re-hint">{rich(tr('panels.role.capsHint'))}</span>
            <span className="re-hint warn">{rich(tr('panels.role.capsWarn'))}</span>

            <button className="re-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? tr('panels.role.rawCollapse') : tr('panels.role.rawToggle')}
              <em>{rawDeny.length ? tr('panels.role.rawCount', { n: rawDeny.length }) : tr('panels.role.rawNone')}</em>
            </button>
            {showRaw && (
              <textarea
                className="re-list"
                value={rawDeny.join('\n')}
                onChange={(e) => setRawClaude(e.target.value)}
                placeholder={tr('panels.role.rawPh')}
                spellCheck={false}
              />
            )}
          </div>

          <div className="re-field">
            <span className="re-label">{rich(tr('panels.role.denyTools'))}</span>
            <textarea
              className="re-list re-list-sm"
              value={denyTools.join('\n')}
              onChange={(e) => setMcp('denyTools', lines(e.target.value))}
              placeholder={tr('panels.role.denyToolsPh')}
              spellCheck={false}
            />
            <span className="re-hint">{rich(tr('panels.role.denyToolsHint'))}</span>
          </div>

          <div className="re-field">
            <span className="re-label">{tr('panels.role.denyServers')}</span>
            <textarea
              className="re-list re-list-sm"
              value={denyServers.join('\n')}
              onChange={(e) => setMcp('denyServers', lines(e.target.value))}
              placeholder={tr('panels.role.denyServersPh')}
              spellCheck={false}
            />
            {!!servers.length && (
              <div className="re-chips">
                <span className="re-chips-k">{tr('panels.role.configured')}</span>
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
            <span className="re-hint">{tr('panels.role.denyServersHint')}</span>
            <span className="re-hint warn">{rich(tr('panels.role.denyServersWarn'))}</span>
          </div>
        </div>

        {!!err && <div className="re-err">{err}</div>}

        <div className="re-foot">
          {draft.builtin ? (
            <button
              className="re-ghost"
              disabled={busy}
              data-tip={tr('panels.role.resetTip')}
              onClick={() => void resetRoles().then(onClose)}
            >
              <UndoIcon size={12} /> {tr('panels.role.reset')}
            </button>
          ) : roles.some((r) => r.id === draft.id) ? (
            <button className="re-ghost danger" disabled={busy} onClick={onDelete}>
              <TrashIcon size={12} /> {tr('panels.role.delete')}
            </button>
          ) : null}
          <span className="re-spacer" />
          <button className="re-ghost" onClick={onClose}>
            {tr('panels.common.cancel')}
          </button>
          <button className="re-primary" disabled={busy} onClick={onSave}>
            {busy ? tr('panels.common.saving') : tr('panels.common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
