// 标题栏上的辞典开关。
//
// ── 2026-08-31：从「把悬浮球放回来」改成「开合辞典面板」 ──────────────
// 原来画布上常驻一个可拖动的小圆钮，这个按钮只在球被藏起来之后才出现，
// 意思是「你刚才藏的东西在这儿」。
//
// 现在球取消了 —— 它一直压在画布上，而辞典是「随手查一下」的工具，
// 不该常驻占位。这个按钮于是变成**常驻的开关**：点一下叫出面板，
// 点辞典以外任何地方（含再点它一次）收回。
//
// `data-dict-toggle` 那个标记是给面板的「点外面收起」用的 ——
// 不放过这个按钮的话，点它会先被收起、再被这里切换成开，一次点击等于没反应。
import { useStore } from '../../store'

export function DictBubbleToggle(): JSX.Element | null {
  const open = useStore((s) => s.dictOpen)
  const setOpen = useStore((s) => s.setDictOpen)
  const viewMode = useStore((s) => s.viewMode)

  // 面板只活在画布模式（分屏/看板下辞典有自己的独立视图），
  // 终端模式下摆这个按钮点了也没反应
  if (viewMode !== 'canvas') return null

  return (
    <button
      className={`tb-item${open ? ' on' : ''}`}
      data-dict-toggle=""
      data-tip={open ? '收起辞典' : '辞典'}
      onClick={() => setOpen(!open)}
    >
      辞典
    </button>
  )
}
