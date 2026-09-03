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
import './codegraph.css'

/** 风险等级 → 颜色。**直接对着图纸 10 的 🟢🟡🔴⛔**，别在这儿另立一套。 */
const RISK_COLOR: Record<Risk, string> = {
  green: '#6ee7b7',
  amber: '#fcd34d',
  red: '#fda4af',
  frozen: '#7dd3fc'
}
const RISK_LABEL: Record<Risk, string> = {
  green: '常规',
  amber: '高耦合',
  red: '安全边界',
  frozen: '分发产物'
}

export function CodeGraphView({ root }: { root: string }): JSX.Element {
  const [graph, setGraph] = useState<CodeGraphResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 下钻到哪块地。null = 领地总览 */
  const [drill, setDrill] = useState<string | null>(null)
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
          </div>
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
          {runtimeCycles.length > 0 && (
            <div className="cg-cycles">
              <div className="cg-cycles-hd">运行时循环依赖 —— 这些是真要修的</div>
              {runtimeCycles.map((c, i) => (
                <div key={i} className="cg-cycle">
                  {c.edges.map((e) => `${short(e.from)} → ${short(e.to)}`).join('  ·  ')}
                </div>
              ))}
            </div>
          )}

          {/* 领地卡片。按文件数排，跨界耦合用一条比例条表示 ——
              「出边有多少落在别的地里」才是耦合的主指标。 */}
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
                    {RISK_LABEL[t.risk]}
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
