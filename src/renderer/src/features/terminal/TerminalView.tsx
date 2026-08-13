import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { SecretBadge } from './SecretBadge'
import { TerminalInput } from './TerminalInput'
import { parseApproval } from './approvalParse'
import { feedKeystroke, noteRunning, drainFollow, forgetPty } from '../gantt/collector'
import { collectLeaves } from '../../layout'
import './terminal.css'

/** 读终端底部若干行，**含 scrollback**。
 *
 *  一开始只读可见区（想着「框总是画在当前屏上」），实测发现不行：画布里的终端节点
 *  只有 250px 高、十来行，而一个审批框有十行——框的上半截连同待执行的命令
 *  早滚进 scrollback 了，读可见区只能看到问句和选项，正文永远是空的。
 *
 *  读进历史不会认错框：解析器是从后往前扫的，先遇到的一定是最新那个；
 *  再加上「序号必须从 1 连续」这道校验，把两个框的选项拼在一起也会被判无效。 */
const READ_LINES = 48

function readScreen(term: Terminal): string[] {
  const buf = term.buffer.active
  const end = Math.min(buf.length, buf.baseY + term.rows)
  const out: string[] = []
  for (let y = Math.max(0, end - READ_LINES); y < end; y++) {
    out.push(buf.getLine(y)?.translateToString(true) ?? '')
  }
  return out
}

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
  /** 画布模式下的缩放比：终端不走 CSS transform（会让 xterm 鼠标坐标点偏），改按此比放大字号，
   *  行列数保持不变、鼠标坐标精准。分屏模式恒为 1。 */
  canvasScale?: number
}

const BASE_FONT = 13
const scaledFont = (s: number): number => Math.max(4, BASE_FONT * s)

