// ⚠️ **已下线（2026-09-03），当前没有任何渲染点。别当成死代码删掉。**
//
// 用户：「终端里面的 top bar 上面的内容选项等取消，终端就是纯粹的终端。
// 所有的 AI 对话由 AI 对话模块来单方面承接。」
// 原来的渲染点在 `workspace/PaneView.tsx`，那里留了一段说明。
//
// **它的三个职责各自去了哪**：
//   · 选 CLI / 装 / 登录 → 空造梦空间上那三颗按钮（`canvas/FrameStart.tsx`）
//   · 选角色           → AI 对话工具栏上的角色 icon（`agentChat/RolePicker.tsx`），
//                        而且现在是**真的注入会话**（契约 + 工具边界，三个 CLI 各一条路）
//   · 选模型 / 思考档   → AI 对话工具栏上本来就有
//   · ▶ 启动           → 没有替代品：终端里手敲 `claude` / `codex`，
//                        背后那套（状态机 / 甘特 / 审批解析）**一个字都没改**
//
// **留着它的两个理由**：① 文件里有大量实测结论（Claude 的 effort 档位来自
// `claude --help` 真实探测、Codex 的模型表是主进程给的已知默认……），删了这些知识就没了；
// ② 万一这条引导路走不通要回退，`git revert` 比重写便宜。
//
// 下面是它下线前的原始说明：
//
// 画布终端节点的「Agent 控制台」（画布独有 chrome；分屏模式 PaneView 不渲染这层）。
// 底层始终是真实 CLI：点启动把参数拼成命令写进终端。
// 形态：左侧星星按钮（显示当前 CLI 的品牌标识，点开换）→ 角色/模型/思考三枚胶囊 → 右侧 ▶ 启动。
//   · Claude：模型别名 / effort 档位来自 `claude --help` 真实探测（不写死）。
//   · Codex：模型/档位是主进程给的已知默认（CLI 不暴露，服务端 catalog 才有），可「自定义…」兜底。
// 点 ▶ 弹「是否回溯上次对话」：是 → 带 -c / resume --last 继续；否 → 全新启动。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { NodeAgent } from '../../store'
import type { AgentProbe, AgentRole, AgentKind } from '../../../../shared/types'
import { bindRole } from '../../../../shared/roleBinding'
import {
  SparkleIcon,
  UndoIcon,
  PlayIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  GearIcon,
  ClaudeIcon,
  CodexIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '../../ui/Icons'
import { useMenuAnchor } from '../../ui/CanvasContextMenu'
import { CanvasRoleEditor } from './CanvasRoleEditor'
import { CanvasRoleManager } from './CanvasRoleManager'
import { stopVoiceOnSend } from '../voice/voiceControl'
import { AgentCmdBar } from './AgentCmdBar'

// **刻意不用 AgentKind。** 这条命令条是「用启动参数把模型/强度传给 CLI」，
// 只对命令行支持这两样的 CLI 成立。有的 CLI 把模型配在自己的配置树里、
// 命令行没有 --model，那种就不该出现在这条命令条上；
// effort 它压根没这个概念 —— 探测因此给空数组，UI 自动隐藏这些控件。
type Kind = 'claude' | 'codex'

// effort 档位「本地化显示」——档位 key 本身来自 probe（真实/默认），这里只把已知 key 映射成中文，未知则原样显示
const EFFORT_ZH: Record<string, string> = {
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极限'
}
const effZh = (e: string): string => EFFORT_ZH[e] ?? e
const cap = (m: string): string => (m ? m.charAt(0).toUpperCase() + m.slice(1) : m)
// Claude 别名首字母大写好看（Opus/Sonnet）；Codex 是全名（gpt-5-codex）原样显示
const modelLabel = (m: string, kind: Kind): string => (kind === 'claude' ? cap(m) : m)
const kindName = (k: Kind): string => (k === 'claude' ? 'Claude Code' : 'Codex')

/** 拼 Claude Code 启动命令（权限已按需求取消，不再拼 --permission-mode）。
 *
 *  会话绑定：每个终端节点记着自己的 session id。
 *   · 全新 → --session-id <新uuid>（建一条属于这个终端的会话线）
 *   · 回溯 → --resume <自己的uuid>（精确回到这条线）
 *  不能图省事用同一个参数：--session-id 撞到已存在的 id 会报「already in use」，
 *  --resume 撞到不存在的 id 会报「No conversation found」，两边都验过。
 *  节点还没有 id 时（老数据 / 手动起过），回溯回落到 -c 的旧行为。 */
function buildClaudeCmd(
  model?: string,
  effort?: string,
  cont?: boolean,
  sessionId?: string,
  contractFile?: string | null,
  /** `bindRole(...).claude.deny` */
  deny: string[] = []
): string {
  const p = ['claude']
  if (cont) p.push(...(sessionId ? ['--resume', sessionId] : ['-c']))
  else if (sessionId) p.push('--session-id', sessionId)
  if (model) p.push('--model', model)
  if (effort) p.push('--effort', effort)
  // 角色契约走文件而不是内联：内联会让命令变成难读的一长条，且契约里的换行/引号都要转义。
  // 回溯时不拼——--resume 不重放 system prompt，加了也是白加，反而让人误以为改角色生效了。
  if (!cont && contractFile) p.push('--append-system-prompt-file', shq(contractFile))
  // 能力边界：回溯时也要拼 —— 它是 CLI 层的强制规则，每次启动都重新生效。
  // 变长参数（<tools...>）放最后：夹在中间会把后面的选项一起吞掉。通配符必须引起来，否则 zsh 会先展开成文件名
  if (deny.length) p.push('--disallowedTools', ...deny.map(shq))
  return p.join(' ')
}

/** 拼 Codex 启动命令。回溯 = `codex resume`（沿用原会话配置）；
 *  全新 = `codex -m <model> -c model_reasoning_effort=<effort>` 加角色边界。 */
function buildCodexCmd(
  model?: string,
  effort?: string,
  cont?: boolean,
  sessionId?: string,
  contract?: string,
  /** `bindRole(...).codex`（denyServers 已按本机清单过滤） */
  codex: { disable: string[]; disableServers: string[]; sandbox: 'read-only' | undefined } = { disable: [], disableServers: [], sandbox: undefined }
): string {
  if (cont) return sessionId ? `codex resume ${sessionId}` : 'codex resume --last'
  const p = ['codex']
  if (model) p.push('-m', model)
  if (effort) p.push('-c', `model_reasoning_effort=${effort}`)
  // 用户此前取消了终端的权限档位，所以这里**只在角色要求只读时**才拼 -s，其余照旧不拼
  if (codex.sandbox) p.push('-s', codex.sandbox)
  if (contract) p.push('-c', shq('instructions=' + contract.replace(/\s*\n\s*/g, ' ').replace(/"/g, '')))
  for (const f of codex.disable) p.push('--disable', f)
  for (const n of codex.disableServers) p.push('-c', `mcp_servers.${n}.enabled=false`)
  return p.join(' ')
}

/** 单引号包裹 + 转义内部单引号：路径/契约里有空格、中文、引号都不会把命令拆散 */
function shq(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`
}

const DEFAULT_MODEL: Record<Kind, string> = { claude: 'opus', codex: 'gpt-5-codex' }
const DEFAULT_EFFORT: Record<Kind, string> = { claude: 'high', codex: 'medium' }
// 默认优先用旗舰默认（Opus / gpt-5-codex），它在探测列表里就用它，否则退列表首项——
// 避免因 `claude --help` 恰好把 fable 列在首位而默认到 Fable
const pickModel = (models: string[], kind: Kind): string =>
  models.includes(DEFAULT_MODEL[kind]) ? DEFAULT_MODEL[kind] : models[0] ?? DEFAULT_MODEL[kind]
const pickEffort = (efforts: string[], kind: Kind): string =>
  efforts.includes(DEFAULT_EFFORT[kind]) ? DEFAULT_EFFORT[kind] : efforts[0] ?? DEFAULT_EFFORT[kind]

// 探测结果模块级缓存（多个终端节点共享，避免各自重复跑 claude --help）。TTL 30s：
// 应用内首次开终端时拉一次，之后 30s 内复用，过期或胶囊再开时重拉——满足「开终端时拉一遍更新」。
let probeCache: { data: AgentProbe; at: number } | null = null
let probeInflight: Promise<AgentProbe> | null = null
export async function getProbe(): Promise<AgentProbe> {
  if (probeCache && Date.now() - probeCache.at < 30000) return probeCache.data
  if (probeInflight) return probeInflight
  probeInflight = window.api.agent
    .probe()
    .then((d) => {
      probeCache = { data: d, at: Date.now() }
      probeInflight = null
      return d
    })
    .catch((e) => {
      probeInflight = null
      throw e
    })
  return probeInflight
}

type Pop = { type: 'model' | 'effort' | 'ask' | 'role' | 'kind'; rect: DOMRect }

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
  const requestConfirm = useStore((s) => s.requestConfirm)

  const [probe, setProbe] = useState<AgentProbe | null>(probeCache?.data ?? null)
  const [pop, setPop] = useState<Pop | null>(null)
  // 角色编辑器：null=没开，''=新建，其余=编辑该角色。
  // 入口只此一处——右抽屉那份已经撤掉，角色的一切都收在终端这条控制条上
  const [editRole, setEditRole] = useState<string | null>(null)
  const [manageRoles, setManageRoles] = useState(false)
  const [customModel, setCustomModel] = useState<string | null>(null) // null=菜单模式，string=自定义输入模式
  const popRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  // 开终端时拉一遍真实的 模型/effort（TTL 缓存）
  useEffect(() => {
    let live = true
    const run = (): void => {
      getProbe()
        .then((d) => live && setProbe(d))
        .catch(() => {})
    }
    run()
    // **窗口重新获得焦点时重探一次。** 只在挂载时探一次是不够的：用户去终端里
    // 装 / 修 CLI（2026-08-11 就撞上了——claude 的 npm 自更新被 allow-scripts 拦掉，
    // 二进制没就位），修好回来，已经开着的控制条还一直显示「未检测到 claude 命令」，
    // 只有切视图让组件重新挂载才恢复 —— 而没人猜得到要那么做。
    // getProbe 自带 30s TTL，频繁切窗口也不会反复跑 claude --help。
    window.addEventListener('focus', run)
    return () => {
      live = false
      window.removeEventListener('focus', run)
    }
  }, [])

  // 浮层外部点击关闭（照 PaneKindSelect：判断 target 不在锚点/浮层内才关）
  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return
      setPop(null)
      setCustomModel(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [pop])

  const roles = useStore((s) => s.roles)
  const role = roles.find((r) => r.id === agent?.roleId) ?? null
  // 角色可以钉死用哪个 CLI；kind='auto' 时听节点自己的选择
  // 角色/节点上存的是完整的 AgentKind，而这条命令条只处理命令行支持
  // 模型与强度的那两个 —— 落到别的 CLI 上就退回 claude，**不假装能给它下发参数**
  const rawKind = role && role.kind !== 'auto' ? role.kind : (agent?.kind ?? 'claude')
  const kind: Kind = rawKind === 'codex' ? 'codex' : 'claude'
  const claudeReady = !probe || probe.claude.installed
  const codexReady = !!probe?.codex.installed
  const activeReady = kind === 'claude' ? claudeReady : codexReady

  // 角色钉死 CLI 时星星按钮要锁住 —— 点开了也改不动，不如不给点
  const pinned = !!role && role.kind !== 'auto'

  /** 装当前选中的这个 CLI。弹确认框（**把要执行的命令原样列出来**），
   *  点了「安装」就开个终端把它跑起来。
   *
   *  和 AgentChatView 里那条同源：命令取自 agentInstall 的 installPlan()，
   *  是我们自己按平台挑的固定方案，不拼接任何外部输入。
   *  仍然送进**终端**而不是后台执行 —— 装完还要 `claude login` 用自己的账号，
   *  失败时报错摆在眼前也比一句「安装失败」有用。 */
  const installCli = async (): Promise<void> => {
    const plan = await window.api.skill.installPlan().catch(() => null)
    const cmd = plan?.[kind]?.options?.[0]?.cmd
    const st = useStore.getState()
    if (!cmd) {
      st.requestConfirm({
        message: `没找到 ${kindName(kind)} 在这台机器上的安装方式。\n请到它的官网安装后再回来。`,
        confirmLabel: '知道了',
        onConfirm: () => {}
      })
      return
    }
    st.requestConfirm({
      message: `${kindName(kind)} 还没装。要现在装吗？\n\n会开一个终端执行：\n${cmd}\n\n装完通常还要用你自己的账号登录一次，那一步在同一个终端里接着做。`,
      confirmLabel: '安装',
      cancelLabel: '只把命令填进终端',
      onConfirm: () => void st.prefillTerminal(cmd, { run: true }),
      onCancel: () => void st.prefillTerminal(cmd)
    })
  }

  const models = probe?.[kind].models ?? []
  const efforts = probe?.[kind].efforts ?? []
  // 优先级：节点自己选的 > 角色的默认 > 探测出的默认。
  // 角色只提供**默认值**，用户在控制条上改过就以他的为准——否则每次选角色都把手动调整冲掉
  const model = agent?.model?.[kind] || role?.model?.[kind] || pickModel(models, kind)
  const effort = agent?.effort?.[kind] || role?.effort?.[kind] || pickEffort(efforts, kind)

  // 统一改写：始终保留 kind，模型/思考按当前 kind 各存一格（切 agent 互不覆盖）。
  // rec() 守卫旧结构：P0 时 model/effort 曾是字符串，直接 spread 会摊成 {0:'o',1:'p'…} 污染存档。
  const rec = (v: unknown): Partial<Record<Kind, string>> =>
    v && typeof v === 'object' ? (v as Partial<Record<Kind, string>>) : {}
  const mutate = (next: Partial<NodeAgent>): void =>
    setNodeAgent(frameId, nodeId, { kind, ...(agent ?? {}), ...next } as NodeAgent)
  const setModel = (m: string): void => mutate({ model: { ...rec(agent?.model), [kind]: m } })
  const setEffort = (e: string): void => mutate({ effort: { ...rec(agent?.effort), [kind]: e } })
  const setKind = (k: Kind): void => {
    if (k === kind) return
    // 这里原来有一道 `if (k === 'codex' && !codexReady) return`。
    // **删掉了**（2026-08-27）：菜单项已经放开可点，这道早退会让点击静默失灵 ——
    // 比原来的置灰更糟，看着能点、点了没反应。没装的后果由启动按钮承担：
    // 它此时是「安装」。
    setPop(null)
    mutate({ kind: k })
  }

  /** 换角色。
   *
   *  硬约束：Claude 的 --resume 不重放 system prompt，Codex 的 resume 同样沿用原会话配置。
   *  也就是说一条会话开始时是什么角色，它这辈子就是什么角色 —— 在这里改 roleId，
   *  正在跑的那条会话**什么都不会变**。所以已经有 session 时必须让用户明确选一次，
   *  默默改会让人以为生效了，这比不做这个功能更糟。 */
  const pickRole = (id: string | null): void => {
    setPop(null)
    if ((agent?.roleId ?? null) === id) return
    // 判据是「这个终端有没有**任何**绑定会话」，不是「当前 kind 有没有」。
    // 只看当前 kind 的话：用户在 Codex 侧换角色时不弹窗，但控制条从此显示新角色，
    // 而他一旦切回 Claude 回溯，跑的还是旧角色 —— 显示和实际对不上，正是要防的那种误解。
    const bound = (['claude', 'codex'] as Kind[]).filter((k) => agent?.session?.[k])
    if (!bound.length) {
      mutate({ roleId: id ?? undefined })
      return
    }
    const nm = id ? (roles.find((r) => r.id === id)?.name ?? '该角色') : '无角色'
    requestConfirm({
      message:
        `这个终端已经绑了会话（${bound.map((k) => (k === 'claude' ? 'Claude' : 'Codex')).join(' / ')}）。\n\n` +
        `换成「${nm}」不会影响正在跑的这条 —— CLI 的 resume 不重放系统提示词，` +
        `会话开始时是什么角色就一直是什么角色。\n\n` +
        `「只改下次启动」：当前会话照旧，下回全新启动时用新角色。\n` +
        `「换角色并断开」：清掉会话绑定，下次启动是全新一条、新角色立刻生效，` +
        `但这个终端的「回溯」就找不回旧对话了（旧会话本身还在，可以用 CLI 自己找）。`,
      confirmLabel: '换角色并断开',
      // 断开：把所有已绑会话一起解绑，否则切到另一个 CLI 又会撞上同样的错位
      onConfirm: () => mutate({ roleId: id ?? undefined, session: {} }),
      cancelLabel: '只改下次启动',
      onCancel: () => mutate({ roleId: id ?? undefined })
    })
  }

  // 浮层夹回窗口内。复用右键菜单那套（实测尺寸而非估算 —— 菜单项数不定，估出来对不上）
  const popPos = useMenuAnchor(pop?.rect.left ?? 0, (pop?.rect.bottom ?? 0) + 6, popRef, [pop?.type])

  const openPop = (type: 'model' | 'effort' | 'role' | 'kind', el: HTMLElement): void => {
    anchorRef.current = el
    setCustomModel(null)
    setPop((cur) => (cur?.type === type ? null : { type, rect: el.getBoundingClientRect() }))
  }
  const openAsk = (el: HTMLElement): void => {
    anchorRef.current = el
    setPop((cur) => (cur?.type === 'ask' ? null : { type: 'ask', rect: el.getBoundingClientRect() }))
  }

  /** 这个终端节点自己的会话 id（按 agent 各记一套） */
  const sessionId = agent?.session?.[kind]

  const launch = async (cont: boolean): Promise<void> => {
    setPop(null)
    let sid = sessionId
    if (!cont && kind === 'claude') {
      // 全新会话：当场发一个 id 并记进节点，以后「回溯」就能精确回到这条线
      sid = crypto.randomUUID()
      mutate({ session: { ...rec(agent?.session), claude: sid } })
    }
    // 角色契约只在**全新启动**时拼进去：resume 不重放系统提示词，回溯时加了也是白加
    const contract = !cont && role?.contract.trim() ? role.contract : ''
    const bounds = role && (role.caps || role.raw) ? { caps: role.caps, raw: role.raw } : undefined
    let cmd: string
    if (kind === 'claude') {
      const f = contract ? await window.api.roles.contractFile(role!.id) : null
      cmd = buildClaudeCmd(model, effort, cont, cont ? sessionId : sid, f, bindRole(bounds, 'claude').claude.deny)
    } else {
      // 名字不存在时 codex 会直接拒绝启动（invalid transport），先读真实清单再交给 bindRole 过滤
      const have = bounds ? await window.api.agent.codexServers() : []
      cmd = buildCodexCmd(model, effort, cont, sessionId, contract, bindRole(bounds, 'codex', { knownMcpServers: have }).codex)
    }
    // 「启动」也是一次发送 —— 麦克风开着的话同样要收掉，
    // 否则起完 agent 麦还在录，下一句话被接到输入框里
    void stopVoiceOnSend()
    window.api.pty.write(ptyId, cmd + '\r')

    // Codex 没有指定会话 id 的启动参数，只能起完之后按 cwd 去 sessions 目录捞。
    // 给它 4 秒把 session_meta 写出来；多个候选（同项目同时起两个）就放弃绑定，
    // 宁可维持现状，也不要瞎猜一个错的——那等于把「偶尔串台」变成「稳定串错」。
    if (!cont && kind === 'codex') {
      void window.api.pty.cwd(ptyId).then((cwd) => {
        if (!cwd) return
        const since = Date.now() - 2000
        setTimeout(() => {
          void window.api.agent.captureCodexSession(cwd, since).then((r) => {
            if (r.id) mutate({ session: { ...rec(agent?.session), codex: r.id } })
          })
        }, 4000)
      })
    }
  }

  return (
    <div className="agentbar-stack" onMouseDown={(e) => e.stopPropagation()}>
      <div className="agentbar">
        {editRole !== null && (
          <CanvasRoleEditor roleId={editRole} onClose={() => setEditRole(null)} />
        )}
        {manageRoles && (
          <CanvasRoleManager
            onClose={() => setManageRoles(false)}
            onEdit={(id) => {
              // 从管理面板跳去编辑：先收起管理，不然两层弹窗叠在一起
              setManageRoles(false)
              setEditRole(id)
            }}
          />
        )}
        {/* 星星按钮：CLI 的切换入口。**当前是谁靠品牌标识认**，不再摆两个文字按钮 ——
            那对控制条来说太占地方，而这排东西是跟着终端节点走的，节点一窄就先挤没了。
            角色钉死了 CLI 时这里锁住：kind 由角色决定，能点开却改不动才是真的费解。 */}
        <button
          className={`ab-brand${pinned ? ' pinned' : ''}`}
          onClick={(e) => !pinned && openPop('kind', e.currentTarget)}
          data-tip={
            pinned
              ? `角色「${role!.name}」钉死了 ${kindName(kind)}，要换先换角色`
              : `${kindName(kind)}，点击切换`
          }
        >
          <SparkleIcon size={9} className="ab-brand-spark" />
          {kind === 'claude' ? <ClaudeIcon size={15} /> : <CodexIcon size={15} />}
        </button>

        {/* 角色胶囊：决定模型/档位的默认值和职责契约。空 = 裸终端 */}
        {!!roles.length && (
          <button
            className={`ab-pill ab-role${role ? ' on' : ''}`}
            onClick={(e) => openPop('role', e.currentTarget)}
            data-tip={role ? role.desc : '不套任何规矩'}
          >
            {/* 点不再按角色上色 —— 彩色会让人以为颜色本身有含义（哪个色=哪类角色），
                实际上它只是「有没有挂角色」。挂了就亮，没挂就没有这颗点 */}
            {role && <span className="ab-role-dot on" />}
            <span className="ab-pill-k">角色</span>
            <b>{role?.name ?? '无'}</b>
          </button>
        )}

        {/* 模型 / 思考胶囊：选项跟随当前 agent */}
        <button className="ab-pill" onClick={(e) => openPop('model', e.currentTarget)}>
          <span className="ab-pill-k">模型</span>
          <b>{modelLabel(model, kind)}</b>
        </button>
        <button className="ab-pill" onClick={(e) => openPop('effort', e.currentTarget)}>
          <span className="ab-pill-k">思考</span>
          <b>{effZh(effort)}</b>
        </button>

        {/* ▶ 启动；**没装的时候这颗按钮变成「安装」**（2026-08-27 用户要求）。
            原来是置灰 + 一句「未检测到 xx 命令」—— 那是个死胡同：
            它告诉你不能用，却没告诉你怎么办。现在点它就问装不装，同意就开终端装上。 */}
        {activeReady ? (
          <button className="ab-launch" data-tip="启动" onClick={(e) => openAsk(e.currentTarget)}>
            <PlayIcon size={12} /> 启动
          </button>
        ) : (
          <button
            className="ab-launch ab-install"
            data-tip={`${kindName(kind)} 还没装，点击安装`}
            onClick={() => void installCli()}
          >
            <PlusIcon size={12} /> 安装
          </button>
        )}
      </div>

      <AgentCmdBar ptyId={ptyId} />

      {/* 浮层：portal 到 body（.pane overflow:hidden 会裁切；zoom 下 rect 已是屏幕坐标，fixed 精准） */}
      {pop &&
        createPortal(
          <div
            ref={popRef}
            className="ab-pop"
            // **夹回可视区**：控制条在窗口右侧时，「启动」弹出的回溯确认框
            // 会整个越出窗口边缘看不见。画布右键菜单一直有这个处理（useMenuAnchor），
            // 这里漏了。先隐藏再定位是为了不让人看见「先飞出去再跳回来」那一帧。
            style={{ left: popPos?.x ?? pop.rect.left, top: popPos?.y ?? pop.rect.bottom + 6, visibility: popPos ? 'visible' : 'hidden' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pop.type === 'kind' && (
              <div className="ab-menu ab-kind-menu">
                {(
                  [
                    ['claude', claudeReady, '未检测到 claude 命令'],
                    ['codex', codexReady, '未检测到 codex（在终端运行 codex login 后可用）']
                  ] as const
                ).map(([k, ready, why]) => (
                  <button
                    key={k}
                    // **没装也让选**（2026-08-27 用户要求）：原来这里 disabled，
                    // 结果是想装 codex 的人连"选中它"这一步都做不到 —— 而安装入口
                    // 恰恰在选中之后的那颗按钮上。现在选了就显示"未安装"，
                    // 旁边的启动按钮同步变成「安装」。
                    className={`ab-menu-item ab-kind-item${k === kind ? ' on' : ''}${ready ? '' : ' off'}`}
                    data-tip={ready ? '' : why}
                    onClick={() => setKind(k)}
                  >
                    <span className="ab-kind-mark">
                      {k === 'claude' ? <ClaudeIcon size={15} /> : <CodexIcon size={15} />}
                    </span>
                    <span>{kindName(k)}</span>
                    {!ready && <span className="ab-kind-no">未安装</span>}
                    {/* ✓ 占一个**固定宽度的槽**，选没选中都在 —— 否则两行的
                        「未安装」标记会因为有没有 ✓ 而左右错开一截 */}
                    <span className="ab-kind-ck">{k === kind && <CheckIcon size={12} />}</span>
                  </button>
                ))}
              </div>
            )}

            {pop.type === 'ask' && (
              <div className="ab-ask">
                <div className="ab-ask-t">
                  <UndoIcon size={13} /> 是否回溯上次对话？
                </div>
                <div className="ab-ask-d">
                  继续 {kind === 'claude' ? 'Claude Code' : 'Codex'} 最近一次会话，还是全新开始？
                </div>
                <div className="ab-ask-btns">
                  <button className="ab-ask-yes" onClick={() => void launch(true)}>
                    <UndoIcon size={12} /> 是，回溯
                  </button>
                  <button className="ab-ask-no" onClick={() => void launch(false)}>
                    <PlayIcon size={12} /> 否，全新
                  </button>
                </div>
              </div>
            )}

            {pop.type === 'role' && (
              <RoleStepper
                roles={roles}
                currentId={agent?.roleId ?? null}
                onPick={pickRole}
                onEdit={(id) => {
                  setPop(null)
                  setEditRole(id)
                }}
                onManage={() => {
                  setPop(null)
                  setManageRoles(true)
                }}
                onNew={() => {
                  setPop(null)
                  setEditRole('')
                }}
              />
            )}

            {pop.type === 'model' &&
              (customModel === null ? (
                <div className="ab-menu">
                  {models.length === 0 && <div className="ab-menu-empty">读取模型中…</div>}
                  {models.map((m) => (
                    <button
                      key={m}
                      className={`ab-menu-item${m === model ? ' on' : ''}`}
                      onClick={() => {
                        setModel(m)
                        setPop(null)
                      }}
                    >
                      <span>{modelLabel(m, kind)}</span>
                      {m === model && <CheckIcon size={12} />}
                    </button>
                  ))}
                  <button
                    className="ab-menu-item ab-menu-custom"
                    onClick={() => setCustomModel(model)}
                  >
                    自定义…
                  </button>
                </div>
              ) : (
                <div className="ab-menu">
                  <input
                    className="ab-custom-input"
                    autoFocus
                    value={customModel}
                    placeholder={
                      kind === 'claude' ? '别名或全名，如 haiku / claude-opus-4-8' : '模型名，如 gpt-5-mini'
                    }
                    onChange={(e) => setCustomModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = customModel.trim()
                        if (v) setModel(v)
                        setCustomModel(null)
                        setPop(null)
                      }
                      if (e.key === 'Escape') setCustomModel(null)
                    }}
                  />
                </div>
              ))}

            {pop.type === 'effort' && (
              <div className="ab-slider">
                {efforts.length === 0 ? (
                  <div className="ab-menu-empty">读取思考档位中…</div>
                ) : (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, efforts.length - 1)}
                      step={1}
                      value={Math.max(0, efforts.indexOf(effort))}
                      onChange={(e) => setEffort(efforts[Number(e.target.value)])}
                    />
                    <div className="ab-slider-ticks">
                      {efforts.map((ef) => (
                        <span
                          key={ef}
                          className={ef === effort ? 'on' : ''}
                          onClick={() => setEffort(ef)}
                        >
                          {effZh(ef)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

/** 角色选择器 —— Stepper 形态：顶上一排点，中间一页角色，底下左右翻。
 *
 *  没有用 React Bits 那个 Stepper 组件：它整套 className 是 Tailwind、动画走 motion/react，
 *  本项目两样都没有。为一段横向滑动装一个动画库不值当 —— transform + transition 就够，
 *  而 Tailwind 那边如果照搬会「挂载成功、零报错、完全没样式」。
 *
 *  和原版 Stepper 有一处**故意的不同**：指示点可以直接点。原版是「一步步走完」的向导语义，
 *  这里是选角色 —— 十来个角色让人一个个翻是折磨。点可跳 + 左右翻，两种都留着。 */
function RoleStepper({
  roles,
  currentId,
  onPick,
  onEdit,
  onManage,
  onNew
}: {
  roles: AgentRole[]
  currentId: string | null
  onPick: (id: string | null) => void
  onEdit: (id: string) => void
  onManage: () => void
  onNew: () => void
}): JSX.Element {
  // 顺序照旧：无角色 → 主序列 → 产出型。换个形态不该把人熟悉的次序也换了
  const items: (AgentRole | null)[] = [
    null,
    ...roles.filter((r) => r.group === 'main'),
    ...roles.filter((r) => r.group !== 'main')
  ]
  // 开局停在当前生效的那个角色上，不是停在第一页 —— 打开就看见「我现在用的是谁」
  const [step, setStep] = useState(() => {
    const i = items.findIndex((r) => (r?.id ?? null) === currentId)
    return i < 0 ? 0 : i
  })
  const at = Math.min(step, items.length - 1)
  const cur = items[at]
  const live = (cur?.id ?? null) === currentId
  const go = (d: number): void => setStep((v) => Math.min(items.length - 1, Math.max(0, v + d)))

  return (
    <div className="ab-stepper">
      {/* 指示点。全灰，只有正在看的那个是亮的 —— 用颜色区分角色反而让人以为颜色有含义 */}
      <div className="ab-step-dots">
        {items.map((r, i) => (
          <button
            key={r?.id ?? '_none'}
            className={`ab-step-dot${i === at ? ' cur' : ''}`}
            onClick={() => setStep(i)}
            data-tip={r?.name ?? '无角色'}
          />
        ))}
      </div>

      {/* 内容区：所有页排成一条横轨，靠 translateX 滑。
          高度由最高的一页撑住（flex 默认 stretch），翻页时不会跳 */}
      <div className="ab-step-view">
        <div className="ab-step-track" style={{ transform: `translateX(-${at * 100}%)` }}>
          {items.map((r) => (
            <div className="ab-step-page" key={r?.id ?? '_none'} aria-hidden={r !== cur}>
              <div className="ab-step-grp">
                {r ? (r.group === 'main' ? '主序列' : '产出型') : '不套任何规矩'}
              </div>
              <div className="ab-step-name">
                {r?.name ?? '无角色'}
                {/* 角色钉死了 CLI 的话标出来，免得用户奇怪星星按钮为什么点不开 */}
                {r && r.kind !== 'auto' && <em className="ab-role-kind">{r.kind}</em>}
                {r && (
                  <button className="ab-step-edit" data-tip="编辑这个角色" onClick={() => onEdit(r.id)}>
                    <PencilIcon size={11} />
                  </button>
                )}
              </div>
              <div className="ab-step-desc">{r?.desc || '裸终端，不追加任何系统提示词'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 翻页 + 选定 */}
      <div className="ab-step-foot">
        <button className="ab-step-nav" disabled={at === 0} onClick={() => go(-1)} data-tip="上一个">
          <ChevronLeftIcon size={13} />
        </button>
        <button
          className="ab-step-use"
          disabled={live}
          onClick={() => onPick(cur?.id ?? null)}
        >
          {live ? '正在使用' : <>选用{cur ? `「${cur.name}」` : '无角色'}</>}
        </button>
        <button
          className="ab-step-nav"
          disabled={at === items.length - 1}
          onClick={() => go(1)}
          data-tip="下一个"
        >
          <ChevronRightIcon size={13} />
        </button>
      </div>

      <div className="ab-step-more">
        <button onClick={onManage}>
          <GearIcon size={12} /> 管理角色…
        </button>
        <button onClick={onNew}>
          <PlusIcon size={12} /> 新建…
        </button>
      </div>
    </div>
  )
}
