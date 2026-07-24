// 画布终端节点的「Agent 控制台」（画布独有 chrome；分屏模式 PaneView 不渲染这层）。
// 底层始终是真实 CLI：点启动把参数拼成命令写进终端。
// 形态：左侧 [Claude | Codex] 段控件选当前 agent → 模型/思考两枚胶囊随之切换选项 → 右侧 ▶ 启动。
//   · Claude：模型别名 / effort 档位来自 `claude --help` 真实探测（不写死）。
//   · Codex：模型/档位是主进程给的已知默认（CLI 不暴露，服务端 catalog 才有），可「自定义…」兜底。
// 点 ▶ 弹「是否回溯上次对话」：是 → 带 -c / resume --last 继续；否 → 全新启动。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import type { NodeAgent } from '../../store'
import type { AgentProbe } from '../../../../shared/types'
import { SparkleIcon, UndoIcon, PlayIcon, CheckIcon } from '../../ui/Icons'

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

/** 拼 Claude Code 启动命令（权限已按需求取消，不再拼 --permission-mode） */
function buildClaudeCmd(model?: string, effort?: string, cont?: boolean): string {
  const p = ['claude']
  if (cont) p.push('-c')
  if (model) p.push('--model', model)
  if (effort) p.push('--effort', effort)
  return p.join(' ')
}

/** 拼 Codex 启动命令。回溯 = `codex resume --last`（沿用原会话配置）；
 *  全新 = `codex -m <model> -c model_reasoning_effort=<effort>`（本机 codex 0.145 核对，权限已取消不拼 sandbox/approval）。 */
function buildCodexCmd(model?: string, effort?: string, cont?: boolean): string {
  if (cont) return 'codex resume --last'
  const p = ['codex']
  if (model) p.push('-m', model)
  if (effort) p.push('-c', `model_reasoning_effort=${effort}`)
  return p.join(' ')
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
async function getProbe(): Promise<AgentProbe> {
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

type Pop = { type: 'model' | 'effort' | 'ask'; rect: DOMRect }

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

  const [probe, setProbe] = useState<AgentProbe | null>(probeCache?.data ?? null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [customModel, setCustomModel] = useState<string | null>(null) // null=菜单模式，string=自定义输入模式
  const popRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  // 开终端时拉一遍真实的 模型/effort（TTL 缓存）
  useEffect(() => {
    let live = true
    getProbe()
      .then((d) => live && setProbe(d))
      .catch(() => {})
    return () => {
      live = false
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

  const kind: Kind = agent?.kind ?? 'claude'
  const claudeReady = !probe || probe.claude.installed
  const codexReady = !!probe?.codex.installed
  const activeReady = kind === 'claude' ? claudeReady : codexReady

  const models = probe?.[kind].models ?? []
  const efforts = probe?.[kind].efforts ?? []
  const model = agent?.model?.[kind] || pickModel(models, kind)
  const effort = agent?.effort?.[kind] || pickEffort(efforts, kind)

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
    if (k === 'codex' && !codexReady) return // 未装 codex 不允许切过去
    setPop(null)
    mutate({ kind: k })
  }

  const openPop = (type: 'model' | 'effort', el: HTMLElement): void => {
    anchorRef.current = el
    setCustomModel(null)
    setPop((cur) => (cur?.type === type ? null : { type, rect: el.getBoundingClientRect() }))
  }
  const openAsk = (el: HTMLElement): void => {
    anchorRef.current = el
    setPop((cur) => (cur?.type === 'ask' ? null : { type: 'ask', rect: el.getBoundingClientRect() }))
  }

  const launch = (cont: boolean): void => {
    setPop(null)
    const cmd =
      kind === 'claude' ? buildClaudeCmd(model, effort, cont) : buildCodexCmd(model, effort, cont)
    window.api.pty.write(ptyId, cmd + '\r')
  }

  return (
    <div className="agentbar" onMouseDown={(e) => e.stopPropagation()}>
      <SparkleIcon size={13} className="ab-brand" />

      {/* [Claude | Codex] 段控件：选当前 agent，胶囊/启动随之切换 */}
      <div className="ab-seg">
        <button
          className={`ab-seg-b${kind === 'claude' ? ' on' : ''}`}
          onClick={() => setKind('claude')}
          disabled={!claudeReady}
          data-tip={!claudeReady ? '未检测到 claude 命令' : ''}
        >
          Claude
        </button>
        <button
          className={`ab-seg-b${kind === 'codex' ? ' on' : ''}`}
          onClick={() => setKind('codex')}
          disabled={!codexReady}
          data-tip={!codexReady ? '未检测到 codex（在终端运行 codex login 后可用）' : ''}
        >
          Codex
        </button>
      </div>

      {/* 模型 / 思考胶囊：选项跟随当前 agent */}
      <button className="ab-pill" onClick={(e) => openPop('model', e.currentTarget)}>
        <span className="ab-pill-k">模型</span>
        <b>{modelLabel(model, kind)}</b>
      </button>
      <button className="ab-pill" onClick={(e) => openPop('effort', e.currentTarget)}>
        <span className="ab-pill-k">思考</span>
        <b>{effZh(effort)}</b>
      </button>

      {/* ▶ 启动（弹「是否回溯」） */}
      <button
        className="ab-launch"
        disabled={!activeReady}
        data-tip={activeReady ? '启动' : `未检测到 ${kind} 命令`}
        onClick={(e) => activeReady && openAsk(e.currentTarget)}
      >
        <PlayIcon size={12} /> 启动
      </button>

      {/* 浮层：portal 到 body（.pane overflow:hidden 会裁切；zoom 下 rect 已是屏幕坐标，fixed 精准） */}
      {pop &&
        createPortal(
          <div
            ref={popRef}
            className="ab-pop"
            style={{ left: pop.rect.left, top: pop.rect.bottom + 6 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pop.type === 'ask' && (
              <div className="ab-ask">
                <div className="ab-ask-t">
                  <UndoIcon size={13} /> 是否回溯上次对话？
                </div>
                <div className="ab-ask-d">
                  继续 {kind === 'claude' ? 'Claude Code' : 'Codex'} 最近一次会话，还是全新开始？
                </div>
                <div className="ab-ask-btns">
                  <button className="ab-ask-yes" onClick={() => launch(true)}>
                    <UndoIcon size={12} /> 是，回溯
                  </button>
                  <button className="ab-ask-no" onClick={() => launch(false)}>
                    <PlayIcon size={12} /> 否，全新
                  </button>
                </div>
              </div>
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
