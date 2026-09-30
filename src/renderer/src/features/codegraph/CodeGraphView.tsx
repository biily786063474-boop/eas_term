// 代码可视化模块：看清这个项目的结构与耦合状态。
//
// ── 默认视图为什么是「领地级」而不是「文件级」──────────────────────────────
// 这个仓库实测 383 个模块、1118 条边。全画出来是一团毛线 ——
// 而人真正想知道的是「**哪块地在跨界拉扯**」。所以默认按领地聚合成十几个节点，
// 点进去才看文件。
//
// ── 它和 `docs/architecture/` 的手写图纸是什么关系 ──────────────────────────
// **补充，不是取代。** 图纸讲的是「应该怎样」（禁区、纪律、历史教训），
// 这里画的是「现在实际怎样」。两者对不上的时候，那个差就是最有价值的信息。
// 领地划分与风险等级直接引自图纸（`shared/codeGraph.ts` 的 TERRITORIES 是它的镜像）。

import { openArtifact } from '../canvas/openArtifact'
import { useStore } from '../../store'
import { openGraphFile } from './openFileTarget'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodeGraphResult, Risk } from '../../../../shared/codeGraph.ts'
import { RefreshIcon } from '../../ui/Icons'
import { useT, t as tNow } from '../../i18n.ts'
import type { I18nKey } from '../../../../shared/i18n/index.ts'
import { GraphCanvas, type GraphItem, type GraphLink, type LayoutKind } from './GraphCanvas.tsx'
import { inboundRatio } from './radial.ts'
import { SymbolView } from './SymbolView.tsx'
import './codegraph.css'

/** 风险等级 → 颜色。**直接对着图纸 10 的 🟢🟡🔴⛔**，别在这儿另立一套。 */
/** 风险等级 → **令牌**（不是写死的十六进制）。
 *  写死的在亮色主题下是错的 —— `--sem-*` 在两个主题里各有一套，
 *  暗底调的粉压白底上对比度只有 1.4（图纸 15 规矩 ③）。
 *
 *  ⚠️ **`frozen` 不给独立色相。** 图纸 15 规矩 ④：强调靠明度不靠色相，
 *  一屏里色相越少越好；「分发产物」用弱文字色退到后面就够了。 */
/** 风险等级 → **RGB 三元组**。渲染层按不同 alpha 组出体量/内环/核心三层。
 *
 *  ⚠️ **不要在这里掺灰。** 上一版用 `color-mix(… , var(--s-2))` 把干净色相往
 *  近黑里掺 —— 同时降明度和降饱和，出来是泥（用户原话「配色也脏」）。
 *  干净色相 ＋ 低 alpha 压在暗底上，才是干净的淡色。
 *
 *  **「常规」仍然不给色相**（它表达的是「这里没事」，一屏里占大多数）：
 *  给白，于是三层退化成干净的灰阶，不引入任何色相。 */
const RISK_RGB: Record<Risk, string> = {
  green: '255, 255, 255',
  amber: 'var(--sem-warn-rgb)',
  red: 'var(--sem-danger-rgb)',
  frozen: '255, 255, 255'
}
/** 标签文字的颜色。**和节点填充分开一套** ——
 *  节点是半透明的色块（可以很淡），文字要读得清，不能直接套那个值。
 *  但同一条纪律：「常规」是「这里没事」，**不给色相**。 */
const RISK_TEXT: Record<Risk, string> = {
  green: 'var(--t-3)',
  amber: 'var(--sem-warn)',
  red: 'var(--sem-danger)',
  frozen: 'var(--t-3)'
}

/** 同一套色的 rgb 分量，给卡片的渐变用（`--tint`）。中性档给白，
 *  于是渐变退化成一层极淡的高光，不引入任何色相。 */
const RISK_TINT: Record<Risk, string> = {
  green: 'var(--sem-ok-rgb)',
  amber: 'var(--sem-warn-rgb)',
  red: 'var(--sem-danger-rgb)',
  frozen: '255, 255, 255'
}
/** 图例文案**跟着领地口径变**。
 *  · `mapped`  —— 命中本仓库的领地表，颜色说的是风险等级（图纸 10 那套）
 *  · `derived` —— 陌生项目，按目录结构现推，颜色说的是耦合轻重
 *  对陌生项目写「安全边界」是编造 —— 我们对它的架构一无所知。 */
