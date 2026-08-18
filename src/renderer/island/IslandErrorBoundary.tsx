// 灵动岛专用的最小错误边界。
//
// 不能直接搬主窗口那份 renderer/src/ui/ErrorBoundary.tsx——那份 fallback 里的
// "重置画布并重载"按钮调用 window.api.canvas.save，而灵动岛的 preload 只暴露了
// window.island 这一个全局（见 preload/island.ts 的注释：权限越少越好），没有 window.api，
// 真按下去是另一次崩溃，不是恢复。这里单独写一份，只做"兜底显示 + 告诉用户怎么找回来"。
//
// 样式全部内联、不吃 island.css 的任何 class——这个边界要防的正是"渲染层出了未捕获异常"，
// 如果连它自己都要依赖外部样式表才能显示，样式表恰好也出问题的那种复合故障就会两手空空。
import { Component, ReactNode, createRef } from 'react'

import { briefError } from './islandBrief'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

const FALLBACK_STYLE: React.CSSProperties = {
  boxSizing: 'border-box',
  padding: '8px 14px',
  borderRadius: '0 0 10px 10px',
  background: '#000',
  color: '#fda4af',
  font: '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  whiteSpace: 'nowrap'
}
/** 错误摘要那行：比主文案暗一档、小一号，长了截断。 */
const DETAIL_STYLE: React.CSSProperties = {
  marginTop: 3,
  color: '#9ca3af',
  fontSize: 10.5,
  maxWidth: 420,
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}


export class IslandErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  private ref = createRef<HTMLDivElement>()

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // 这条 console.error 会被主进程新加的 console-message 监听转发到日志——
    // 是"渲染层出错了但主进程完全不知道"这条链路上补的最后一环。
    console.error('[island:ErrorBoundary]', error, info.componentStack)
  }

  // 正常渲染的 <Island/> 自己会用 ResizeObserver 上报尺寸；一旦整棵树被这个边界换掉，
  // 那套上报也跟着没了。窗口尺寸是主进程按上一次上报的内容摆的，不补报的话兜底文字
  // 大概率被裁在一个更小的旧窗口里，等于白写。componentDidMount 覆盖首次进入错误态，
  // componentDidUpdate 覆盖后续变化（目前用不到，但比"以后加了内容却忘记这条"更省心）。
  componentDidMount(): void {
    this.reportSize()
  }

  componentDidUpdate(): void {
    this.reportSize()
  }

  private reportSize(): void {
    const el = this.ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    window.island.reportSize(Math.ceil(r.width), Math.ceil(r.height))
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      // **必须把错误本身显示出来。** 原来只有一句「出错了」—— 用户看到的和
      // 什么都没看到一样（他的原话是「我又报错了，我看不到错误」）。
      // 岛的致命错误会落 <userData>/island-error.log，但那要人知道去哪找；
      // 摘要摆在眼前，至少能直接告诉别人「它说的是 TypeError xxx」。
      <div ref={this.ref} style={FALLBACK_STYLE}>
        <div>灵动岛出错了，右键 Dock 图标可重新打开</div>
        <div style={DETAIL_STYLE}>{briefError(this.state.error)}</div>
      </div>
    )
  }
}
