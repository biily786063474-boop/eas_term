import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { xtermTheme } from '../themes'

interface Props {
  tabId: string
  leafId: string
  ptyId: string
  isActive: boolean
}

export function TerminalView({ tabId, leafId, ptyId, isActive }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = containerRef.current!
    const term = new Terminal({
      theme: xtermTheme(useStore.getState().theme),
      // 跨平台等宽字体回退：mac 用 SF Mono，Windows 用 Cascadia Code/Consolas
      fontFamily:
        '"SF Mono", Menlo, Monaco, "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      allowProposedApi: true,
      allowTransparency: true
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 仅在按住 ⌘（mac）/ Ctrl（其他平台）时点击才打开链接，避免误触
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.metaKey || event.ctrlKey) window.api.shell.openExternal(uri)
      })
    )
    term.open(el)
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // WebGL 不可用时回退到 DOM 渲染
    }

    const doFit = (): void => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        try {
          fit.fit()
        } catch {
          // 容器尺寸异常时跳过
        }
      }
    }
    doFit()
    window.api.pty.resize(ptyId, term.cols, term.rows)

    const store = useStore.getState()
    const unsubData = window.api.pty.onData(ptyId, (data) => term.write(data))
    const unsubExit = window.api.pty.onExit(ptyId, () => {
      // 带 ptyId 校验：面板若已被切换成其他功能则忽略这次退出
      useStore.getState().closeLeaf(tabId, leafId, { alreadyExited: true, ptyId })
    })
    const dataDisp = term.onData((data) => window.api.pty.write(ptyId, data))
    const resizeDisp = term.onResize(({ cols, rows }) => window.api.pty.resize(ptyId, cols, rows))
    const titleDisp = term.onTitleChange((title) => store.setTabTitle(tabId, title))

    // 点击/聚焦该终端时标记为活动面板
    const onFocus = (): void => useStore.getState().setActiveLeaf(tabId, leafId)
    el.addEventListener('focusin', onFocus)

    const ro = new ResizeObserver(() => doFit())
    ro.observe(el)

    term.focus()

    return () => {
      ro.disconnect()
      el.removeEventListener('focusin', onFocus)
      unsubData()
      unsubExit()
      dataDisp.dispose()
      resizeDisp.dispose()
      titleDisp.dispose()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isActive) termRef.current?.focus()
  }, [isActive])

  // 主题切换时同步更新已存在的终端配色
  const theme = useStore((s) => s.theme)
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(theme)
  }, [theme])

  return <div ref={containerRef} className="terminal-host" />
}