const riskLabel = (mode: 'mapped' | 'derived', risk: Risk): string =>
  tNow(`codegraph.risk.${mode}.${risk}` as I18nKey)

/** 内置领地名（数据里是中文 id，界面上按语言显示）。目录名等项目数据原样返回。 */
const TERR_NAME_KEY: Record<string, I18nKey> = {
  '未登记': 'codegraph.terrName.unregistered', // i18n-allow: 领地 id 是数据键
  '根目录': 'codegraph.terrName.root', // i18n-allow: 领地 id 是数据键
  '其它': 'codegraph.terrName.other', // i18n-allow: 领地 id 是数据键
  '构建输出': 'codegraph.terrName.build', // i18n-allow: 领地 id 是数据键
  '分发产物': 'codegraph.terrName.dist', // i18n-allow: 领地 id 是数据键
  '契约层': 'codegraph.terrName.contract', // i18n-allow: 领地 id 是数据键
  '隧道': 'codegraph.terrName.tunnel', // i18n-allow: 领地 id 是数据键
  'MCP 协议': 'codegraph.terrName.mcp', // i18n-allow: 领地 id 是数据键
  'omp 底座': 'codegraph.terrName.omp', // i18n-allow: 领地 id 是数据键
  'AI 会话': 'codegraph.terrName.aiSession', // i18n-allow: 领地 id 是数据键
  'CLI 装登': 'codegraph.terrName.cliAuth', // i18n-allow: 领地 id 是数据键
  '手机端': 'codegraph.terrName.phone', // i18n-allow: 领地 id 是数据键
  'skill 库': 'codegraph.terrName.skillLib', // i18n-allow: 领地 id 是数据键
  '知识库': 'codegraph.terrName.wiki', // i18n-allow: 领地 id 是数据键
  '主进程': 'codegraph.terrName.main', // i18n-allow: 领地 id 是数据键
  '灵动岛': 'codegraph.terrName.island', // i18n-allow: 领地 id 是数据键
  '画布': 'codegraph.terrName.canvas', // i18n-allow: 领地 id 是数据键
  '设计模块': 'codegraph.terrName.design', // i18n-allow: 领地 id 是数据键
  '工作区': 'codegraph.terrName.workspace', // i18n-allow: 领地 id 是数据键
  '终端': 'codegraph.terrName.terminal', // i18n-allow: 领地 id 是数据键
  '状态机': 'codegraph.terrName.status', // i18n-allow: 领地 id 是数据键
  'AI 对话': 'codegraph.terrName.aiChat', // i18n-allow: 领地 id 是数据键
  '其余 feature': 'codegraph.terrName.otherFeatures', // i18n-allow: 领地 id 是数据键
  'UI 原子': 'codegraph.terrName.uiAtoms', // i18n-allow: 领地 id 是数据键
  '渲染层其余': 'codegraph.terrName.rendererRest' // i18n-allow: 领地 id 是数据键
}
const terrName = (name: string): string => {
  const k = TERR_NAME_KEY[name]
  return k ? tNow(k) : name
}

/** 代码地图的外壳：**模块级**（谁 import 谁）和**符号级**（谁调用谁）两个视图。
 *
 *  分成两个而不是一个，是因为它们回答的不是同一个问题、规模也差两个数量级：
 *  模块级 448 个节点（聚合到 23 块地），符号级 22909 个（只能按文件下钻）。
 *  硬塞进一张图的结果是两边都读不了。 */
/** frameId：在画布节点里渲染时由注册表注入，点文件就在同一 Frame 开预览；分屏里不传，走 openFile。 */
export function CodeGraphView({ root, frameId }: { root: string; frameId?: string }): JSX.Element {
  const t = useT()
  const [mode, setMode] = useState<'module' | 'symbol'>('module')
  return (
    <div className="cg-shell">
      <div className="cg-modes">
        <button
          type="button"
          className={`cg-mode${mode === 'module' ? ' on' : ''}`}
          onClick={() => setMode('module')}
        >
          {t('codegraph.mode.module')}
        </button>
        <button
          type="button"
          className={`cg-mode${mode === 'symbol' ? ' on' : ''}`}
          onClick={() => setMode('symbol')}
          title={t('codegraph.mode.symbolTip')}
        >
          {t('codegraph.mode.symbol')}
        </button>
      </div>
      {mode === 'module' ? <ModuleGraphView root={root} frameId={frameId} /> : <SymbolView root={root} />}
    </div>
  )
}

