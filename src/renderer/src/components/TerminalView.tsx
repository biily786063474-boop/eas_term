import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Terminal, type ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { xtermTheme } from '../themes'

// ── 终端文件链接（Cmd/Ctrl 点击直达）────────────────────────────────
// 能在 App 内预览的扩展名 → 走预览面板（和点文件树一致）；其余文件/文件夹交给系统。
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const TEXT_EXT =
  /\.(txt|md|markdown|mdx|json|jsonc|ya?ml|toml|ini|conf|cfg|env|xml|html?|css|s[ac]ss|less|js|cjs|mjs|jsx|ts|tsx|c|h|cc|cpp|hpp|cxx|cs|java|kt|kts|go|rs|rb|py|pyw|php|swift|m|mm|sh|bash|zsh|fish|sql|vue|svelte|astro|lua|pl|r|dart|gradle|gitignore|dockerignore|log|csv|tsv)$/i

function routeOpen(absPath: string, isDir: boolean): void {
  if (isDir) {
    void window.api.fs.openPath(absPath)
  } else if (IMAGE_EXT.test(absPath) || TEXT_EXT.test(absPath)) {
    void useStore.getState().openFile(absPath)
  } else {
    void window.api.fs.openPath(absPath)
  }
}

const LEAD_TRIM = /^[("'`<[{「『]+/
const TAIL_TRIM = /[)"'`>\]}.,;:。、）」』]+$/

// 从一行终端文本里抽出"长得像路径"的候选 token（含起止字符下标，供下划线定位）。
// 真正是否成为链接由主进程 fs.statSync 验证存在性把关，所以这里宁可宽松。
function extractPathCandidates(line: string): { raw: string; start: number; end: number }[] {
  const out: { raw: string; start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) && out.length < 15) {
    let tok = m[0]
    let start = m.index
    let end = start + tok.length
    // http(s) 等网址交给 WebLinksAddon，但保留 file://
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok) && !tok.startsWith('file://')) continue
    const lead = tok.match(LEAD_TRIM)
    if (lead) {
      start += lead[0].length
      tok = tok.slice(lead[0].length)
    }
    const tail = tok.match(TAIL_TRIM)
    if (tail) {
      end -= tail[0].length
      tok = tok.slice(0, tok.length - tail[0].length)
    }
    if (!tok) continue
    const pathish =
      tok.startsWith('file://') ||
      tok.startsWith('~') ||
      tok.includes('/') ||
      tok.includes('\\')
    if (!pathish) continue
    out.push({ raw: tok, start, end })
  }
  return out
}

// 鼠标当前悬停命中的路径（由 link provider 的 hover/leave 维护），供右键菜单读取
interface HoveredPath {
  absPath: string
  isDir: boolean
}
interface TermMenu {
  x: number
  y: number
  // 右键时鼠标恰好悬停命中的文件/目录路径（没命中则 null，仍弹通用文本菜单）
  target: HoveredPath | null
  // 右键时终端里是否有选中的文字（决定「复制」是否可用）
  hasSelection: boolean
}

// 路径相对当前活动项目根的展示（复制相对路径用）；不在项目内则原样返回
function relativeToProject(fullPath: string): string {
  const st = useStore.getState()
  const project = st.projects.find((p) => p.id === st.activeProjectId)
  if (!project) return fullPath
  if (fullPath === project.path) return project.name
  if (fullPath.startsWith(project.path + '/')) return fullPath.slice(project.path.length + 1)
  return fullPath
}

// 把 cd 命令写进指定终端并回车（带空格/特殊字符则单引号包裹，按 POSIX 转义）
function cdInTerminal(ptyId: string, dir: string): void {
  const q = /[^\w@%+=:,./-]/.test(dir) ? `'${dir.replace(/'/g, `'\\''`)}'` : dir
  window.api.pty.write(ptyId, `cd ${q}\n`)
}

// 取所在文件夹（POSIX 与 Windows 分隔符都处理）
function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
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
    if (text) window.api.pty.write(ptyId, text)
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
        copySelection(true)
        return false
      }
      if (isMac && e.metaKey && k === 'a') {
        term.selectAll()
        return false
      }
      if (isMac && e.metaKey && k === 'v') {
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
          const links: ILink[] = []
          cands.forEach((c, i) => {
            const r = probed[i]
            if (!r) return
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
          })
          callback(links.length ? links : undefined)
        })()
      }
    })
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
      unsubData()
      unsubExit()
      dataDisp.dispose()
      resizeDisp.dispose()
      titleDisp.dispose()
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
