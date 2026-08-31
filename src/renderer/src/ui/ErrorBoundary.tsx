// 渲染层错误边界:拦截渲染期未捕获异常,避免 React 把整棵树卸载成永久白屏(白屏根因头号放大器)。
// fallback 提供两个逃生入口:重新加载;若疑似坏画布存档导致启动即崩,「重置画布并重载」清空 canvas.json 再开。

import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 边界标识(区分根级 / 画布级,用于日志) */
  label?: string
  /** 自定义兜底 UI——不传就用下面默认的"重新加载/重置画布"这套(根级用)。
   *  reset 只清本地 error state 让 children 重新挂载,不做 location.reload():
   *  是否需要更重的恢复手段(比如先清一遍数据)由调用方自己在 fallback 里决定。
   *  (甘特图边界用这个:崩溃不该连累整个渲染进程重启,终端还挂在 PaneLayer 上,
   *  没有理由跟着陪葬。) */
  fallback?: (error: Error, reset: () => void) => ReactNode
}
interface State {
  error: Error | null
}

// 空画布存档(结构对齐 serializeCanvas 落盘格式:viewMode/viewport/frames/shapes/freeNodes/todos)
const EMPTY_CANVAS = {
  viewMode: 'split',
  viewport: { x: 0, y: 0, scale: 1 },
  frames: [],
  shapes: [],
  freeNodes: [],
  todos: []
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.label ? ':' + this.props.label : ''}]`,
      error,
      info.componentStack
    )
  }

  private reload = (): void => location.reload()

  private reset = (): void => this.setState({ error: null })

  private resetCanvas = async (): Promise<void> => {
    try {
      await window.api.canvas.save(EMPTY_CANVAS)
    } catch {
      // 存不了也照样重载
    }
    location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="err-boundary">
        <div className="err-card">
          <div className="err-title">界面遇到了一个错误</div>
          <div className="err-desc">
            渲染时发生未处理异常,已被拦截,避免整个窗口变空白。<b>先试「重新加载」</b> ——
            大多数情况这样就好了。只有反复在启动时出错、多半是画布存档损坏时,才用
            「重置画布并重载」:它会清空画布(项目文件不受影响),清空前会把当前布局
            备份到 canvas.json.bak-* ,想找回来能从那里恢复。
          </div>
          <pre className="err-msg">{error.message || String(error)}</pre>
          <div className="err-btns">
            <button className="err-btn primary" onClick={this.reload}>
              重新加载
            </button>
            <button className="err-btn" onClick={this.resetCanvas}>
              重置画布并重载
            </button>
          </div>
        </div>
      </div>
    )
  }
}
