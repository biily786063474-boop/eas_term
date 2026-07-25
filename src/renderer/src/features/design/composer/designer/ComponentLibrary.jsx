// [Eas-Term 移植] 砍掉「组件库」高级功能 —— 原组件依赖 taptv 专有的
// `utils/designComponentStorage`(用户设计组件的本地存储 + 内置组件种子)。
// 本步不移植组件库,渲染空占位;DesignerView 里的"组件库"面板 tab 也已去掉,
// 正常情况下不会挂载本组件。保留默认导出避免悬空 import。
export default function ComponentLibrary() {
  return null
}
