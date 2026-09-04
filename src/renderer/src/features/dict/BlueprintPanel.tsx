// 原型图预设：一张页面由哪些区块按什么顺序组成。
//
// ── 它是词典里的第四种东西 ──────────────────────────────────────────────
// 分类树答「这条词条是什么」，区块标签答「它能用在哪」，
// 蓝图答的是**「一张页面由什么拼起来」** —— 这是组合关系，不是归属关系。
//
// ── 为什么蓝图里不写词条 id ─────────────────────────────────────────────
// 写了就得维护：词库还在长，每加一条动效都要回头想「哪几张蓝图该加上它」，
// 那是必然会烂掉的活。蓝图只声明区块顺序，词条按标签**实时匹配**，
// 于是加词条零维护。代价：某个区块标签打错会在所有蓝图里同时错 ——
// 所以打标质量比蓝图本身更要紧（见 `docs/词典区块打标-脚本.mjs`）。
//
// ── 刻意不做的：真实渲染的原型图 ────────────────────────────────────────
// 需求原话是「主要是去展现页面的关系」。竖排方块 ＋ 顺序 ＋ 一句说明就够了。
// 画成像素级的原型图是另一个量级的活，而且会立刻和真实产品脱节。

import type { JSX } from 'react'

interface Slot {
  block: string
  note: string
}
interface Blueprint {
  id: string
  name: string
  platform: string
  intent: string
  slots: Slot[]
}
interface Term {
  id: string
  zh: string
  blocks?: string[]
}

interface Props<T extends Term> {
  blueprints: Blueprint[]
  terms: T[]
  bpId: string | null
  setBpId: (v: string | null) => void
  openSlot: string | null
  setOpenSlot: (v: string | null) => void
  onHover: (term: T, anchor: DOMRect) => void
  onLeave: () => void
  onPick: (term: T) => void
}

export function BlueprintPanel<T extends Term>({
  blueprints,
  terms,
  bpId,
  setBpId,
  openSlot,
  setOpenSlot,
  onHover,
  onLeave,
  onPick
}: Props<T>): JSX.Element {
  const cur = blueprints.find((b) => b.id === bpId) ?? null

  // ── 选蓝图 ────────────────────────────────────────────────────────────
  if (!cur) {
    return (
      <div className="bp-pick" onMouseLeave={onLeave}>
        {['移动', '桌面'].map((plat) => (
          <div key={plat} className="bp-group">
            {/* 端在这里是**分组**不是筛子 —— 一共才 10 张，摆开比先选端再选页快 */}
            <div className="bp-group-t">{plat}端</div>
            {blueprints
              .filter((b) => b.platform === plat)
              .map((b) => (
                <button
                  key={b.id}
                  className="bp-card"
                  onClick={() => {
                    setBpId(b.id)
                    setOpenSlot(null)
                  }}
                >
                  <span className="bp-card-n">{b.name}</span>
                  <span className="bp-card-i">{b.intent}</span>
                  <span className="bp-card-s">{b.slots.length} 块</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    )
  }

  // ── 看一张蓝图 ────────────────────────────────────────────────────────
  return (
    <div className="bp-view" onMouseLeave={onLeave}>
      <div className="bp-head">
        <button className="bp-back" onClick={() => setBpId(null)}>
          ← 全部预设
        </button>
        <span className="bp-head-n">{cur.name}</span>
        <span className="bp-head-p">{cur.platform}端</span>
      </div>
      <div className="bp-intent">{cur.intent}</div>

      {/* 竖排的区块 = 页面从上到下的顺序。**这就是「页面的关系」那句话的落点** */}
      <div className="bp-stack">
        {cur.slots.map((s, i) => {
          const hits = terms.filter((t) => t.blocks?.includes(s.block))
          const open = openSlot === s.block
          return (
            <div key={s.block} className={`bp-slot${open ? ' open' : ''}`}>
              <button
                className="bp-slot-hd"
                aria-expanded={open}
                onClick={() => setOpenSlot(open ? null : s.block)}
              >
                <span className="bp-slot-i">{i + 1}</span>
                <span className="bp-slot-b">{s.block}</span>
                <span className="bp-slot-note">{s.note}</span>
                <span className="bp-slot-n">{hits.length}</span>
              </button>
              {/* 一次只展开一个：全展开的话又变回一张长列表，
                  而蓝图的意义正是「先看结构，要哪块再看哪块」 */}
              {open && (
                <div className="bp-slot-body">
                  {hits.map((t) => (
                    <button
                      key={t.id}
                      className="dict-pill"
                      onMouseEnter={(e) => onHover(t, e.currentTarget.getBoundingClientRect())}
                      onClick={() => onPick(t)}
                    >
                      <span className="dict-pill-zh">{t.zh}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
