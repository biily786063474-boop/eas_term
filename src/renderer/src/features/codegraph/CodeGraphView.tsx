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

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodeGraphResult, Risk } from '../../../../shared/codeGraph.ts'
import { RefreshIcon } from '../../ui/Icons'
import { GraphCanvas, type GraphItem, type GraphLink } from './GraphCanvas.tsx'
import './codegraph.css'

/** 风险等级 → 颜色。**直接对着图纸 10 的 🟢🟡🔴⛔**，别在这儿另立一套。 */
const RISK_COLOR: Record<Risk, string> = {
  green: '#6ee7b7',
  amber: '#fcd34d',
  red: '#fda4af',
  frozen: '#7dd3fc'
}
/** 图例文案**跟着领地口径变**。
 *  · `mapped`  —— 命中本仓库的领地表，颜色说的是风险等级（图纸 10 那套）
 *  · `derived` —— 陌生项目，按目录结构现推，颜色说的是耦合轻重
 *  对陌生项目写「安全边界」是编造 —— 我们对它的架构一无所知。 */
const RISK_LABEL: Record<'mapped' | 'derived', Record<Risk, string>> = {
  mapped: { green: '常规', amber: '高耦合', red: '安全边界', frozen: '分发产物' },
  derived: { green: '耦合轻', amber: '耦合中', red: '耦合重', frozen: '分发产物' }
}

