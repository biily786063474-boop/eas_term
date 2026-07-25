// [Eas-Term 移植] 砍掉「形状转钢笔节点」高级功能 —— 纯几何,无 npm 依赖,但只服务钢笔编辑。
// 本步不移植,保留同名导出为 no-op,避免 KonvaCanvas 悬空 import。
export const KAPPA = 0.5522847498307933
export function ellipseToPenNodes(_obj) { return [] }
export function rectToPenNodes(_obj) { return [] }
export function polygonToPenNodes(_obj) { return [] }
export function starToPenNodes(_obj) { return [] }
