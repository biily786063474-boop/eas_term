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
import type { AgentRole, AgentProbe, AgentKind } from '../../../../shared/types'
import { getProbe } from './CanvasAgentBar'
import { CloseIcon, TrashIcon, UndoIcon } from '../../ui/Icons'
import { BUILTIN_HINT } from './roleDefaults'

type Kind = AgentKind

/** Claude Code 的常用工具，按「能做什么」分组 —— **不是全集**。
 *
 *  摆出来是为了让人不用背工具名：知道「不许它改文件」比知道「工具叫 Edit」容易得多。
 *  每条都带一句人话说明，鼠标停上去能看到 —— 不然 NotebookEdit / KillShell 这种
 *  名字对着看半天也不知道禁了会怎样。
 *  CLI 版本变了这份清单可能对不上，所以下面的手写框一直留着。 */
const TOOL_GROUPS: { g: string; items: { n: string; t: string }[] }[] = [
  {
    g: '改文件',
    items: [
      { n: 'Write', t: '整份写入 / 覆盖文件' },
      { n: 'Edit', t: '按片段替换文件内容' },
      { n: 'NotebookEdit', t: '改 Jupyter notebook 的单元格' }
    ]
  },
  {
    g: '跑命令',
    items: [
      { n: 'Bash', t: '执行 shell 命令。禁了它等于把手脚都捆上，多数角色不该禁' },
      { n: 'BashOutput', t: '读后台命令的输出' },
      { n: 'KillShell', t: '掐掉正在跑的后台命令' }
    ]
  },
  {
    g: '读代码',
    items: [
      { n: 'Read', t: '读文件内容' },
      { n: 'Glob', t: '按文件名找文件' },
      { n: 'Grep', t: '按内容搜代码' }
    ]
  },
  {
    g: '联网',
    items: [
      { n: 'WebFetch', t: '抓取网页内容' },
      { n: 'WebSearch', t: '联网搜索' }
    ]
  },
  {
    g: '协作',
    items: [
      { n: 'Task', t: '派子 agent 去干活' },
      { n: 'TodoWrite', t: '维护任务清单' },
      { n: 'SlashCommand', t: '调用斜杠命令' }
    ]
  },
  {
    g: 'MCP',
    items: [{ n: 'mcp__*', t: '通配：一次禁掉所有 MCP 工具' }]
  }
]

