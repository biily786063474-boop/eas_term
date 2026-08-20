/**
 * UnifiedComposer ErrorBoundary
 *
 * 防 UnifiedComposer / 子组件 mount throw 导致整个 React tree 白屏。
 * 接到错误时显示一个可恢复的浮层,让用户能关闭 modal 回到外部画板。
 */
import React from 'react'

export default class UCErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[UnifiedComposer:ErrorBoundary]', error, info)
    this.setState({ info })
  }

  reset = () => {
    this.setState({ hasError: false, error: null, info: null })
  }

  closeAndReset = () => {
    this.props.onClose?.()
    this.reset()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        style={{
          position: 'fixed', top: 32, left: 0, right: 0, bottom: 0,
          zIndex: 200,
          background: 'var(--bg-app)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          color: 'var(--text-1)',
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 700 }}>统一画板出错了</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center', maxWidth: 480 }}>
          {String(this.state.error?.message || this.state.error || '未知错误')}
        </div>
        {this.state.info?.componentStack && (
          <details style={{ maxWidth: 640, fontSize: 11, color: 'var(--text-3)' }}>
            <summary style={{ cursor: 'pointer' }}>组件堆栈</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', padding: 8, background: 'var(--bg-hover)', borderRadius: 4 }}>
              {this.state.info.componentStack}
            </pre>
          </details>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={this.reset}
            style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-hover)', color: 'var(--text-1)', cursor: 'pointer',
            }}
          >重试</button>
          <button
            onClick={this.closeAndReset}
            style={{
              padding: '8px 16px', borderRadius: 6, border: 0,
              background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer',
            }}
          >关闭返回画板</button>
        </div>
      </div>
    )
  }
}