function ModuleGraphView({ root, frameId }: { root: string; frameId?: string }): JSX.Element {
  const tr = useT()
  /** 点文件节点 / 文件列表 → 打开那个文件（2026-09-14）。落点判定在 openFileTarget.ts。 */
  const openFileOnMap = (rel: string): void =>
    openGraphFile(root, rel, { frameId, openArtifact, openFile: (abs) => { void useStore.getState().openFile(abs) } })
  const [graph, setGraph] = useState<CodeGraphResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 下钻到哪块地。null = 领地总览 */
  const [drill, setDrill] = useState<string | null>(null)
  /** 循环依赖那块**默认收起** —— 见下面渲染处的注释 */
  const [cyclesOpen, setCyclesOpen] = useState(false)
  /** 排布方式。**默认环形** —— 它确定、不掉帧，且任意两点之间的弦一眼可见；
   *  力导向答的是另一个问题（哪几块抱团），并列给出让用户自己挑。 */
  const [layout, setLayout] = useState<LayoutKind>('ring')
  /** 下面两个面板默认收起（只露前 `DASH_ROWS` 条）——
   *  它们是 dashboard，不该和图抢视觉重心 */
  const [terrOpen, setTerrOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const aliveRef = useRef(true)

  const scan = (): void => {
    setBusy(true)
    setErr(null)
    void window.api.codeGraph.analyze(root).then((r) => {
      if (!aliveRef.current) return
      setBusy(false)
      if (r.ok) setGraph(r.graph)
      // 一句人话 + 不倒日志（见「失败要说人话」那条纪律）
      else setErr(r.error)
    })
  }

  useEffect(() => {
    aliveRef.current = true
    scan()
    return () => {
      aliveRef.current = false
    }
    // root 变了要重扫；scan 是稳定的闭包，不进依赖
  }, [root])

  /** 领地级的节点连线图。**这是默认视图** —— 用户要的是「看清耦合」，
   *  而 23 个节点的环形图一眼就能看出哪几块地互相拉扯。 */
  const terrGraph = useMemo(() => {
    if (!graph) return { items: [] as GraphItem[], links: [] as GraphLink[] }
    // 参与运行时循环的领地对 —— 那几条线要单独标出来
    const cycPairs = new Set<string>()
    for (const c of graph.cycles) {
      if (c.severity !== 'runtime') continue
      for (const e of c.edges) {
        const a = graph.nodes.find((n) => n.id === e.from)?.territory
        const b = graph.nodes.find((n) => n.id === e.to)?.territory
        if (a && b && a !== b) cycPairs.add(`${a}→${b}`)
      }
    }
    return {
      items: graph.territories.stats.map((t) => ({
        id: t.name,
        label: terrName(t.name),
        weight: t.files,
        group: t.risk,
        rgb: RISK_RGB[t.risk],
        // 外弧 = 被依赖占比。**「大家都在用它」和「它在用所有人」是两种耦合**，
        // 处理方式完全不同，而在这之前这个信息只在下面的卡片里
        ratio: inboundRatio(t.crossIn, t.crossOut),
        hint:
          inboundRatio(t.crossIn, t.crossOut) === null
            ? tr('codegraph.terr.hintNone', { files: t.files, out: t.crossOut, in: t.crossIn })
            : tr('codegraph.terr.hintRatio', {
                files: t.files,
                out: t.crossOut,
                in: t.crossIn,
                pct: Math.round((inboundRatio(t.crossIn, t.crossOut) ?? 0) * 100)
              })
      })),
      links: graph.territories.links.map((l) => ({
        from: l.from,
        to: l.to,
        count: l.count,
        cycle: cycPairs.has(`${l.from}→${l.to}`)
      }))
    }
  }, [graph, tr])

  /** 下钻之后那块地内部的图。文件多的时候只画耦合最重的前 24 个 ——
   *  再多就成了毛线，而毛线回答不了任何问题。 */
  const drillGraph = useMemo(() => {
    if (!graph || !drill) return { items: [] as GraphItem[], links: [] as GraphLink[] }
    const top = graph.nodes
      .filter((n) => n.territory === drill)
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree))
      .slice(0, 24)
    const ids = new Set(top.map((n) => n.id))
    const links = new Map<string, GraphLink>()
    for (const e of graph.edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue
      const k = `${e.from}→${e.to}`
      const prev = links.get(k)
      links.set(k, { from: e.from, to: e.to, count: (prev?.count ?? 0) + 1, cycle: e.circular && e.typeOnly === false })
    }
    return {
      items: top.map((n) => ({
        id: n.id,
        label: n.id.split('/').pop() ?? n.id,
        weight: n.inDegree + n.outDegree || 1,
        group: n.risk,
        rgb: RISK_RGB[n.risk],
        ratio: inboundRatio(n.inDegree, n.outDegree),
        hint: tr('codegraph.node.hint', { inD: n.inDegree, outD: n.outDegree })
      })),
      links: [...links.values()]
    }
  }, [graph, drill, tr])

  /** 下钻视图里的文件。按「扇入 + 扇出」排，耦合最重的排前面。 */
  const drillFiles = useMemo(() => {
    if (!graph || !drill) return []
    return graph.nodes
      .filter((n) => n.territory === drill)
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree))
  }, [graph, drill])

  if (err) {
    return (
      <div className="cg-wrap cg-msg">
        <div className="cg-err">{err}</div>
        <button type="button" className="cg-btn" onClick={scan}>
          {tr('codegraph.rescan')}
        </button>
      </div>
    )
  }
  if (!graph) {
    return <div className="cg-wrap cg-msg">{busy ? tr('codegraph.scanning') : tr('codegraph.preparing')}</div>
  }

  const runtimeCycles = graph.cycles.filter((c) => c.severity === 'runtime')
  const typeCycles = graph.cycles.filter((c) => c.severity === 'type')
  const unknownCycles = graph.cycles.filter((c) => c.severity === 'unknown')

  return (
    <div className="cg-wrap">
      <div className="cg-bar">
        <span className="cg-stat">
          <b>{graph.nodes.length}</b> {tr('codegraph.unit.modules')}
        </span>
        <span className="cg-stat">
          <b>{graph.edges.length}</b> {tr('codegraph.unit.deps')}
        </span>
        <span className="cg-stat">
          <b>{graph.territories.stats.length}</b> {tr('codegraph.unit.territories')}
        </span>
        <span className="cg-sep" />
        {/* **循环依赖分三档显示，不合并成一个数字。**
            合并的话 store 那 8 条类型循环会把「有 2 个真问题」淹掉 ——
            而一张全是红的图等于没有红。 */}
        <span className={`cg-stat${runtimeCycles.length ? ' bad' : ' ok'}`}>
          <b>{runtimeCycles.length}</b> {tr('codegraph.unit.runtimeCycles')}
        </span>
        {typeCycles.length > 0 && (
          <span className="cg-stat dim" title={tr('codegraph.cycles.typeTip')}>
            {tr('codegraph.cycles.typeLabel', { n: typeCycles.length })}
          </span>
        )}
        {unknownCycles.length > 0 && (
          <span className="cg-stat warn" title={tr('codegraph.cycles.unknownTip')}>
            {tr('codegraph.cycles.unknownLabel', { n: unknownCycles.length })}
          </span>
        )}
        <span className="cg-spacer" />
        {/* 排布切换。做成两个小字而不是下拉：只有两个选项，
            下拉多一次点击且藏住了另一个的存在 */}
        <span className="cg-layouts">
          {(['ring', 'force'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`cg-layout${layout === k ? ' on' : ''}`}
              onClick={() => setLayout(k)}
              title={
                k === 'ring' ? tr('codegraph.layout.ringTip') : tr('codegraph.layout.forceTip')
              }
            >
              {k === 'ring' ? tr('codegraph.layout.ring') : tr('codegraph.layout.force')}
            </button>
          ))}
        </span>
        {/* **口径要如实写出来。**「按目录扫」和「从入口走」回答的不是同一个问题
            （前者含没人 import 的死代码），不说明的话两张图混着看会得出错结论。
            领地是不是现推的同理 —— 决定了颜色是「风险」还是「耦合」。 */}
        <span
          className="cg-stat dim"
          title={tr('codegraph.scope.tip', {
            strategy: graph.strategy === 'entries' ? tr('codegraph.scope.entries') : tr('codegraph.scope.fallback'),
            scanned: graph.scanned.join(tr('codegraph.listSep')),
            territory: graph.territoryMode === 'derived' ? tr('codegraph.scope.derived') : tr('codegraph.scope.mapped')
          })}
        >
          {tr('codegraph.scope.badge', {
            a: graph.strategy === 'entries' ? tr('codegraph.scope.byEntries') : tr('codegraph.scope.byDir'),
            b: graph.territoryMode === 'derived' ? tr('codegraph.scope.dirGroups') : tr('codegraph.scope.terrMap')
          })}
        </span>
        {/* **技术栈与粒度要写出来。** Swift 画的是 target 之间的关系，
            和 JS 那张「文件之间」不是同一种东西 —— 不说明的话，
            一个 159 个文件、图上只有 5 个点的 Swift 项目会被读成「耦合很低」。 */}
        {graph.stacks.length > 0 && (
          <span
            className="cg-stat dim"
            title={
              graph.stacks.map((s) => STACK_LABEL[s] ?? s).join(' ＋ ') +
              (graph.granularity.swift === 'module' ? '\n\n' + tr('codegraph.stack.swiftWarn') : '')
            }
          >
            {graph.stacks.map((s) => STACK_LABEL[s] ?? s).join('+')}
            {graph.granularity.swift === 'module' && <b className="cg-warn-dot"> {tr('codegraph.stack.moduleLevel')}</b>}
          </span>
        )}
        <span className="cg-ms">{graph.ms}ms</span>
        <button type="button" className="cg-btn icon" onClick={scan} disabled={busy} title={tr('codegraph.rescan')}>
          <RefreshIcon size={12} />
        </button>
      </div>

      {drill ? (
        <div className="cg-body">
          <button type="button" className="cg-back" onClick={() => setDrill(null)}>
            {tr('codegraph.drill.back')}
          </button>
          <div className="cg-drill-hd">
            {tr('codegraph.drill.head', { name: terrName(drill), n: drillFiles.length })}
            {drillFiles.length > 24 && <span className="cg-note">{tr('codegraph.drill.topNote')}</span>}
          </div>
          <GraphCanvas
            items={drillGraph.items}
            links={drillGraph.links}
            groupOrder={RISK_ORDER}
            layout={layout}
            onPick={openFileOnMap}
          />
          <div className="cg-files">
            {drillFiles.map((f) => (
              <div key={f.id} className="cg-file">
                <button type="button" className="cg-file-n cg-file-open" title={tr('codegraph.drill.open', { id: f.id })} onClick={() => openFileOnMap(f.id)}>
                  {f.id.split('/').slice(-2).join('/')}
                </button>
                <span className="cg-deg" title={tr('codegraph.drill.degTip')}>
                  ← {f.inDegree} · {f.outDegree} →
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="cg-body">
          {/* **默认折叠。**本仓库的环只有 2×3 条边，摊开无所谓；
              别人的项目里一个环能有几十条（taptv 实测 35 条），
              摊开就是一堵文字墙，把主视图那张图整个挤出屏幕。
              折叠态仍然把「有几个环、共几条边」说清楚 —— 折叠是收起细节，不是藏起问题。 */}
          {runtimeCycles.length > 0 && (
            <div className="cg-cycles">
              <button
                type="button"
                className="cg-cycles-hd"
                aria-expanded={cyclesOpen}
                onClick={() => setCyclesOpen((v) => !v)}
              >
                <span className={`cg-caret${cyclesOpen ? ' open' : ''}`}>›</span>
                {tr('codegraph.cycles.head')}
                <span className="cg-cycles-n">
                  {tr('codegraph.cycles.count', {
                    n: runtimeCycles.length,
                    edges: runtimeCycles.reduce((n, c) => n + c.edges.length, 0)
                  })}
                </span>
              </button>
              {cyclesOpen &&
                runtimeCycles.map((c, i) => (
                  <div key={i} className="cg-cycle">
                    {c.edges.map((e) => `${short(e.from)} → ${short(e.to)}`).join('  ·  ')}
                  </div>
                ))}
            </div>
          )}

          {/* **节点连线图是主视图**（用户 2026-09-03 要的）。
              环形而不是力导向，理由在 `radial.ts` 的文件头：确定、不掉帧、
              而且任意两点之间的弦一眼可见 —— 正对上「谁和谁连」这个问题。
              点节点下钻到那块地。 */}
          <GraphCanvas
            items={terrGraph.items}
            links={terrGraph.links}
            groupOrder={RISK_ORDER}
            layout={layout}
            onPick={setDrill}
          />

          {/* ── 下面两块是 dashboard，不是第二个视觉重心 ──────────────────────
              用户 2026-09-03：「三部分的视觉重心好像都一样，我希望一页里面
              只去展示一个视觉重心」。**图是主角**，所以这两块：
                · 从大卡片网格降成紧凑行列表（26 张卡撑满一屏就成了第二个重心）
                · 一排二并列，不再上下各占一大段
                · 默认只露前 6 条，其余渐进式披露 —— 要看全的人点一下就有，
                  不看的人不用为它滚过半屏 */}
          <div className="cg-dash">
            <section className="cg-panel">
              <button
                type="button"
                className="cg-panel-hd"
                onClick={() => setTerrOpen((v) => !v)}
                aria-expanded={terrOpen}
              >
                <span className={`cg-caret${terrOpen ? ' open' : ''}`}>›</span>
                {tr('codegraph.panel.territories')}
                <span className="cg-panel-n">{graph.territories.stats.length}</span>
              </button>
              <div className="cg-rows">
                {(terrOpen ? graph.territories.stats : graph.territories.stats.slice(0, DASH_ROWS)).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className="cg-row"
                    onClick={() => setDrill(t.name)}
                    style={{ ['--tint' as string]: RISK_TINT[t.risk] } as React.CSSProperties}
                  >
                    <span className="cg-row-n">{terrName(t.name)}</span>
                    <span className="cg-row-tag" style={{ color: RISK_TEXT[t.risk] }}>
                      {riskLabel(graph.territoryMode, t.risk)}
                    </span>
                    <span className="cg-row-v">{tr('codegraph.panel.rowFiles', { n: t.files })}</span>
                    <span className="cg-row-v dim">{tr('codegraph.panel.rowCross', { out: t.crossOut, in: t.crossIn })}</span>
                  </button>
                ))}
              </div>
              {!terrOpen && graph.territories.stats.length > DASH_ROWS && (
                <button type="button" className="cg-more" onClick={() => setTerrOpen(true)}>
                  {tr('codegraph.panel.moreTerr', { n: graph.territories.stats.length - DASH_ROWS })}
                </button>
              )}
            </section>

            <section className="cg-panel">
              <button
                type="button"
                className="cg-panel-hd"
                onClick={() => setLinkOpen((v) => !v)}
                aria-expanded={linkOpen}
              >
                <span className={`cg-caret${linkOpen ? ' open' : ''}`}>›</span>
                {tr('codegraph.panel.links')}
                <span className="cg-panel-n">{graph.territories.links.length}</span>
              </button>
              <div className="cg-rows">
                {(linkOpen
                  ? graph.territories.links.slice(0, 40)
                  : graph.territories.links.slice(0, DASH_ROWS)
                ).map((l) => (
                  <div key={`${l.from}→${l.to}`} className="cg-row static">
                    <span className="cg-row-n">{terrName(l.from)}</span>
                    <span className="cg-row-arrow">→</span>
                    <span className="cg-row-n">{terrName(l.to)}</span>
                    <span className="cg-row-v">{l.count}</span>
                  </div>
                ))}
              </div>
              {!linkOpen && graph.territories.links.length > DASH_ROWS && (
                <button type="button" className="cg-more" onClick={() => setLinkOpen(true)}>
                  {tr('codegraph.panel.moreLinks', { n: Math.min(graph.territories.links.length, 40) - DASH_ROWS })}
                </button>
              )}
            </section>
          </div>

          {graph.unresolved.length > 0 && (
            <div className="cg-unres">
              {tr('codegraph.unresolved', { list: graph.unresolved.join(tr('codegraph.listSep')) })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const short = (p: string): string => p.split('/').slice(-2).join('/')

/** 技术栈的显示名。 */
const STACK_LABEL: Record<string, string> = {
  js: 'JS/TS',
  python: 'Python',
  c: 'C/C++',
  swift: 'Swift'
}

/** 收起时每个面板露几行。**6 行是「够看出趋势、又不占版面」的量** ——
 *  再多就开始和图抢注意力，再少则连排第一的那几条都看不全。 */
const DASH_ROWS = 6

/** 环上的分组顺序：安全边界的排在一起，绿的排一起 ——
 *  于是「红区之间的连线」在图上是一段集中的弦，一眼认得出。 */
const RISK_ORDER = ['red', 'amber', 'frozen', 'green']
