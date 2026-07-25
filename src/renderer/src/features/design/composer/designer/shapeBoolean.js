// [Eas-Term 移植] 砍掉「布尔运算(并集/交集/差集/异或)」高级功能 ——
// 原文件依赖 npm 包 `polygon-clipping`。本步不移植,保留同名导出为 no-op:
//  - BOOLEAN_SUPPORTED_TYPES 为空 Set → DesignerView.applyBoolean 永远判定"无支持形状"提前返回
//  - unite/intersect/subtract/exclude 返回 null → 即使被调用也无副作用
// 相关 UI 入口(选中工具条的布尔按钮)已在移植时去掉。
export const BOOLEAN_SUPPORTED_TYPES = new Set()
export function shapeToPolygon(_obj) { return null }
export function polygonToPathD(_multiPoly) { return '' }
export function unite(_shapes) { return null }
export function intersect(_shapes) { return null }
export function subtract(_bottom, _others) { return null }
export function exclude(_shapes) { return null }
export function multiPolyBBox(_multiPoly) { return { x: 0, y: 0, width: 0, height: 0 } }
