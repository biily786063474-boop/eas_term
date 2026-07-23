import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Terminal, type ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../../store'
import { xtermTheme } from '../../themes'
import {
  routeOpen,
  extractPathCandidates,
  relativeToProject,
  cdInTerminal,
  dirnameOf,
  type HoveredPath
} from './pathLinks'
import './terminal.css'

interface TermMenu {
  x: number
  y: number
  // 右键时鼠标恰好悬停命中的文件/目录路径（没命中则 null，仍弹通用文本菜单）
  target: HoveredPath | null
  // 右键时终端里是否有选中的文字（决定「复制」是否可用）
  hasSelection: boolean
}

interface Props {
  tabId: string
  leafId: string
  ptyId: string
  isActive: boolean
}

export function TerminalView({ tabId, leafId, ptyId, isActive }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // 鼠标当前悬停命中的路径（link provider 的 hover/leave 维护），右键时读取
  const hoveredRef = useRef<HoveredPath | null>(null)
  const [menu, setMenu] = useState<TermMenu | null>(null)

  // 选区/剪贴板操作（菜单与快捷键共用，统一走 termRef.current）
  const copySelection = (clearAfter: boolean): void => {
    const term = termRef.current
    if (!term) return
    const sel = term.getSelection()
    if (sel) void window.api.clipboard.writeText(sel)
    // 快捷键复制后清除选区，让随后的 Ctrl+C 能正常发中断信号；右键复制则保留选区
    if (clearAfter) term.clearSelection()
  }
  const pasteToTerm = async (): Promise<void> => {
    const text = await window.api.clipboard.readText()
    // 走 xterm 的 paste 管线（换行规范化 + bracketed paste），由 onData 统一写入 PTY
    if (text) {
      termRef.current?.paste(text)
      return
    }
    // ⚠️ 别删这段：剪贴板"无文本但有图片"时，仍发一次 paste——bracketed 模式下即空的
    // `\e[200~\e[201~`，作为"发生了粘贴"的信号，让 Claude Code 去读系统剪贴板里的图片并附到对话。
    // 背景：⌘V「粘贴两次」修复(ed4e471)加了 preventDefault，挡掉了菜单 paste role 的原生粘贴，
    // 而图片粘贴恰恰依赖那次原生粘贴发出的这个空信号——于是图片粘贴一起失效了。这里在自定义
    // 路径里补回信号，兼顾"文本不双击 + 图片可粘"。改动 ⌘V/粘贴逻辑时务必保留此分支。
    if (await window.api.clipboard.hasImage()) termRef.current?.paste('')
  }

  // 右键菜单关闭：点击别处 / Esc
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onEsc, { capture: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onEsc, { capture: true })
    }
  }, [menu])

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
      scrollback: 100000,
      scrollSensitivity: 2, // 普通缓冲滚轮步长（略调慢翻屏速度）
      allowProposedApi: true,
      allowTransparency: true
    })
    termRef.current = term

    // 选择文字复制 / 粘贴 / 全选：返回 false 表示该按键由我们处理、不再发给 PTY。
    // 关键取舍：终端里 Ctrl+C 本是「中断信号」，所以只有「有选区」时才拦截为复制，
    // 没选区时放行让它正常发 SIGINT。全选 / 粘贴只拦 mac 的 ⌘ 组合，避免劫持
    // 其他平台 readline 的 Ctrl+A（行首）/ Ctrl+V（literal-next）。
    const isMac = window.api.platform === 'darwin'
    term.attachCustomKeyEventHandler((e): boolean => {
      if (e.type !== 'keydown') return true
      const mod = isMac ? e.metaKey : e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'c' && term.hasSelection()) {
        // preventDefault 阻断系统菜单的 copy role，避免它在选区被清后再动一次剪贴板
        e.preventDefault()
        copySelection(true)
        return false
      }
      if (isMac && e.metaKey && k === 'a') {
        e.preventDefault()
        term.selectAll()
        return false
      }
      if (isMac && e.metaKey && k === 'v') {
        // 必须 preventDefault：返回 false 只是让 xterm 不处理按键，事件仍会触发
        // 菜单 paste role → 原生 paste 事件 → xterm 内置粘贴，导致粘贴两次
        e.preventDefault()
        void pasteToTerm()
        return false
      }
      return true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    // 仅在按住 ⌘（mac）/ Ctrl（其他平台）时点击才打开网址，避免误触
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!(event.metaKey || event.ctrlKey)) return
        const url = /^https?:\/\//i.test(uri) ? uri : `https://${uri}`
        void window.api.shell.openExternal(url)
      })
    )
    term.open(el)

    // 文件路径链接：识别终端输出里的文件/目录路径，Cmd/Ctrl 点击直达。
    // 相对路径按终端实时工作目录解析（带 1.5s 缓存，避免每次 hover 都查进程 cwd）。
    let cwdValue = useStore.getState().tabs.find((t) => t.id === tabId)?.cwd || ''
    let cwdAt = 0
    const liveCwd = async (): Promise<string> => {
      const now = performance.now()
      if (cwdValue && now - cwdAt < 1500) return cwdValue
      const c = await window.api.pty.cwd(ptyId)
      cwdAt = now
      if (c) cwdValue = c
      return cwdValue
    }
    const linkProvider = term.registerLinkProvider({
      provideLinks(y, callback) {
        // 有选区时不提供链接：链接装饰的（异步）渲染会刷新终端行，把刚选好的
        // 文字冲掉，表现为"松手即丢选区"。等用户取消选区后再 hover 即可恢复链接。
        if (term.hasSelection()) {
          callback(undefined)
          return
        }
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
        const cands = extractPathCandidates(text)
        if (!cands.length) {
          callback(undefined)
          return
        }
        void (async () => {
          const cwd = await liveCwd()
          let probed: Awaited<ReturnType<typeof window.api.fs.probePaths>>
          try {
            probed = await window.api.fs.probePaths(
              cands.map((c) => c.raw),
              cwd
            )
          } catch {
            callback(undefined)
            return
          }
          // 异步查询期间用户可能已经选好文字——再次确认，避免渲染链接冲掉选区
          if (term.hasSelection()) {
            callback(undefined)
            return
          }
          const links: ILink[] = []
          const used: { start: number; end: number }[] = []
          // 优先更长的候选（带空格的完整路径），并跳过与已选区间重叠者，避免重复下划线
          const order = Array.from(cands.keys()).sort(
            (a, b) => cands[b].end - cands[b].start - (cands[a].end - cands[a].start)
          )
          for (const i of order) {
            const r = probed[i]
            if (!r) continue
            const c = cands[i]
            if (used.some((u) => c.start < u.end && c.end > u.start)) continue
            used.push({ start: c.start, end: c.end })
            const target: HoveredPath = { absPath: r.absPath, isDir: r.isDir }
            links.push({
              text: c.raw,
              range: { start: { x: c.start + 1, y }, end: { x: c.end, y } },
              decorations: { underline: true, pointerCursor: true },
              activate: (ev) => {
                if (ev.metaKey || ev.ctrlKey) routeOpen(r.absPath, r.isDir)
              },
              hover: () => {
                hoveredRef.current = target
              },
              leave: () => {
                if (hoveredRef.current === target) hoveredRef.current = null
              }
            })
          }
          callback(links.length ? links : undefined)
        })()
      }
    })
    try {
      // Canvas 渲染后端：正确合成半透明背景（毛玻璃），避免 WebGL 增量重绘在快速滚动
      // 大量文本时用半透明色「擦除」旧像素造成的叠影/残留花屏。吞吐略低于 WebGL，由下方
      // rAF 写入合并补偿。历史上曾用 WebglAddon，因半透明背景叠影改回 Canvas（见 docs/终端花屏）。
      term.loadAddon(new CanvasAddon())
    } catch {
      // Canvas 不可用时回退到 DOM 渲染
    }

    // 常驻自绘滚动条：xterm 原生滚动条在「备用屏」(vim/top/Claude Code 等全屏 TUI) 里
    // 因缓冲无溢出会隐藏 thumb（表现为「滚动条不见了」）。这里自绘一个始终可见、可拖拽、
    // 随缓冲状态同步的滚动条，盖在原生滚动条预留的 gutter 上（原生 thumb 已在 CSS 置透明，
    // 仅保留占位宽度，避免文字被盖）。备用屏里 Claude Code 用它自己的滚轮滚动，这里只做可见提示。
    const scrollbar = document.createElement('div')
    scrollbar.className = 'term-scrollbar'
    const thumb = document.createElement('div')
    thumb.className = 'term-scrollbar-thumb'
    scrollbar.appendChild(thumb)
    el.appendChild(scrollbar)

    // 「回到最新」常驻按钮：普通终端直接跳到底；备用屏(Claude Code)里连发向下滚轮把应用推到底。
    const jumpBtn = document.createElement('button')
    jumpBtn.className = 'term-jump'
    jumpBtn.title = '回到最新'
    jumpBtn.textContent = '↓ 最新'
    el.appendChild(jumpBtn)

    // 派发合成滚轮事件到 xterm 屏幕元素：由 xterm 按当前模式自行编码——普通缓冲滚 scrollback，
    // 备用屏+鼠标接管时转成鼠标滚轮上报给应用（如 Claude Code），故对 Claude Code 也有效。
    const dispatchWheel = (deltaY: number, x?: number, y?: number): void => {
      const tgt = (el.querySelector('.xterm-screen') as HTMLElement | null) ?? el
      const r = tgt.getBoundingClientRect()
      tgt.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX: x ?? r.left + r.width / 2,
          clientY: y ?? r.top + r.height / 2
        })
      )
    }
    const jumpBottom = (): void => {
      const t = termRef.current
      if (!t) return
      if (t.buffer.active.type === 'alternate' && t.modes.mouseTrackingMode !== 'none') {
        for (let i = 0; i < 80; i++) dispatchWheel(120) // 备用屏无法直接定位底部，连发把它推到最新
      } else {
        t.scrollToBottom()
      }
    }
    jumpBtn.addEventListener('click', jumpBottom)

    // 备用屏(Claude Code)里把一次真实滚轮放大成约 2 次，读长输出更快（普通缓冲走 scrollSensitivity）
    let synthesizing = false
    const onWheelAmplify = (e: WheelEvent): void => {
      if (synthesizing) return
      const t = termRef.current
      if (!t) return
      if (t.buffer.active.type !== 'alternate' || t.modes.mouseTrackingMode === 'none') return
      synthesizing = true
      dispatchWheel(e.deltaY, e.clientX, e.clientY)
      synthesizing = false
    }
    el.addEventListener('wheel', onWheelAmplify, { capture: true, passive: true })

    const updateScrollbar = (): void => {
      const t = termRef.current
      if (!t) return
      const buf = t.buffer.active
      // 全屏 TUI（备用屏：Claude Code / vim / top…）里，滚动完全由应用自己管，
      // 终端拿不到它的内部滚动进度，画出来只会是条误导人的"假滚动条"——直接隐藏；
      // 但「回到最新」按钮常显（应用可能已滚上去）。普通 shell（正常缓冲）才画常驻滚动条。
      if (buf.type === 'alternate') {
        scrollbar.style.display = 'none'
        jumpBtn.style.display = ''
        return
      }
      jumpBtn.style.display = buf.viewportY < buf.baseY ? '' : 'none' // 滚上去了才显示
      scrollbar.style.display = ''
      const total = Math.max(buf.length, t.rows)
      const H = scrollbar.clientHeight
      if (!H) return
      const thumbH = Math.max(28, Math.min(1, t.rows / total) * H)
      const maxTop = Math.max(0, H - thumbH)
      const topRatio = total > t.rows ? buf.viewportY / total : 0
      thumb.style.height = `${thumbH}px`
      thumb.style.top = `${Math.min(maxTop, Math.max(0, topRatio * H))}px`
    }
    const renderDisp = term.onRender(updateScrollbar)

    // 拖拽 thumb 滚动（仅普通缓冲有 scrollback 时有效；备用屏无处可滚）
    let dragging = false
    let dragStartY = 0
    let dragStartTop = 0
    const onThumbDown = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      dragging = true
      dragStartY = e.clientY
      dragStartTop = parseFloat(thumb.style.top || '0')
      document.body.style.userSelect = 'none'
    }
    const onDragMove = (e: MouseEvent): void => {
      if (!dragging) return
      const t = termRef.current
      if (!t) return
      const buf = t.buffer.active
      const total = Math.max(buf.length, t.rows)
      if (total <= t.rows) return
      const H = scrollbar.clientHeight
      const maxTop = Math.max(1, H - thumb.offsetHeight)
      const newTop = Math.min(maxTop, Math.max(0, dragStartTop + (e.clientY - dragStartY)))
      const targetLine = Math.round((newTop / H) * total)
      t.scrollToLine(Math.min(buf.baseY, Math.max(0, targetLine)))
    }
    const onDragUp = (): void => {
      dragging = false
      document.body.style.userSelect = ''
    }
    thumb.addEventListener('mousedown', onThumbDown)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragUp)

    const doFit = (): void => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        try {
          fit.fit()
        } catch {
          // 容器尺寸异常时跳过
        }
      }
      updateScrollbar()
    }
    doFit()
    window.api.pty.resize(ptyId, term.cols, term.rows)

    const store = useStore.getState()
    // PTY 高吞吐时逐块直写会让渲染与缓冲错位（撕裂/掉帧型花屏）。这里把一帧内到达的多块
    // 累积起来，用 rAF 合并成一次 term.write：一帧一写、对齐刷新节奏，消除撕裂并降 CPU。
    let pendingWrites: string[] = []
    let writeRaf = 0
    const flushWrites = (): void => {
      writeRaf = 0
      if (!pendingWrites.length) return
      const chunk = pendingWrites.join('')
      pendingWrites = []
      term.write(chunk)
    }
    const unsubData = window.api.pty.onData(ptyId, (data) => {
      pendingWrites.push(data)
      if (!writeRaf) writeRaf = requestAnimationFrame(flushWrites)
    })
    const unsubExit = window.api.pty.onExit(ptyId, () => {
      // 带 ptyId 校验：面板若已被切换成其他功能则忽略这次退出
      useStore.getState().closeLeaf(tabId, leafId, { alreadyExited: true, ptyId })
    })
    const dataDisp = term.onData((data) => window.api.pty.write(ptyId, data))
    const resizeDisp = term.onResize(({ cols, rows }) => window.api.pty.resize(ptyId, cols, rows))
    const titleDisp = term.onTitleChange((title) => store.setTabTitle(tabId, title))
    // 终端响铃（CLI 完成一轮 / 需确认审批时通常会响铃 BEL）→ 未聚焦则标记「需处理」，
    // 供右侧抽屉里该项目条目呼吸高亮提示用户去处理
    const bellDisp = term.onBell(() => {
      if (!el.contains(document.activeElement)) useStore.getState().flagAttention(ptyId)
    })

    // 点击/聚焦该终端时标记为活动面板，并记住它是「最近活动终端」
    // （供名词词典等面板把文本插入到这个终端的光标处——那时 activeLeaf 已是词典自己）
    const onFocus = (): void => {
      useStore.getState().setActiveLeaf(tabId, leafId)
      useStore.getState().clearAttention(ptyId)
      useStore.setState({ lastActiveTerminal: { tabId, ptyId } })
    }
    el.addEventListener('focusin', onFocus)

    // 右键弹菜单：命中路径时附带「在此打开/cd/复制路径」等项，并始终带上
    // 复制选区 / 粘贴 / 全选 / 清屏 等通用文本操作。
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({
        x: e.clientX,
        y: e.clientY,
        target: hoveredRef.current,
        hasSelection: term.hasSelection()
      })
    }
    el.addEventListener('contextmenu', onContextMenu)

    const ro = new ResizeObserver(() => doFit())
    ro.observe(el)

    term.focus()

    return () => {
      ro.disconnect()
      el.removeEventListener('focusin', onFocus)
      el.removeEventListener('contextmenu', onContextMenu)
      renderDisp.dispose()
      thumb.removeEventListener('mousedown', onThumbDown)
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragUp)
      jumpBtn.removeEventListener('click', jumpBottom)
      el.removeEventListener('wheel', onWheelAmplify, { capture: true } as EventListenerOptions)
      jumpBtn.remove()
      scrollbar.remove()
      if (writeRaf) cancelAnimationFrame(writeRaf)
      unsubData()
      unsubExit()
      dataDisp.dispose()
      resizeDisp.dispose()
      titleDisp.dispose()
      bellDisp.dispose()
      linkProvider.dispose()
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

  const run = (fn: () => void) => (): void => {
    fn()
    setMenu(null)
  }

  // 存进局部 const，保证下面回调闭包里对 target 的类型收窄稳定
  const m = menu
  const target = m?.target ?? null

  return (
    <div ref={containerRef} className="terminal-host">
      {m &&
        createPortal(
          <div
            className="context-menu"
            style={{ left: m.x, top: m.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {target && (
              <>
                {target.isDir ? (
                  <>
                    <button
                      onClick={run(() =>
                        void useStore
                          .getState()
                          .openTerminal({ projectId: useStore.getState().activeProjectId, cwd: target.absPath })
                      )}
                    >
                      在此打开新终端
                    </button>
                    <button onClick={run(() => cdInTerminal(ptyId, target.absPath))}>
                      cd 进此目录
                    </button>
                    <button onClick={run(() => void window.api.fs.showInFolder(target.absPath))}>
                      在访达中显示
                    </button>
                    <button onClick={run(() => void window.api.fs.openPath(target.absPath))}>
                      用访达打开
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={run(() => void useStore.getState().openFile(target.absPath))}>
                      在面板中预览
                    </button>
                    <button onClick={run(() => void window.api.fs.openPath(target.absPath))}>
                      用默认应用打开
                    </button>
                    <button onClick={run(() => void window.api.fs.showInFolder(target.absPath))}>
                      在访达中显示
                    </button>
                    <button onClick={run(() => cdInTerminal(ptyId, dirnameOf(target.absPath)))}>
                      cd 到所在文件夹
                    </button>
                  </>
                )}
                <div className="menu-sep" />
                <button onClick={run(() => void window.api.clipboard.writeText(target.absPath))}>
                  复制路径
                </button>
                <button
                  onClick={run(() => void window.api.clipboard.writeText(relativeToProject(target.absPath)))}
                >
                  复制相对路径
                </button>
                <div className="menu-sep" />
              </>
            )}
            <button disabled={!m.hasSelection} onClick={run(() => copySelection(false))}>
              复制
            </button>
            <button onClick={run(() => void pasteToTerm())}>粘贴</button>
            <button onClick={run(() => termRef.current?.selectAll())}>全选</button>
            <div className="menu-sep" />
            <button onClick={run(() => termRef.current?.clear())}>清屏</button>
          </div>,
          document.body
        )}
    </div>
  )
}