const EFFORT_ZH: Record<string, string> = {
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极限'
}

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
        contract: '',
        tools: {}
      }
  )

  // 已经写过自定义规则的角色：打开就把手写框展开，否则那几条规则等于藏起来了
  useEffect(() => {
    const d = original?.tools?.deny ?? []
    const k = new Set(TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.n)))
    if (d.some((x) => !k.has(x))) setShowRaw(true)
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
  // 一行一条；空行丢掉，末尾换行不会变成一条空规则
  const setTools = (field: 'deny' | 'denyServers', text: string): void =>
    setDraft((d) => ({
      ...d,
      tools: { ...(d.tools ?? {}), [field]: text.split('\n').map((x) => x.trim()).filter(Boolean) }
    }))
  /** 点一下切换某一项。**必须在函数式更新里读当前值** —— 早先是拿渲染时的
   *  `draft.tools.deny` 快照算好再塞回去，手快连点两个 chip 时，第二次读到的还是旧数组，
   *  于是第一次的选择被覆盖掉（实测连点 Write / Edit 只剩 Edit）。 */
  const toggleTool = (field: 'deny' | 'denyServers', name: string): void =>
    setDraft((d) => {
      const cur = d.tools?.[field] ?? []
      return {
        ...d,
        tools: {
          ...(d.tools ?? {}),
          [field]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]
        }
      }
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

  const deny = draft.tools?.deny ?? []
  // 清单之外的（通配符、新版 CLI 的工具名）—— 有这些就说明用户手写过，别把手写框藏起来
  const known = new Set(TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.n)))
  const extraDeny = deny.filter((x) => !known.has(x))

  const kinds: { k: Kind | 'auto'; label: string; note: string }[] = [
    { k: 'auto', label: '跟随', note: '装了哪个用哪个' },
    { k: 'claude', label: 'Claude', note: '钉死' },
    { k: 'codex', label: 'Codex', note: '钉死' }
  ]

  const perKind = (k: Kind): JSX.Element => {
    const models = probe?.[k].models ?? []
    const efforts = probe?.[k].efforts ?? []
    const disabled = draft.kind !== 'auto' && draft.kind !== k
    return (
      <div className={`re-kind${disabled ? ' off' : ''}`} key={k}>
        <div className="re-kind-name">{k === 'claude' ? 'Claude' : 'Codex'}</div>
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
              全新启动时拼进命令（Claude 走 <code>--append-system-prompt-file</code>，
              Codex 走 <code>-c instructions=</code>）。
              <b>回溯不生效</b> —— CLI 的 resume 不重放系统提示词。
              写产出、落点、完成判据，别写人设。
            </span>
          </div>

          <div className="re-field">
            <span className="re-label">禁用的工具</span>
            {/* 点一下就禁，不用记工具名。红了 = 这个角色用不了它 */}
            <div className="re-tools">
              {TOOL_GROUPS.map((grp) => (
                <div className="re-tools-row" key={grp.g}>
                  <span className="re-tools-g">{grp.g}</span>
                  <div className="re-chips">
                    {grp.items.map((it) => {
                      const on = deny.includes(it.n)
                      return (
                        <button
                          key={it.n}
                          className={`re-chip${on ? ' on' : ''}`}
                          data-tip={`${it.t}${on ? '　·　点一下解禁' : ''}`}
                          onClick={() => toggleTool('deny', it.n)}
                        >
                          {it.n}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 通配符、以及这份清单没覆盖到的工具名，还是得能手写 */}
            <button className="re-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? '收起' : '手写补充'}
              <em>
                {deny.length ? `已禁 ${deny.length} 项` : '未禁任何工具'}
                {extraDeny.length ? `（含 ${extraDeny.length} 条自定义）` : ''}
              </em>
            </button>
            {showRaw && (
              <textarea
                className="re-list"
                value={deny.join('\n')}
                onChange={(e) => setTools('deny', e.target.value)}
                placeholder={'一行一条，例如\nWrite\nmcp__*image*'}
                spellCheck={false}
              />
            )}
            <span className="re-hint">
              <b>只对 Claude 生效</b>。裸工具名（<code>Write</code>）会让该工具从模型上下文里整个消失，
              由 CLI 强制，不靠模型自觉；也支持通配（<code>mcp__*</code> = 所有 MCP 工具）。
            </span>
            <span className="re-hint warn">
              这是护栏，不是牢笼：禁了 Write 但留着 Bash，模型仍可以用 <code>echo &gt; 文件</code> 绕过。
              它挡的是「顺手就改了」，不是铁了心的规避。
            </span>
          </div>

          <div className="re-field">
            <span className="re-label">禁用的 MCP server</span>
            <textarea
              className="re-list re-list-sm"
              value={(draft.tools?.denyServers ?? []).join('\n')}
              onChange={(e) => setTools('denyServers', e.target.value)}
              placeholder={'一行一个 server 名字'}
              spellCheck={false}
            />
            {!!servers.length && (
              <div className="re-chips">
                <span className="re-chips-k">本机已配置：</span>
                {servers.map((n) => {
                  const on = (draft.tools?.denyServers ?? []).includes(n)
                  return (
                    <button
                      key={n}
                      className={`re-chip${on ? ' on' : ''}`}
                      onClick={() => toggleTool('denyServers', n)}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            )}
            <span className="re-hint">
              两边都生效，但粒度不同：Claude 展开成 <code>mcp__&lt;名&gt;__*</code> 按工具禁；
              Codex 没有工具级开关，只能 <code>-c mcp_servers.&lt;名&gt;.enabled=false</code> 把整个 server 关掉。
            </span>
            <span className="re-hint warn">
              名字必须和 <code>~/.codex/config.toml</code> 里的完全一致 —— 写错的话 Codex 会
              <b>直接拒绝启动</b>。所以下发前会按上面这份清单过滤，对不上的静默跳过。
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
