// [Eas-Term 移植] 砍掉「钢笔/路径」高级功能 —— 原文件依赖 npm 包 `svgpath`。
// 本步不移植钢笔编辑,保留同名导出为 no-op,避免调用方(DesignerView / KonvaCanvas)
// 出现悬空 import。相关 UI 入口(钢笔工具、锚点编辑)已在移植时去掉。
export function pathDToPenNodes(_d) {
  return []
}