export function CodeGraphView({ root }: { root: string }): JSX.Element {
  const [graph, setGraph] = useState<CodeGraphResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 下钻到哪块地。null = 领地总览 */
  const [drill, setDrill] = useState<string | null>(null)
  /** 循环依赖那块**默认收起** —— 见下面渲染处的注释 */
  const [cyclesOpen, setCyclesOpen] = useState(false)
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
        label: t.name,
        weight: t.files,
        group: t.risk,
        color: RISK_COLOR[t.risk],
        hint: `${t.files} 个文件，跨界出 ${t.crossOut} 入 ${t.crossIn}`
      })),
      links: graph.territories.links.map((l) => ({
        from: l.from,
        to: l.to,
        count: l.count,
        cycle: cycPairs.has(`${l.from}→${l.to}`)
      }))
    }
  }, [graph])

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
        color: RISK_COLOR[n.risk],
        hint: `被依赖 ${n.inDegree} · 依赖 ${n.outDegree}`
      })),
      links: [...links.values()]
    }
  }, [graph, drill])

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
          重新扫描
        </button>
      </div>
    )
  }
  if (!graph) {
    return <div className="cg-wrap cg-msg">{busy ? '正在扫描…' : '准备中…'}</div>
  }

  const runtimeCycles = graph.cycles.filter((c) => c.severity === 'runtime')
  const typeCycles = graph.cycles.filter((c) => c.severity === 'type')
  const unknownCycles = graph.cycles.filter((c) => c.severity === 'unknown')

  return (
    <div className="cg-wrap">
      <div className="cg-bar">
        <span className="cg-stat">
          <b>{graph.nodes.length}</b> 模块
        </span>
        <span className="cg-stat">
          <b>{graph.edges.length}</b> 依赖
        </span>
        <span className="cg-stat">
          <b>{graph.territories.stats.length}</b> 块地
        </span>
        <span className="cg-sep" />
        {/* **循环依赖分三档显示，不合并成一个数字。**
            合并的话 store 那 8 条类型循环会把「有 2 个真问题」淹掉 ——
            而一张全是红的图等于没有红。 */}
        <span className={`cg-stat${runtimeCycles.length ? ' bad' : ' ok'}`}>
          <b>{runtimeCycles.length}</b> 个运行时环
        </span>
        {typeCycles.length > 0 && (
          <span className="cg-stat dim" title="纯 import type，编译后不存在，运行时不成环">
            {typeCycles.length} 个类型环（无害）
          </span>
        )}
        {unknownCycles.length > 0 && (
          <span className="cg-stat warn" title="源码里找不到那个说明符，判不出是类型还是值">
            {unknownCycles.length} 个判不出
          </span>
        )}
        <span className="cg-spacer" />
        {/* **口径要如实写出来。**「按目录扫」和「从入口走」回答的不是同一个问题
            （前者含没人 import 的死代码），不说明的话两张图混着看会得出错结论。
            领地是不是现推的同理 —— 决定了颜色是「风险」还是「耦合」。 */}
        <span
          className="cg-stat dim"
          title={
            (graph.strategy === 'entries'
              ? '认出了具名入口，图上是从入口够得着的模块 ＋ 各源码目录里的文件'
              : '没认出具名入口，退回扫所有装着源码的目录 —— 会包含没人 import 的死代码和工具脚本') +
            '\n扫了：' +
            graph.scanned.join('、') +
            (graph.territoryMode === 'derived'
              ? '\n\n领地按这个项目自己的目录结构现推，颜色表示耦合轻重'
              : '\n\n领地命中了内置领地图，颜色表示风险等级')
          }
        >
          {graph.strategy === 'entries' ? '按入口' : '按目录'} ·{' '}
          {graph.territoryMode === 'derived' ? '目录分组' : '领地图'}
        </span>
        <span className="cg-ms">{graph.ms}ms</span>
        <button type="button" className="cg-btn icon" onClick={scan} disabled={busy} title="重新扫描">
          <RefreshIcon size={12} />
        </button>
      </div>

      {drill ? (
        <div className="cg-body">
          <button type="button" className="cg-back" onClick={() => setDrill(null)}>
            ← 回到总览
          </button>
          <div className="cg-drill-hd">
            {drill} · {drillFiles.length} 个文件
            {drillFiles.length > 24 && <span className="cg-note">（图上只画耦合最重的 24 个）</span>}
          </div>
          <GraphCanvas
            items={drillGraph.items}
            links={drillGraph.links}
            groupOrder={RISK_ORDER}
            onPick={() => undefined}
          />
          <div className="cg-files">
            {drillFiles.map((f) => (
              <div key={f.id} className="cg-file">
                <span className="cg-file-n" title={f.id}>
                  {f.id.split('/').slice(-2).join('/')}
                </span>
                <span className="cg-deg" title="被依赖 / 依赖别人">
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
                运行时循环依赖 —— 这些是真要修的
                <span className="cg-cycles-n">
                  {runtimeCycles.length} 个环 · {runtimeCycles.reduce((n, c) => n + c.edges.length, 0)} 条边
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
            onPick={setDrill}
          />

          {/* 卡片降为图例 + 明细：图回答「谁和谁连」，卡片回答「具体多少」。 */}
          <div className="cg-terr">
            {graph.territories.stats.map((t) => (
              <button
                key={t.name}
                type="button"
                className="cg-tcard"
                onClick={() => setDrill(t.name)}
                style={{ borderLeftColor: RISK_COLOR[t.risk] }}
              >
                <div className="cg-tname">
                  {t.name}
                  <span className="cg-trisk" style={{ color: RISK_COLOR[t.risk] }}>
                    {RISK_LABEL[graph.territoryMode][t.risk]}
                  </span>
                </div>
                <div className="cg-tnum">{t.files} 个文件</div>
                <div className="cg-tcross">
                  跨界 出 <b>{t.crossOut}</b> · 入 <b>{t.crossIn}</b>
                </div>
              </button>
            ))}
          </div>

          {/* 跨领地的边，按条数排 —— 排最前的那几条就是这个项目的主耦合线 */}
          <div className="cg-links-hd">跨领地依赖（前 10）</div>
          <div className="cg-links">
            {graph.territories.links.slice(0, 10).map((l) => (
              <div key={`${l.from}→${l.to}`} className="cg-link">
                <span className="cg-lf">{l.from}</span>
                <span className="cg-la">→</span>
                <span className="cg-lt">{l.to}</span>
                <span className="cg-lc">{l.count}</span>
              </div>
            ))}
          </div>

          {graph.unresolved.length > 0 && (
            <div className="cg-unres">
              没能解析的依赖：{graph.unresolved.join('、')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const short = (p: string): string => p.split('/').slice(-2).join('/')

/** 环上的分组顺序：安全边界的排在一起，绿的排一起 ——
 *  于是「红区之间的连线」在图上是一段集中的弦，一眼认得出。 */
const RISK_ORDER = ['red', 'amber', 'frozen', 'green']
