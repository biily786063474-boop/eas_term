// 验四个被恢复的模块「真的在算」，不是还停在返回空数组的桩上。
// 判据是**输出有实际内容**——桩返回 [] / null / false / no-op，真实现不会。
//
// parseSvgToPaths 不在这里测：它用 DOMParser（浏览器 API），node 里跑不了。
// 那条留给真机（工具栏的「导入 SVG」按钮），这里只测它同文件里的纯逻辑部分。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unite, intersect, shapeToPolygon, polygonToPathD } from './shapeBoolean.js'
import { isSvgFile } from './svgImport.js'
import { rectToPenNodes, ellipseToPenNodes, starToPenNodes } from './shapeToPen.js'
import { pathDToPenNodes } from './pathToPen.js'

const rect = (x, y, s) => ({ type: 'rect', x, y, width: s, height: s, rotation: 0 })

test('布尔运算：两个重叠矩形求并，面积大于任一个', () => {
  const polys = unite([rect(0, 0, 100), rect(50, 50, 100)])
  assert.ok(Array.isArray(polys) && polys.length > 0, 'unite 没算出多边形（桩会返回空）')
  const d = polygonToPathD(polys)
  assert.ok(typeof d === 'string' && d.length > 10, `路径串太短：${d}`)
  // 并集的外环顶点数要多于单个矩形的 4 个 —— L 形有 8 个
  assert.ok(polys[0][0].length > 4, `并集外环只有 ${polys[0][0].length} 个点，不像两矩形求并`)
})

test('布尔运算：不相交的两个矩形求交，结果为空', () => {
  assert.equal(intersect([rect(0, 0, 10), rect(500, 500, 10)]).length, 0)
})

test('shapeToPolygon 认得矩形', () => {
  const p = shapeToPolygon(rect(0, 0, 10))
  assert.ok(p && p.length > 0, '桩会返回 null')
})

test('形状转钢笔节点：矩形 4 角 + 闭合回起点', () => {
  const r = rectToPenNodes({ x: 0, y: 0, width: 10, height: 10 })
  assert.equal(r.penNodes.length, 5, '4 个角 + 闭合点')
  assert.equal(r.closed, true)
  assert.ok(ellipseToPenNodes({ x: 0, y: 0, radiusX: 5, radiusY: 5 }).penNodes.length > 0)
  assert.ok(starToPenNodes({ numPoints: 5, innerRadius: 4, outerRadius: 9 }).penNodes.length > 0)
})

test('路径转钢笔节点：M/L/Z 的 d 串能解析（走 svgpath）', () => {
  const nodes = pathDToPenNodes('M10 10 L90 10 L90 90 Z')
  assert.ok(nodes.penNodes?.length >= 3 || nodes.length >= 3, `解析结果为空：${JSON.stringify(nodes)}`)
})

test('isSvgFile 认扩展名与 MIME', () => {
  assert.equal(isSvgFile({ name: 'a.svg', type: 'image/svg+xml' }), true, '桩恒为 false')
  assert.equal(isSvgFile({ name: 'a.png', type: 'image/png' }), false)
})
