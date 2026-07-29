// 标题栏上「把词典悬浮球放回来」的按钮。
//
// 只在**藏起来之后**出现，不是常驻开关：没藏的时候摆一个「显示词典」按钮，
// 用户看着会以为词典还有别的入口，其实球就在画布上戳着。
// 藏了才出现，它就只有一个意思——你刚才藏的东西在这儿。
import { useStore } from '../../store'
import { DictIcon } from '../../ui/Icons'

export function DictBubbleToggle(): JSX.Element | null {
  const hidden = useStore((s) => s.dictBubbleHidden)
  const setHidden = useStore((s) => s.setDictBubbleHidden)
  const viewMode = useStore((s) => s.viewMode)

  // 球本来就只活在画布模式，终端模式下摆这个按钮点了也没反应
  if (!hidden || viewMode !== 'canvas') return null

  return (
    <button
      className="dictback-btn"
      data-tip="把名词词典悬浮球放回画布"
      onClick={() => setHidden(false)}
    >
      <DictIcon size={13} />
    </button>
  )
}
