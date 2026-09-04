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
import { RefreshIcon } from '../../ui/Icons'
import { GraphCanvas, type GraphItem, type GraphLink } from './GraphCanvas.tsx'

/** 符号种类 → 颜色。和模块级那套风险色**刻意不同** ——
 *  这里表达的是「它是什么」，不是「它有多危险」，共用一套色会让人读串。 */
const KIND_COLOR: Record<SymbolNode['kind'], string> = {
  function: '#7dd3fc',
  method: '#c4b5fd',
  class: '#fcd34d',
  arrow: '#6ee7b7',
  other: '#737373'
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
    alive.current = true
    scan()
    return () => {
      alive.current = false
    }
  }, [root])

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
            />
            <div className="cg-files">
              {opened.symbols.map((s) => (
                <div key={s.id} className="cg-file">
                  <span className="cg-file-n" title={`${KIND_LABEL[s.kind]} · 第 ${s.line} 行`}>
                    <span style={{ color: KIND_COLOR[s.kind] }}>●</span> {s.name}
                    {s.exported && <span className="cg-note"> 导出</span>}
                  </span>
                  <span className="cg-deg">引用 {s.refs}</span>
                </div>
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
            <div className="cg-links-hd">符号最多的文件（点开看结构）</div>
            <div className="cg-terr">
              {g.files.slice(0, 24).map((f) => (
                <button
                  key={f.file}
                  type="button"
                  className="cg-tcard"
                  onClick={() => setOpenFile(f.file)}
                  style={{ borderLeftColor: f.trustworthy ? '#7dd3fc' : '#525252' }}
                >
                  <div className="cg-tname">
                    {f.file.split('/').slice(-2).join('/')}
                    {!f.trustworthy && <span className="cg-trisk" style={{ color: '#737373' }}>不可信</span>}
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
