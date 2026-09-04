// 符号级视图（第一期）：**文件内结构图 ＋ 死代码清单**。
//
// ── 为什么第一期只做这两个 ──────────────────────────────────────────────────
// 本仓库实测 22909 个符号 —— 全画出来是一团毛线，而毛线回答不了任何问题
//（和模块级默认聚合到领地是同一个道理）。
// 文件内结构反过来正合适：一个文件通常 5~30 个符号，现成的环形图直接能用。
// 死代码清单更是不用画图 —— 一张表，而且实测 9 条里 8 条是对的。
//
// 跨文件的「谁调用了这个」是第二期（邻域视图），要接 LSP 那套抽象，见
// `docs/代码地图-AST符号级可视化-可行性与设计.html`。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SymbolGraphResult, SymbolNode } from '../../../../shared/symbolGraph.ts'
import { refOf, type Neighborhood, type ProviderInfo } from '../../../../shared/symbolProvider.ts'
import { RefreshIcon } from '../../ui/Icons'
import { GraphCanvas, type GraphItem, type GraphLink } from './GraphCanvas.tsx'

/** 符号种类 → 颜色。和模块级那套风险色**刻意不同** ——
 *  这里表达的是「它是什么」，不是「它有多危险」，共用一套色会让人读串。 */
/** 符号种类 → 颜色。**只用两个色相 ＋ 中性**（图纸 15 规矩 ④：色相越少越好）。
 *  原来四个种类各一个色相（蓝/紫/黄/绿），一屏几十个点就是一盘杂色 ——
 *  而「函数还是方法」这个区分远没有重要到值一个色相。
 *  现在：类＝暖色（它是结构）、箭头函数＝弱一档、其余＝中性。 */
const KIND_COLOR: Record<SymbolNode['kind'], string> = {
  function: 'var(--t-2)',
  method: 'var(--t-2)',
  class: 'var(--sem-warn)',
  arrow: 'var(--t-3)',
  other: 'var(--t-3)'
}
const KIND_LABEL: Record<SymbolNode['kind'], string> = {
  function: '函数',
  method: '方法',
  class: '类',
  arrow: '箭头函数',
  other: '其它'
}

