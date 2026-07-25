// [Eas-Term 移植] 砍掉「SVG 导入」高级功能 —— 原文件把 SVG 解析成 path 对象。
// 本步不移植,保留同名导出为 no-op,避免 Toolbar 悬空 import。
// 相关 UI 入口(工具栏 SVG 导入按钮)已在移植时去掉。
export function isSvgFile(_file) { return false }
export function parseSvgToPaths(_text, _placement) { return [] }
export async function importSvgFile(_file, _ctx) { return null }