export function TerminalView({ tabId, leafId, ptyId, isActive, canvasScale = 1 }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  /** xterm 的挂载点。和 host 分开是因为 host 底部还要放输入框——
   *  xterm 会把自己撑成 height:100%，挂在 host 上会和输入框重叠。 */
  const screenRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // 最新缩放比 + 立即 fit 句柄（缩放落定时用；ResizeObserver 另有去抖 fit）
  const canvasScaleRef = useRef(canvasScale)
  const fitNowRef = useRef<(() => void) | null>(null)
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
    // 终端屏幕区（不含底部输入框）。fit / 滚动条 / 尺寸观察都以它为准，
    // 这样输入框长高时终端会跟着缩，不会被顶出可视区。
    const screen = screenRef.current!
    const term = new Terminal({
      theme: xtermTheme(useStore.getState().theme),
      // 跨平台等宽字体回退：mac 用 SF Mono，Windows 用 Cascadia Code/Consolas
      fontFamily:
        '"SF Mono", Menlo, Monaco, "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: scaledFont(canvasScale),
      lineHeight: 1.25,
      cursorBlink: true,
      macOptionIsMeta: true,
      // **每终端的固定成本，乘以你开了几个终端。** 10 万行时可达数十 MB，
      // 多终端长跑内存单调增长压垮 GPU 进程 → 白屏；先降到 2 万，2026-08-06 再降到 5 千。
      //
      // 实测（20000 行 × 180 字符灌满一个终端）：renderer +75MB。三十个终端全填满就是 2.2GB，
      // 和长跑实例的实测总量吻合。降到 5000 后单终端约 19MB，三十个约 570MB。
      //
      // 反直觉的一点：**代价取决于行有多长**。同样 20000 行，5 字符的短行增量是 0MB ——
      // xterm 按实际列数分配 TypedArray，而且不进 JS 堆，所以读 performance.memory
      // 完全看不出来（第一次测就是这么误判的）。
      //
      // 5000 行够干什么：审批解析只读底部若干行，绰绰有余；人工回看约 60 屏。
      // 用户 2026-08-06 确认过这个取舍。
      scrollback: 5000,
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
    fitRef.current = fit
    term.loadAddon(fit)
    // 仅在按住 ⌘（mac）/ Ctrl（其他平台）时点击才打开网址，避免误触
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!(event.metaKey || event.ctrlKey)) return
        const url = /^https?:\/\//i.test(uri) ? uri : `https://${uri}`
        // 跳出的网页默认走「画板内嵌浏览器」：找该终端所在 Frame；split 模式先切画布并落到该项目的
        // Frame；实在没有任何画布 Frame 才回退系统浏览器。
        const st = useStore.getState()
        let frame = st.canvas.frames.find((f) => f.nodes.some((n) => n.leafId === leafId))
        if (!frame) {
          const projectId = st.tabs.find((t) => t.id === tabId)?.projectId
          frame =
            st.canvas.frames.find((f) => !f.parentId && f.projectId === projectId) ??
            st.canvas.frames.find((f) => !f.parentId)
        }
        if (frame) {
          if (st.viewMode !== 'canvas') st.setViewMode('canvas')
          st.addWebNode(frame.id, url)
        } else {
          void window.api.shell.openExternal(url)
        }
      })
    )
    term.open(screen)

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
    screen.appendChild(scrollbar)

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
      // 终端拿不到它的内部滚动进度，画出来只会是条误导人的"假滚动条"——直接隐藏。
      // 普通 shell（正常缓冲）才画常驻滚动条。
      if (buf.type === 'alternate') {
        scrollbar.style.display = 'none'
        return
      }
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

    // fit = 按容器+字号重算 cols/rows，会重分配 CanvasAddon 的 4 张 GPU 后备存储 + 重建字形图集。
    // 隐藏(display:none → offset 尺寸为 0)的终端一律跳过，别为看不见的终端烧 GPU。
    const doFit = (): void => {
      const t = termRef.current
      if (!t) return
      if (screen.offsetWidth === 0 || screen.offsetHeight === 0) return
      const size = scaledFont(canvasScaleRef.current)
      if (t.options.fontSize !== size) t.options.fontSize = size
      try {
        fit.fit()
      } catch {
        // 容器尺寸异常时跳过
      }
      updateScrollbar()
    }
    // 去抖 fit：把「改字号 + fit」合并到手势停止后一次做。消除连续缩放时 canvasScale effect 与
    // ResizeObserver 双触发、每帧 fit 反复重建 GPU canvas/字形图集导致的显存暴涨崩溃(白屏主因之一)。
    let fitTimer = 0
    const scheduleFit = (): void => {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = window.setTimeout(doFit, 100)
    }
    fitNowRef.current = doFit // 缩放落定时立即 fit(见 canvasScale 的 useLayoutEffect),无闪烁
    doFit()
    window.api.pty.resize(ptyId, term.cols, term.rows)

    const store = useStore.getState()
    // PTY 高吞吐时逐块直写会让渲染与缓冲错位（撕裂/掉帧型花屏）。这里把一帧内到达的多块
    // 累积起来，用 rAF 合并成一次 term.write：一帧一写、对齐刷新节奏，消除撕裂并降 CPU。
    let pendingWrites: string[] = []
    let writeRaf = 0
    let lastFlush = 0
    // 最快每 16ms 写一次（≈60Hz）。原来是「每一帧写一次」，在 ProMotion 屏上
    // rAF 实测跑 120.6fps —— 于是 agent 刷屏时 xterm 每秒被写 120 次、跟着重排重绘 120 次。
    // 文字终端 60Hz 和 120Hz 人眼分不出来，但工作量差一倍，
    // 而「让 agent 跑几小时」恰好是这个应用最常见、也最该省电的状态。
    const MIN_FLUSH_MS = 16
    const flushWrites = (): void => {
      writeRaf = 0
      if (!pendingWrites.length) return
      const now = performance.now()
      if (now - lastFlush < MIN_FLUSH_MS) {
        // 离上次写太近 → 这一帧不写，攒着，下一帧再来（数据不丢，只是晚一帧）
        writeRaf = requestAnimationFrame(flushWrites)
        return
      }
      lastFlush = now
      const chunk = pendingWrites.join('')
      pendingWrites = []
      term.write(chunk)
    }
    let disposed = false
    // 「这个终端里跑的是哪个 AI CLI」——问主进程查 controlling terminal 上的进程名。
    // 挂在标题变化和输出上，不轮询：状态一变才该重查。spinner 每帧都会触发标题事件，
    // 所以必须节流。两档：状态刚变那一刻要快（标题变化 / 窗口回来），日常输出只要最终一致。
    //
    // **声明必须在所有使用点之前。** 下面 onData 的回调里就要用它，而
    // `window.api.pty.onData` 订阅时会**同步回放**缓冲里的输出（preload 的
    // pendingBuffers）——缓冲非空时那个回调在订阅调用中当场执行，此刻若 probeAgent
    // 还没初始化就会撞 TDZ，异常穿出整个 effect，后面的 onTitleChange / resize / bell
    // 全都注册不上：终端既没有输出也没有状态。放在这里就没有这个窗口。
    let lastProbe = 0
    const probeAgent = (minGapMs = 2000): void => {
      const now = Date.now()
      if (now - lastProbe < minGapMs) return
      lastProbe = now
      void window.api.pty.agentOf(ptyId).then((k) => {
        if (!disposed) useStore.getState().setPtyAgent(ptyId, k)
      })
    }
    const unsubData = window.api.pty.onData(ptyId, (data) => {
      // 终端有输出 → 低频重探一次。**这条是接住「agent 退出」的唯一信号**：
      // Claude Code 退出时不还原终端标题，裸 zsh 也不一定设标题，所以「标题变化」
      // 接不住；而输入框发送走的是 pty.write、根本不经过 term.onData，那条也接不住。
      // agent 一退，shell 打印提示符必然产生输出 —— 这里才拦得到。
      probeAgent(10000)
      pendingWrites.push(data)
      if (!writeRaf) writeRaf = requestAnimationFrame(flushWrites)
    })
    const unsubExit = window.api.pty.onExit(ptyId, () => {
      // 带 ptyId 校验：面板若已被切换成其他功能则忽略这次退出
      useStore.getState().setPtyRunning(ptyId, false)
      noteRunning(ptyId, false, { projectId: '', leafId: '' })
      // ptyId 终身不复用：pty 真正退出时把这个 id 名下的采集态整体清掉，
      // 否则没等到 spinner 的 pending / 没按回车的半行 keyBuf 会永久留在模块级 Map 里
      forgetPty(ptyId)
      useStore.getState().closeLeaf(tabId, leafId, { alreadyExited: true, ptyId })
    })
    const dataDisp = term.onData((data) => {
      // 真人在终端里敲字（输入框那条走 pty.write，不经过这里）
      probeAgent(10000)
      // 甘特图采集要在写进 PTY 之前拿到原始按键 —— 这是键盘输入的唯一出口。
      // 采集是附加功能，绝不能拖累主功能：包一层 try/catch，抛了也不能耽误这次按键写进 pty
      try {
        feedKeystroke(ptyId, data)
        drainFollow(ptyId)
      } catch (err) {
        console.error('[gantt] feedKeystroke/drainFollow 失败', err)
      }
      window.api.pty.write(ptyId, data)
    })
    const resizeDisp = term.onResize(({ cols, rows }) => window.api.pty.resize(ptyId, cols, rows))
    // Agent 状态检测靠「终端标题」：Claude Code 工作时把标题设成「<盲文 spinner> 名字」（⠋⠙⠹…，
    // U+2800–U+28FF），一轮跑完 / 出选项 / 需审批（在等你操作）时设成「✳ 名字」（非 spinner）。
    // 标题从 spinner 跃迁到非 spinner → 标记「需处理」，供抽屉呼吸提示 / 灵动岛 / 提示音。
    // 纯 shell 的标题是 cwd（无 spinner），永不误报；比"输出静止"精确、不乱闪。
    //
    // **这里曾附加「且当前没聚焦在该终端」**，后果是：你正盯着终端 A，A 跑完了，
    // 于是一声不响、灵动岛上也没有它——恰恰是最该提醒的场景（人可能根本不在电脑前，
    // 「聚焦」只说明这个面板是活动面板，不代表有人在看）。改成一律标记；
    // 「已读」交给下面的 keydown/mousedown——你在这个终端里动了手，才算真看见了。
    let prevTitleSpinner = false
    // probeAgent / disposed 的声明已经提到 onData 订阅之前了（见那里的注释：
    // 订阅会同步回放缓冲，声明留在这里会撞 TDZ）。它也靠标题变化自愈：
    // 用户退出 claude 回到裸 shell，标题变回 cwd → 重查 → 置 null，命令按钮跟着消失。
    // 开局先查一次：终端可能是从存档恢复的，里面的 agent 早就在跑、标题也不会再变
    // 包一层箭头函数：setTimeout 会把定时器 id 当第一个实参传进去，
    // 直接传 probeAgent 的话那个 id 就成了 minGapMs，节流值变成随机数
    const firstProbe = window.setTimeout(() => probeAgent(0), 1500)
    // 窗口重新获得焦点：用户可能在别处（比如系统终端）改了这个会话的状态
    const onWinFocus = (): void => probeAgent()
    window.addEventListener('focus', onWinFocus)
    // 「这个终端在干活吗」的唯一信号：CLI 把一个转圈字符写在标题最前面。
    //
    // **认字符集，不认 CLI 版本号。** 同一台机器上不同终端可能装着不同版本的 CLI
    // （甚至一个跑 claude、一个跑 codex），判版本号必漏；认字符则新老同时成立。
    //
    // 2026-08-12 实测 Claude Code 2.1.229 的完整时间线（旧版是盲文，新版换了圆圈）：
    //   ✳ Claude Code        ← 空闲
    //   ◐ Claude Code        ← 开始干活
    //   ◑ Claude Code        ← 约 1 秒一帧地交替（旧版盲文是 ~100ms，快得多）
    //   ✳ 从1数到30逐行输出   ← 干完，回到 ✳
    // 干完会**明确**写一条 ✳ 开头的标题，所以「停下来」有显式信号，不需要超时兜底。
    //
    // ⚠️ `✳`(U+2733) 是**空闲**态，绝不能算进忙碌集 —— 算进去就永远显示在干活。
    const SPIN_BUSY = /^[⠀-⣿◐-◓◴-◷]/u // 盲文(旧) · 半黑圆(新) · 象限圆(防御)
    const SPIN_IDLE = /^[✳✴✶✻✽✹]/u //  ✳ 一族：CLI 空闲时的品牌字符
    const lead = (t: string): string => t.replace(/^\s+/, '')
    const isSpinnerTitle = (t: string): boolean => SPIN_BUSY.test(lead(t))
    // 标签名里这些前缀一律剥掉：忙碌的会闪、空闲的 ✳ 也不是名字的一部分
    const stripLead = (t: string): string =>
      lead(t).replace(
        /^[⠀-⣿◐-◓◴-◷✳✴✶✻✽✹]+\s*/u,
        ''
      )
    // 兜底：CLI 再换一次字符时不至于又静默失效（这次就是这么栽的）。
    // 判据是「首字符在变、标题其余部分没变」= 那就是个动画。
    // 排除已知空闲字符，否则「◑ → ✳」这一帧收尾也会被误判成还在跑。
    let prevTitle = ''
    const looksAnimating = (t: string): boolean => {
      const a = lead(t)
      const b = lead(prevTitle)
      if (!a || !b || a === b) return false
      if (SPIN_IDLE.test(a)) return false
      const [ca, ...ra] = [...a]
      const [cb, ...rb] = [...b]
      return ca !== cb && ra.join('') === rb.join('') && ra.join('').trim().length > 0
    }
    const titleDisp = term.onTitleChange((title) => {
      const spinner = isSpinnerTitle(title) || looksAnimating(title)
      prevTitle = title
      probeAgent()
      // **把 spinner 那个字剥掉再写进标签。**
      //
      // Claude Code 干活时标题是「<盲文 spinner> 名字」，那个字每 ~100ms 换一个
      // （⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ 循环）。原样写进去的话，标签栏上那行字就一直在跳 ——
      // 而它正好在标题栏下面，看着就是「顶上一条在闪」。
      // 更糟的是每跳一次都造一个新的 tabs 数组，订阅它的 App / 侧栏 / 标签栏 /
      // 待处理徽标全都跟着重渲染一轮，每秒十次。
      //
      // 「在跑」这件事由下面的 setPtyRunning 表达（标签上有个常亮的点、
      // 抽屉有呼吸提示、灵动岛也在报），不需要靠标题闪来传达。
      const stable = stripLead(title)
      if (stable) store.setTabTitle(tabId, stable)
      // 同一个信号也用来做左上角的「谁在自动跑」提示
      const st = useStore.getState()
      st.setPtyRunning(ptyId, spinner)
      // 找这个 pty 属于哪个项目、哪个 leaf —— 甘特图按项目分行、按 leaf 跳回
      // （pane.ptyId 只在 kind:'terminal' 分支上存在，PaneState 是判别联合，访问前必须先窄化）
      const tab = st.tabs.find((t) =>
        collectLeaves(t.root).some((l) => l.pane.kind === 'terminal' && l.pane.ptyId === ptyId)
      )
      const leaf =
        tab &&
        collectLeaves(tab.root).find((l) => l.pane.kind === 'terminal' && l.pane.ptyId === ptyId)
      if (tab?.projectId && leaf) {
        noteRunning(ptyId, spinner, { projectId: tab.projectId, leafId: leaf.id })
      }
      if (prevTitleSpinner && !spinner) {
        useStore.getState().flagAttention(ptyId)
        // 停下来的原因可能是「答完了」，也可能是「弹了个框等你选」。
        // 读一眼屏幕分辨这两种——认出选项的话灵动岛就能直接给按钮。
        //
        // 延后一拍再读：标题是 CLI 在**画框之前**设的，此刻屏幕上往往只有半个框。
        // 150ms 后框已落定，而人还来不及反应，不影响体感。
        setTimeout(() => {
          if (disposed) return
          try {
            const screen = readScreen(term)
            const info = parseApproval(screen)
            useStore.getState().setPtyApproval(ptyId, info)
            // 认不出、或认出了框却没抓到正文 → 留个样本。审批框总该有正文，
            // 没有多半是我们的规则没跟上 CLI 的新样式。
            if (!info || !info.body) {
              window.api.island.reportParse(
                info ? '有选项但没抓到正文' : '没认出审批框',
                screen.filter((l) => l.trim()).slice(-30)
              )
            }
          } catch {
            // 解析器抛异常绝不能牵连终端本身——大不了这轮没有直通按钮
          }
        }, 150)
      }
      prevTitleSpinner = spinner
    })
    // 独立响铃 BEL（部分 CLI 会在需确认时响铃）→ 一律标记，同上（次要兜底；
    // OSC 标题终止符的 BEL 不会触发此事件）
    const bellDisp = term.onBell(() => useStore.getState().flagAttention(ptyId))

    // 点击/聚焦该终端时标记为活动面板，并记住它是「最近活动终端」
    // （供名词词典等面板把文本插入到这个终端的光标处——那时 activeLeaf 已是词典自己）
    const onFocus = (): void => {
      useStore.getState().setActiveLeaf(tabId, leafId)
      useStore.getState().clearAttention(ptyId)
      useStore.setState({ lastActiveTerminal: { tabId, ptyId } })
    }
    el.addEventListener('focusin', onFocus)
    // 已聚焦的终端不会再触发 focusin，光靠它「已读」标记会一直亮到你切走再切回来。
    // 在这个终端里敲键 / 点一下，就当你看见了。
    const markRead = (): void => useStore.getState().clearAttention(ptyId)
    el.addEventListener('keydown', markRead)
    el.addEventListener('mousedown', markRead)

    // 右键弹菜单：命中路径时附带「在此打开/cd/复制路径」等项，并始终带上
    // 复制选区 / 粘贴 / 全选 / 清屏 等通用文本操作。
    //
    // **输入框（.term-input）里的右键要放过。** 这里的监听是原生 addEventListener
    // 挂在 .terminal-host 上的——原生监听器在真实 DOM 冒泡阶段会比 React 的合成事件
    // 委托（挂在更外层的根节点上）先碰到事件。输入框自己也有一个右键菜单（待办清单），
    // 挂的是 React 的 onContextMenu；这里如果照常 stopPropagation，事件根本到不了
    // React 的委托点，输入框那个菜单永远弹不出来。原生监听器碰到目标在输入框里 → 直接
    // 放行，不 preventDefault/不 stopPropagation，让它继续冒泡给输入框自己处理。
    const onContextMenu = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest('.term-input')) return
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

    // 尺寸变化(窗口/分屏/画布缩放导致的像素尺寸变)→ 走去抖 fit，不每帧直 fit
    const ro = new ResizeObserver(() => scheduleFit())
    ro.observe(screen)

    term.focus()

    return () => {
      ro.disconnect()
      el.removeEventListener('focusin', onFocus)
      el.removeEventListener('keydown', markRead)
      el.removeEventListener('mousedown', markRead)
      el.removeEventListener('contextmenu', onContextMenu)
      renderDisp.dispose()
      thumb.removeEventListener('mousedown', onThumbDown)
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragUp)
      el.removeEventListener('wheel', onWheelAmplify, { capture: true } as EventListenerOptions)
      scrollbar.remove()
      if (fitTimer) clearTimeout(fitTimer)
      if (writeRaf) cancelAnimationFrame(writeRaf)
      unsubData()
      unsubExit()
      dataDisp.dispose()
      window.clearTimeout(firstProbe)
      window.removeEventListener('focus', onWinFocus)
      resizeDisp.dispose()
      titleDisp.dispose()
      bellDisp.dispose()
      linkProvider.dispose()
      disposed = true // 审批解析是延后 150ms 跑的，卸载后别再碰已 dispose 的 term
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

  // canvasScale = PaneView 传入的 committedScale（缩放「落定」值，只在手势停止后变一次，不逐帧变）。
  // 故这里可以**立即** fit（落真实字号 + 重排行列）而非去抖——缩放过程中的实时视觉由 PaneView 的
  // transform 预览承担,不经这里;落定这一次用 useLayoutEffect 在 paint 前 fit,避免「容器已变大、
  // 内容还是旧字号」的一帧闪烁。连续缩放期间 canvasScale 不变 → 此 effect 不触发 → 不会每帧重建 GPU。
  useLayoutEffect(() => {
    canvasScaleRef.current = canvasScale
    fitNowRef.current?.()
  }, [canvasScale])

  const run = (fn: () => void) => (): void => {
    fn()
    setMenu(null)
  }

  // 存进局部 const，保证下面回调闭包里对 target 的类型收窄稳定
  const m = menu
  const target = m?.target ?? null

  return (
    <div ref={containerRef} className="terminal-host">
      {/* xterm 挂在这层，不是 host——host 底部还有输入框，xterm 会把自己撑满 */}
      <div ref={screenRef} className="terminal-screen" />
      {/* 麦克风在输入框里面（右侧），不再单独绝对定位——两者曾在右下角叠成一团 */}
      <TerminalInput ptyId={ptyId} leafId={leafId} onFocusTerm={() => termRef.current?.focus()} />
      <SecretBadge ptyId={ptyId} scale={canvasScale} />
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
