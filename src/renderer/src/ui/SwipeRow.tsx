// 可左滑移除的列表行。行本体照常渲染，底下垫一层「移除」，滑开才露出来。
//
// 为什么单独抽一层而不是让两个列表各写各的：手感参数（阈值、曲线、露出多少才变红）
// 一旦分叉，两边就会慢慢变成两种手感——用户不会觉得「这是两个列表」，
// 只会觉得「这软件有时候好使有时候不好使」。
import { useSwipeRemove } from './useSwipeRemove'
import { TrashIcon } from './Icons'

export function SwipeRow({
  onRemove,
  pointer = false,
  disabled = false,
  className = '',
  children,
  ...rest
}: {
  onRemove: () => void
  /** 允许鼠标左键左拖。左键已被别的手势占用的地方传 false */
  pointer?: boolean
  disabled?: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onDragStart'>): JSX.Element {
  const sw = useSwipeRemove<HTMLDivElement>(onRemove, { pointer, disabled })

  return (
    <div className={`swipe-row${sw.phase === 'gone' ? ' gone' : ''}`} ref={sw.ref}>
      {/* 红区只占「滑开露出的那一条」，宽度跟着位移走。
          不铺满整行是因为：铺满的话行本体就必须有不透明背景才能盖住它，
          而这两个列表一个在玻璃抽屉里、一个在侧栏，找不到一个都对的底色。
          只占露出的部分，两层永远不重叠，谁的底色都不用动。 */}
      <div
        className={`swipe-row-bg${sw.progress >= 1 ? ' armed' : ''}`}
        style={{
          width: Math.abs(sw.dx),
          transition: sw.phase === 'drag' ? 'none' : 'width 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      >
        {/* 内边距必须放在内层：border-box 下外层 width:0 也压不掉自己的 padding，
            静止时会在每一行右缘留一条 10px 的红边 */}
        <span className="swipe-row-bg-in">
          <TrashIcon size={12} />
          <span>{sw.progress >= 1 ? '松手移除' : '移除'}</span>
        </span>
      </div>
      <div
        className={`swipe-row-fg ${className}`}
        style={{
          transform: `translateX(${sw.dx}px)`,
          // 跟手阶段不能有过渡，否则手指和内容之间会糊一层延迟
          transition:
            sw.phase === 'drag'
              ? 'none'
              : sw.phase === 'gone'
                ? 'transform 0.24s cubic-bezier(0.4, 0, 1, 1), opacity 0.24s ease'
                : 'transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)',
          opacity: sw.phase === 'gone' ? 0 : 1
        }}
        onMouseDownCapture={sw.onMouseDown}
        {...rest}
      >
        {children}
      </div>
    </div>
  )
}
