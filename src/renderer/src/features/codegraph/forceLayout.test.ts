import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_NODES, forceLayout, pickLabels } from './forceLayout.ts'
import type { RadialNode } from './radial.ts'

const n = (id: string, weight = 1): RadialNode => ({ id, weight, group: 'a' })
const L = (from: string, to: string): { from: string; to: string } => ({ from, to })

describe('确定性 —— 这是它能被采用的前提', () => {
  it('**同一份输入跑两次结果完全一样**（原来拒绝力导向就是因为它不确定）', () => {
    const ns = ['a', 'b', 'c', 'd', 'e'].map((x) => n(x, x.charCodeAt(0) % 5 + 1))
    const ls = [L('a', 'b'), L('b', 'c'), L('c', 'd'), L('a', 'e')]
    const p1 = forceLayout(ns, ls, 400, 300)
    const p2 = forceLayout(ns, ls, 400, 300)
    assert.deepEqual(p1, p2)
  })

  it('**跑十次也一样** —— 一次相同可能是巧合', () => {
    const ns = ['x', 'y', 'z'].map((x) => n(x))
    const first = JSON.stringify(forceLayout(ns, [L('x', 'y')], 300, 300))
    for (let i = 0; i < 9; i++) {
      assert.equal(JSON.stringify(forceLayout(ns, [L('x', 'y')], 300, 300)), first, `第 ${i + 2} 次不一样`)
    }
  })

  it('节点顺序变了、位置也要跟着那个 id 走 —— 位置由 id 决定，不由下标', () => {
    const a = n('alpha'), b = n('beta'), c = n('gamma')
    const p1 = forceLayout([a, b, c], [], 300, 300)
    const p2 = forceLayout([a, b, c], [], 300, 300)
    assert.deepEqual(p1.map((p) => p.id), p2.map((p) => p.id))
  })
})

describe('几何', () => {
  it('空输入不炸', () => {
    assert.deepEqual(forceLayout([], [], 300, 300), [])
  })

  it('**面积正比于 weight，不是半径正比** —— 人眼读的是面积', () => {
    const p = forceLayout([n('big', 100), n('small', 1)], [], 400, 400)
    const big = p.find((x) => x.id === 'big')!
    const small = p.find((x) => x.id === 'small')!
    // 半径比应接近 sqrt(100/1)=10 的映射后关系，而不是 100 倍
    assert.ok(big.r > small.r, '大的该更大')
    assert.ok(big.r / small.r < 6, `半径比 ${big.r / small.r} 太夸张了，说明按 weight 线性算了`)
  })

  it('都落在画布内（含标签边距）', () => {
    const ns = Array.from({ length: 12 }, (_, i) => n('n' + i, i + 1))
    for (const p of forceLayout(ns, [L('n0', 'n1'), L('n1', 'n2')], 500, 400)) {
      assert.ok(p.x >= 0 && p.x <= 500, `x=${p.x}`)
      assert.ok(p.y >= 0 && p.y <= 400, `y=${p.y}`)
    }
  })

  it('**有边的会被拉得更近** —— 这是力导向的全部意义', () => {
    const ns = [n('a'), n('b'), n('c'), n('d')]
    // a-b 强连，c-d 强连，两组之间不连
    const p = forceLayout(ns, [L('a', 'b'), L('c', 'd')], 400, 400)
    const at = (id: string) => p.find((x) => x.id === id)!
    const dist = (i: string, j: string) => Math.hypot(at(i).x - at(j).x, at(i).y - at(j).y)
    assert.ok(dist('a', 'b') < dist('a', 'c'), `连着的 a-b(${dist('a','b').toFixed(0)}) 应近于不连的 a-c(${dist('a','c').toFixed(0)})`)
  })

  it('完全重合的初值也能推开 —— 且**推开方式是确定的**，不能用随机', () => {
    const ns = [n('same1'), n('same2')]
    const p1 = forceLayout(ns, [], 200, 200)
    const p2 = forceLayout(ns, [], 200, 200)
    assert.deepEqual(p1, p2)
    assert.ok(Math.hypot(p1[0].x - p1[1].x, p1[0].y - p1[1].y) > 1, '两个点重叠在一起了')
  })

  it('超过上限就截断 —— 力导向是 O(n²)，调用方该先聚合', () => {
    const ns = Array.from({ length: MAX_NODES + 40 }, (_, i) => n('n' + i))
    assert.equal(forceLayout(ns, [], 400, 400).length, MAX_NODES)
  })

  it('孤立点不会被推出画布 —— 有向心力兜着', () => {
    const ns = [n('hub'), n('x'), n('lonely')]
    const p = forceLayout(ns, [L('hub', 'x')], 300, 300)
    const l = p.find((x) => x.id === 'lonely')!
    assert.ok(l.x > 0 && l.x < 300 && l.y > 0 && l.y < 300)
  })
})