export function SymbolView({ root }: { root: string }): JSX.Element {
  const [g, setG] = useState<SymbolGraphResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 打开了哪个文件的结构图。null = 只看清单 */
  const [openFile, setOpenFile] = useState<string | null>(null)
  /** 选中的符号的邻域。null = 没选 */
  const [nb, setNb] = useState<Neighborhood | null>(null)
  const [nbErr, setNbErr] = useState<string | null>(null)
  const [nbBusy, setNbBusy] = useState(false)
  /** 各语言服务器装没装。**要如实列** —— 没装就说清楚，别让用户以为是坏了 */
  const [provs, setProvs] = useState<ProviderInfo[]>([])
  const alive = useRef(true)

  const scan = (): void => {
    setBusy(true)
    setErr(null)
    void window.api.codeGraph.symbols(root).then((r) => {
      if (!alive.current) return
      setBusy(false)
      if (r.ok) setG(r.graph)
      else setErr(r.error)
    })
  }
  useEffect(() => {
    void window.api.codeGraph.providers(root).then((r) => {
      if (alive.current && r.ok) setProvs(r.providers)
    })
  }, [root])

  useEffect(() => {
    alive.current = true
    scan()
    return () => {
      alive.current = false
    }
  }, [root])

  /** 查一个符号的邻域。**列传 0** —— `refOf` 里做 1-based → 0-based 的转换，
   *  而 TS provider 会从那个位置往里找标识符，落在行首也找得到。 */
  const askNeighborhood = (sym: SymbolNode): void => {
    setNbBusy(true)
    setNbErr(null)
    setNb(null)
    void window.api.codeGraph.neighborhood(root, refOf(sym)).then((r) => {
      if (!alive.current) return
      setNbBusy(false)
      if (r.ok) setNb(r.neighborhood)
      else setNbErr(r.error)
    })
  }

  /** 打开的那个文件的结构图。 */
  const structure = useMemo((): { items: GraphItem[]; links: GraphLink[] } => {
    const f = g?.files.find((x) => x.file === openFile)
    if (!f) return { items: [], links: [] }
    // 文件太大时只画引用最多的前 30 个 —— 再多就是毛线
    const top = [...f.symbols].sort((a, b) => b.refs - a.refs).slice(0, 30)
    const ids = new Set(top.map((s) => s.id))
    return {
      items: top.map((s) => ({
        id: s.id,
        label: s.name,
        weight: s.refs + 1,
        group: s.kind,
        color: KIND_COLOR[s.kind],
        hint: `${KIND_LABEL[s.kind]} · 第 ${s.line} 行 · 被引用 ${s.refs} 次${s.exported ? ' · 导出' : ''}`
      })),
      links: f.edges
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => ({ from: e.from, to: e.to, count: 1 }))
    }
  }, [g, openFile])

  /** 语言服务器清单。**装没装、缺什么配置都写出来** ——
   *  「查不了」和「查出来是空的」在界面上长得一样，而下一步完全不同。 */
  const provList =
    provs.length > 0 ? (
      <div className="cg-provs">
        <div className="cg-links-hd">语言服务器</div>
        {provs.map((p) => (
          <div key={p.name} className={`cg-prov${p.status === 'ready' ? ' ok' : ''}`}>
            <span className="cg-prov-n">{p.name}</span>
            <span className="cg-prov-e">{p.extensions.slice(0, 4).join(' ')}</span>
            <span className={`cg-prov-s${p.status === 'ready' ? '' : ' miss'}`}>
              {p.status === 'ready' ? '就绪' : '未安装'}
            </span>
            {p.detail && <div className="cg-prov-d">{p.detail}</div>}
          </div>
        ))}
      </div>
    ) : null

  if (err) {
    return (
      <div className="cg-wrap">
        <div className="cg-body">
          <div className="cg-err">{err}</div>
          <button type="button" className="cg-btn" onClick={scan}>
            重新扫描
          </button>
          {/* 非 TS 项目会走到这儿：**文件结构与死代码清单目前只支持 TS**，
              但邻域查询靠语言服务器 —— 把它们的状态列出来，
              用户才知道「这个项目能做到哪一步」 */}
          <div className="cg-note" style={{ marginTop: 14 }}>
            文件结构与「没人用」清单目前只支持 TS/TSX；
            邻域查询（谁调用了这个）靠下面这些语言服务器。
          </div>
          {provList}
        </div>
      </div>
    )
  }
  if (!g) return <div className="cg-wrap cg-msg">{busy ? '正在解析符号…（首次要建 TS Program，约几秒）' : '准备中…'}</div>

  const dead = g.dead.filter((d) => d.verdict === 'dead')
  const unsure = g.dead.filter((d) => d.verdict === 'unsure')
  const opened = g.files.find((f) => f.file === openFile)

  return (
    <div className="cg-wrap">
      <div className="cg-bar">
        <span className="cg-stat"><b>{g.stats.files}</b> 文件</span>
        <span className="cg-stat"><b>{g.stats.symbols}</b> 符号</span>
        <span className="cg-stat"><b>{g.stats.refs}</b> 引用</span>
        <span className="cg-sep" />
        <span className={`cg-stat${dead.length ? ' bad' : ' ok'}`}><b>{dead.length}</b> 个没人用</span>
        {/* **判不准的单列一档，不混进上面那个数。**
            `checkJs:false` 的区域 TS 不检查，符号解析静默失效 ——
            实测那片贡献了 33% 的假阳性，混进去整张清单就不可信了。 */}
        {unsure.length > 0 && (
          <span className="cg-stat warn" title="这些文件在 checkJs:false 的区域，TypeScript 不检查它们，符号解析会静默失效 —— 判不出「没人用」是真的还是解析不到">
            {unsure.length} 个判不准
          </span>
        )}
        <span className="cg-spacer" />
        {g.untrusted > 0 && <span className="cg-stat dim">{g.untrusted} 个文件不可信</span>}
        <span className="cg-ms">{g.ms}ms</span>
        <button type="button" className="cg-btn icon" onClick={scan} disabled={busy} title="重新解析">
          <RefreshIcon size={12} />
        </button>
      </div>

      <div className="cg-body">
        {opened ? (
          <>
            <button type="button" className="cg-back" onClick={() => setOpenFile(null)}>
              ← 回到清单
            </button>
            <div className="cg-drill-hd">
              {opened.file} · {opened.symbols.length} 个符号 · {opened.edges.length} 条内部调用
              {opened.symbols.length > 30 && <span className="cg-note">（图上只画引用最多的 30 个）</span>}
              {!opened.trustworthy && <span className="cg-note">· 这个文件不进类型检查，解析结果仅供参考</span>}
            </div>
            <GraphCanvas
              items={structure.items}
              links={structure.links}
              groupOrder={['class', 'function', 'method', 'arrow', 'other']}
              onPick={(id) => {
                const s2 = opened.symbols.find((x) => x.id === id)
                if (s2) askNeighborhood(s2)
              }}
            />

            {/* ── 邻域：谁调用了这个 / 这个调用了谁 ────────────────────────
                **这是符号级最值钱的一个问句**：「我要改这个函数，谁会受影响？」
                现在只能靠全局搜索加人脑过滤，有了它是一次查询。 */}
            {nbBusy && <div className="cg-nb-msg">正在查邻域…</div>}
            {nbErr && <div className="cg-nb-msg cg-err">{nbErr}</div>}
            {nb && (
              <div className="cg-nb">
                <div className="cg-nb-hd">
                  <b>{nb.center.name}</b>
                  <span className="cg-note">
                    {nb.center.file.replace(/^src\//, '')}:{nb.center.line} · 由 {nb.provider} 解析
                    {nb.truncated && ' · 邻居太多，只列了前 30 个'}
                  </span>
                  <button type="button" className="cg-btn icon" onClick={() => setNb(null)} title="收起">
                    ✕
                  </button>
                </div>
                <div className="cg-nb-cols">
                  <div>
                    <div className="cg-nb-col-hd">谁调用了它（{nb.incoming.length}）</div>
                    {nb.incoming.length === 0 && <div className="cg-note">没有调用方</div>}
                    {nb.incoming.map((c) => (
                      <div key={c.symbol.id} className="cg-nb-item">
                        <span className="cg-nb-name">{c.symbol.name}</span>
                        <span className="cg-note">
                          {c.symbol.file.replace(/^src\//, '')} · {c.lines.length} 处
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="cg-nb-col-hd">它调用了谁（{nb.outgoing.length}）</div>
                    {nb.outgoing.length === 0 && <div className="cg-note">没有调用别人</div>}
                    {nb.outgoing.map((c) => (
                      <div key={c.symbol.id} className="cg-nb-item">
                        <span className="cg-nb-name">{c.symbol.name}</span>
                        <span className="cg-note">
                          {c.symbol.file.replace(/^src\//, '')} · {c.lines.length} 处
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="cg-files">
              {opened.symbols.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="cg-file as-btn"
                  onClick={() => askNeighborhood(s)}
                  title="看谁调用了它"
                >
                  <span className="cg-file-n" title={`${KIND_LABEL[s.kind]} · 第 ${s.line} 行`}>
                    <span style={{ color: KIND_COLOR[s.kind] }}>●</span> {s.name}
                    {s.exported && <span className="cg-note"> 导出</span>}
                  </span>
                  <span className="cg-deg">引用 {s.refs}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {dead.length > 0 && (
              <>
                <div className="cg-links-hd">没人用的（顶层声明，已排除接口实现与测试）</div>
                <div className="cg-links">
                  {dead.map((d) => (
                    <button
                      key={d.sym.id}
                      type="button"
                      className="cg-link as-btn"
                      onClick={() => setOpenFile(d.sym.file)}
                      title="看这个文件的结构"
                    >
                      <span className="cg-lf">{d.sym.file.replace(/^src\//, '')}</span>
                      <span className="cg-la">:</span>
                      <span className="cg-lt">{d.sym.name}</span>
                      <span className="cg-lc">{d.sym.exported ? '导出' : '内部'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {provList}
            <div className="cg-links-hd">符号最多的文件（点开看结构）</div>
            <div className="cg-terr">
              {g.files.slice(0, 24).map((f) => (
                <button
                  key={f.file}
                  type="button"
                  className="cg-tcard"
                  onClick={() => setOpenFile(f.file)}
                  style={
                    { ['--tint' as string]: f.trustworthy ? '255, 255, 255' : 'var(--sem-warn-rgb)' } as React.CSSProperties
                  }
                >
                  <div className="cg-tname">
                    {f.file.split('/').slice(-2).join('/')}
                    {!f.trustworthy && <span className="cg-trisk cg-dim">不可信</span>}
                  </div>
                  <div className="cg-tnum">{f.symbols.length} 个符号</div>
                  <div className="cg-tcross">内部调用 <b>{f.edges.length}</b></div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
