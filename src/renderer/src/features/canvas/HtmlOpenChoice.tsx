// 用户手动把 .html 放进画布时，问一句：看渲染出来的页面，还是看源码。
//
// 为什么必须问：.html 是唯一一种「两种看法都合理」的文件。改样式的时候想看渲染，
// 改结构的时候想看源码 —— 替用户定死一种，另一种就得先关掉节点再换个方式重开。
//
// 为什么用这个小浮层而不是模态确认框：这是拖放手势的收尾，弹一个居中的模态
// 会把注意力从落点拽走，而且模态只有「确定/取消」两个位置，装不下两个平级的选择。
// 复用 CanvasContextMenu：它本来就是「在某个坐标弹一组选项」，
// 连 Esc 关闭、点外面关闭、超出视口自动翻边都是现成的。
import { CanvasContextMenu } from '../../ui/CanvasContextMenu'

export function HtmlOpenChoice({
  x,
  y,
  fileName,
  onPick,
  onClose
}: {
  x: number
  y: number
  /** 只用来在菜单里显示是哪个文件——同时拖好几个时不至于认错 */
  fileName: string
  onPick: (as: 'web' | 'code') => void
  onClose: () => void
}): JSX.Element {
  return (
    <CanvasContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        // 用 disabled 项当标题：sep 只画线、会把 label 丢掉，
        // 而同时拖好几个文件时不写清是哪个就容易点错
        { label: fileName, disabled: true, onClick: () => {} },
        { label: '', sep: true, onClick: () => {} },
        {
          label: '预览网页',
          hint: '渲染出来',
          onClick: () => onPick('web')
        },
        {
          label: '预览代码',
          hint: '看源码',
          onClick: () => onPick('code')
        }
      ]}
    />
  )
}