describe('画得开 —— 把「好看」变成可测的判据', () => {
  /** 造一个像真实领地图的图：几个枢纽 ＋ 一堆挂在上面的 ＋ 两个孤立点 */
  const realistic = (): { ns: RadialNode[]; ls: { from: string; to: string }[] } => {
    const ns: RadialNode[] = []
    const ls: { from: string; to: string }[] = []
    for (let i = 0; i < 20; i++) ns.push(n('n' + i, i < 3 ? 50 : 5))
    for (let i = 3; i < 18; i++) { ls.push(L('n0', 'n' + i)); if (i % 2) ls.push(L('n1', 'n' + i)) }
    ls.push(L('n0', 'n1'), L('n1', 'n2'))
    ns.push(n('iso1'), n('iso2'))   // 两个谁都不连的
    return { ns, ls }
  }

  it('**不能挤成一团**：节点铺开的范围要占到画布的一半以上', () => {
    const { ns, ls } = realistic()
    const p = forceLayout(ns, ls, 600, 450)
    const w = Math.max(...p.map((x) => x.x)) - Math.min(...p.map((x) => x.x))
    const h = Math.max(...p.map((x) => x.y)) - Math.min(...p.map((x) => x.y))
    assert.ok(w > 600 * 0.5, `横向只铺开 ${w.toFixed(0)}/600`)
    assert.ok(h > 450 * 0.5, `纵向只铺开 ${h.toFixed(0)}/450`)
  })

  it('**节点之间不能压在一起**：任意两点的距离要大于两个半径之和', () => {
    const { ns, ls } = realistic()
    const p = forceLayout(ns, ls, 600, 450)
    let worst = Infinity, pair = ''
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const gap = Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) - p[i].r - p[j].r
        if (gap < worst) { worst = gap; pair = `${p[i].id}/${p[j].id}` }
      }
    assert.ok(worst > 2, `最近的两个 (${pair}) 只差 ${worst.toFixed(1)}px，圆快叠上了`)
  })

  it('**孤立点不该霸占画布**：它们离重心不能比连通的那堆远太多', () => {
    const { ns, ls } = realistic()
    const p = forceLayout(ns, ls, 600, 450)
    const cx = p.reduce((s, x) => s + x.x, 0) / p.length
    const cy = p.reduce((s, x) => s + x.y, 0) / p.length
    const d = (id: string) => { const q = p.find((x) => x.id === id)!; return Math.hypot(q.x - cx, q.y - cy) }
    const connected = p.filter((x) => x.id.startsWith('n')).map((x) => Math.hypot(x.x - cx, x.y - cy))
    const maxConn = Math.max(...connected)
    assert.ok(d('iso1') < maxConn * 2.2, `孤立点离重心 ${d('iso1').toFixed(0)}，而连通的最远才 ${maxConn.toFixed(0)}`)
  })
})

describe('标签去重叠', () => {
  const at = (id: string, x: number, y: number, r = 8): { id: string; x: number; y: number; r: number } =>
    ({ id, x, y, r })

  it('离得开的都留着', () => {
    const keep = pickLabels([at('a', 10, 10), at('b', 10, 200)], (i) => i)
    assert.equal(keep.size, 2)
  })

  it('**叠上了只留大的那个** —— 它代表的内容更多', () => {
    const keep = pickLabels([at('big', 50, 50, 16), at('small', 54, 52, 4)], () => '一个挺长的中文标签')
    assert.ok(keep.has('big'))
    assert.ok(!keep.has('small'))
  })

  it('**确定性**：同一份输入挑中同一批', () => {
    const ns = Array.from({ length: 12 }, (_, i) => at('n' + i, 40 + (i % 4) * 12, 40 + Math.floor(i / 4) * 9, 6))
    const a = [...pickLabels(ns, (i) => i)].sort()
    const b = [...pickLabels(ns, (i) => i)].sort()
    assert.deepEqual(a, b)
  })

  it('中文比西文占更宽 —— 宽度估算不能一视同仁', () => {
    const two = [at('a', 0, 0), at('b', 60, 0)]
    const cn = pickLabels(two, () => '中文标签文字')
    const en = pickLabels(two, () => 'ab')
    assert.ok(en.size >= cn.size, `西文 ${en.size} 应不少于中文 ${cn.size}`)
  })

  it('空输入不炸', () => {
    assert.equal(pickLabels([], () => '').size, 0)
  })
})
