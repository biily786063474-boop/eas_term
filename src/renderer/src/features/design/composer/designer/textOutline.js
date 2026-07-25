// [Eas-Term 移植] 砍掉「文字转轮廓(text → SVG path)」高级功能 ——
// 原文件依赖 npm 包 `imagetracerjs`。本步不移植,保留同名导出为 no-op:
// store.outlineText() 拿到空数组会提前返回(不替换文字),即整个动作变成安全空操作。
// 相关 UI 入口(属性面板 / 右键菜单的"转为轮廓")已在移植时去掉。
export function textObjectToPaths(_textObj) { return [] }
