import { useEffect } from 'react'
import { useStore, serializeCanvas } from './store'
import { collectLeaves } from './layout'
import { Sidebar } from './features/workspace/Sidebar'
import { TabBar } from './features/workspace/TabBar'
import { TerminalAttention } from './features/workspace/TerminalAttention'
import { QuotaBar, QuotaBarToggle } from './features/quota/QuotaBar'
import { McpIndicator } from './features/workspace/McpIndicator'
import { FootprintPanel } from './features/workspace/FootprintPanel'
import { SecretsPanel } from './features/workspace/SecretsPanel'
import { SettingsPanel } from './features/workspace/SettingsPanel'
import { UpdateBadge } from './features/workspace/UpdateBadge'
import { SecretRequestHost } from './features/workspace/SecretRequestModal'
import { TeamBatchHost } from './features/team/TeamBatchModal'
import { TeamAutoTuckHost } from './features/team/AutoTuck'
import { AgentOnboarding } from './features/workspace/AgentOnboarding'
import { ModeSwitch } from './features/workspace/ModeSwitch'
import { ArchivePlanPanel } from './features/wiki/ArchivePlanPanel'
import { PaneLayer } from './features/workspace/PaneLayer'
import { CanvasStage } from './features/canvas/CanvasStage'
import { CanvasShapeLayer } from './features/canvas/CanvasShapeLayer'
import { BoardStage } from './features/board/BoardStage'
import { GanttStage } from './features/gantt/GanttStage'
import { GanttErrorBoundary } from './features/gantt/GanttErrorBoundary'
import { CanvasDrawer } from './features/canvas/CanvasDrawer'
import { CanvasWikiDrawer } from './features/canvas/CanvasWikiDrawer'
import { CanvasDictBubble } from './features/canvas/CanvasDictBubble'
import { DictBubbleToggle } from './features/canvas/DictBubbleToggle'
import { useIslandFeed } from './features/status/useIslandFeed'
import { useNoticeSound } from './features/notify/useNoticeSound'
import { useEdgeGlow } from './ui/motion/useEdgeGlow'
import './ui/motion/glow.css'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Tooltip } from './ui/Tooltip'
import { BuildStamp } from './ui/BuildStamp'
import { FolderIcon } from './ui/Icons'

export function App(): JSX.Element {
  // 灵动岛：把运行/待处理状态推给屏幕顶部那个独立窗口。
  // 放在 App 顶层而不是某个视图里——它跟分屏/画布哪个视图开着无关，两种模式都要报。
  useIslandFeed()
  // 有任务完成 / 等审批时播提示音。和视图模式无关，分屏画布都响
  useNoticeSound()
  // 卡片的边缘光晕跟随鼠标。一个全局监听服务所有卡片，不经过 React（见 useEdgeGlow）
  useEdgeGlow()
  const tabs = useStore((s) => s.tabs)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const loadProjects = useStore((s) => s.loadProjects)
  const loadCanvas = useStore((s) => s.loadCanvas)
  const loadRoles = useStore((s) => s.loadRoles)
  const openTerminal = useStore((s) => s.openTerminal)
  const addProject = useStore((s) => s.addProject)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const wikiDrawerOpen = useStore((s) => s.wikiDrawerOpen)
  const resDrawerOpen = useStore((s) => s.resDrawerOpen)

  // 启动：先载项目（画布 Frame 引用 projectId），再恢复画布场景；恢复完成后才挂保存订阅，
  // 避免空画布把持久化文件覆盖掉。之后画布/viewMode 变化防抖 500ms 落盘。
  // 关键：改动后 500ms 才落盘 → 若「改完就退/切走」这段没落盘会丢(如刚选的思考/模型档)。
  // 故失焦(blur)异步 flush、退出/刷新(beforeunload)同步 flush，杜绝这类丢失。
  useEffect(() => {
    let unsub = (): void => {}
    let timer: number | undefined
    let dirty = false // 有未落盘的画布改动

    const buildScene = (): unknown => {
      const st = useStore.getState()
      // 按 leafId 取该 leaf 当前 pane（供序列化区分「终端」与「被切成图片/代码/网页的节点」）
      const leafPaneOf = (leafId: string) => {
        for (const t of st.tabs) {
          const leaf = collectLeaves(t.root).find((l) => l.id === leafId)
          if (leaf) return leaf.pane
        }
        return undefined
      }
      return serializeCanvas(st.canvas, st.viewMode, leafPaneOf, st.viewModePicked)
    }
    const flush = (sync = false): void => {
      if (!dirty) return
      dirty = false
      clearTimeout(timer)
      const scene = buildScene()
      if (sync) {
        // **看返回值。** 这条路是退出/刷新前最后一次机会，写失败就意味着
        // 这一整场画布改动没了。以前 saveSync 无条件回 true，失败时
        // 无提示、无日志（.plans/silent-fail S-08）。beforeunload 里弹不了窗，
        // 但至少要在控制台留下痕迹 —— 主进程那边还会把这次的场景
        // 另存成 canvas.json.emergency。
        if (!window.api.canvas.saveSync(scene)) {
          console.error('[canvas] 退出前保存失败：这次的改动可能没落盘，找 canvas.json.emergency')
        }
        // dirty 已经在上面清掉了，这里不回滚 —— 重新标脏也没有下一次机会跑，
        // 退出流程不会因为它再触发一遍。
      } else void window.api.canvas.save(scene)
    }
    const onBlur = (): void => flush(false) // 失焦：还有时间，异步落盘
    const onBeforeUnload = (): void => flush(true) // 退出/刷新：同步落盘，阻塞到写完

    void (async () => {
      // 启动加载失败也不能吞掉后续:务必挂上保存订阅,否则整会话只出不进(数据不落盘)
      try {
        await loadProjects()
        await loadCanvas()
        // 两份都到齐了才能迁移：它要拿 canvas 的 frame.status 去写 projects
        await useStore.getState().migrateFrameStatus()
        void loadRoles() // 角色表：不阻塞首屏，读到就有
        void useStore.getState().loadBoardColumns() // 看板列定义，同上
      } catch (e) {
        console.error('[App:startup] 加载项目/画布失败', e)
      }
      unsub = useStore.subscribe((s, prev) => {
        if (s.canvas === prev.canvas && s.viewMode === prev.viewMode) return
        dirty = true
        clearTimeout(timer)
        timer = window.setTimeout(() => flush(false), 500)
      })
      // 开关是存在 localStorage 里的，主进程重启后默认 true —— 不同步一次的话，
      // 用户上次关掉的 MCP 在这次启动里对 /secret-env 仍然是「开」
      window.api.mcp.setEnabled(useStore.getState().mcpEnabled)
      window.addEventListener('blur', onBlur)
      window.addEventListener('beforeunload', onBeforeUnload)
    })()
    return () => {
      flush(true) // 卸载(如热更/切路由)前也落一次,别丢
      clearTimeout(timer)
      unsub()
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [loadProjects, loadCanvas])

  // 终端里的 CLI 调 `open <url>`（AI 工具弹网页等）被 open shim 劫持 → 这里在画板内嵌浏览器打开，
  // 而不是弹系统 Safari。没有任何画布 Frame 时才回落系统浏览器。
  useEffect(() => {
    return window.api.shell.onOpenInCanvas((url) => {
      const s = useStore.getState()
      const frame =
        s.canvas.frames.find((f) => !f.parentId && f.projectId === s.activeProjectId) ??
        s.canvas.frames.find((f) => !f.parentId)

      // **不把人踢去系统浏览器。**
      //
      // 原来「画布上没有 Frame」时会 openExternal，于是终端里的 CLI 一调 open，
      // Safari 就抢到前台 —— 你正打着字，整个应用被顶掉了。而这条路是自动触发的
      // （agent 跑着跑着自己调 open），不是你点了什么，所以格外突兀。
      //
      // 现在一律留在软件内：画布里有 Frame 就放进去，没有就在分屏开个网页面板。
      // 真想用系统浏览器，内嵌浏览器上有「在系统浏览器打开」。
      if (s.viewMode === 'canvas' && frame) {
        s.addWebNode(frame.id, url)
        return
      }
      if (s.viewMode === 'canvas') {
        // 画布模式但一个 Frame 都没有：分屏面板在画布下看不见，得先切回去
        s.setViewMode('split')
      }
      s.openWeb(url)
    })
  }, [])

  // MCP 开关：启动时把渲染层这份状态推给主进程对齐。
  //
  // **不推的话两侧会一直对不上**：渲染层这份从 localStorage 恢复（关过就一直是关的，
  // 那是刻意的——见 uiSlice.setMcpEnabled 的注释），而主进程那份是硬编码
  // `let mcpEnabled = true`，且只在用户**手动拨动开关**时才收到同步。于是
  // 「上次关了 MCP → 这次重开软件」= 渲染层照旧拒绝所有工具调用，主进程却以为开着。
  //
  // 方向还是危险的那一侧：主进程那份正是 `/secret-env`（密钥注入）的闸门，
  // setMcpEnabled 的注释明写了同步给主进程就是为了让它也能被关掉，
  // 而这条路在启动时是断的——界面显示「已关闭」，密钥注入却仍被放行。
  //
  // 主进程的默认值保持 true 不动：它是「还没收到同步时」的取值，而终端由渲染层创建，
  // 渲染层挂载之前不可能有人来调 /secret-env，这个窗口期是空的。改成 false 反而会
  // 让启动早期的密钥注入偶发失败。
  useEffect(() => {
    window.api.mcp.setEnabled(useStore.getState().mcpEnabled)
  }, [])

  // 全局快捷键：mac 用 ⌘、Windows/Linux 用 Ctrl。T 新终端、W 关面板、D 右分屏、⇧D 下分屏、1-9 切标签
  useEffect(() => {
    const isMac = window.api.platform === 'darwin'
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isMac ? !e.metaKey : !e.ctrlKey) return
      const s = useStore.getState()
      // 画布模式有自己的 ⌘D/Delete（复制/删除选中），不走分屏标签快捷键
      if (s.viewMode !== 'split') return
      const key = e.key.toLowerCase()
      if (key === 't') {
        e.preventDefault()
        void s.openTerminal({})
      } else if (key === 'w') {
        e.preventDefault()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab) void s.closeLeafSafely(tab.id, tab.activeLeafId)
      } else if (key === 'd') {
        e.preventDefault()
        const tab = s.tabs.find((t) => t.id === s.activeTabId)
        if (tab) void s.splitLeaf(tab.id, tab.activeLeafId, e.shiftKey ? 'column' : 'row')
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const projectTabs = s.tabs.filter((t) => t.projectId === s.activeProjectId)
        if (projectTabs[idx]) {
          e.preventDefault()
          s.setActiveTab(projectTabs[idx].id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  // 当前项目是否有标签；没有则显示空状态（其他项目的标签仍挂载但隐藏）
  const hasProjectTabs = tabs.some((t) => t.projectId === activeProjectId)

  // 兜底：任何「设计上不该滚」的容器被滚了就复位。
  //
  // 主力防线是 CSS 的 `overflow: clip`（见 .tab-stack / #root / .canvas-viewport）——
  // 它不产生滚动端口，程序性滚动根本无从发生。这里是第二道，防的是还没改到 clip、
  // 或者以后新加的容器。
  //
  // 背景：`overflow: hidden` **不阻止程序性滚动**。浏览器在退出 HTML5 全屏、
  // focus()、scrollIntoView() 时会去滚祖先滚动容器，画布世界比视口大得多
  // （实测可滚 4700x7100），一滚整块 UI 就顶上去、顶部被裁，而 viewport 状态没变，
  // 用户平移也拉不回来。
  //
  // **判据是结构性的，不再枚举选择器。** 上一版写的是白名单
  // （.canvas-viewport, .canvas-world, .pane-layer, .app, #root），
  // 漏掉了夹在中间的 .tab-stack —— 于是同一个毛病复发了一次。
  // 白名单这种东西，漏一个就复发一次；「overflow 是 hidden 却被滚了」才是问题本身。
  useEffect(() => {
    // 判过一次就记住：正常滚动容器（终端、看板列、文件树）每帧都在触发 scroll，
    // 每次都 getComputedStyle 太浪费
    const verdict = new WeakMap<HTMLElement, boolean>()
    const neverScrolls = (el: HTMLElement): boolean => {
      let v = verdict.get(el)
      if (v === undefined) {
        const cs = getComputedStyle(el)
        v = /hidden|clip/.test(cs.overflowX) && /hidden|clip/.test(cs.overflowY)
        verdict.set(el, v)
      }
      return v
    }
    const onScroll = (e: Event): void => {
      const t = e.target
      // 文档级滚动的 target 是 **document 而不是元素** —— 上一版的
      // `instanceof HTMLElement` 判断会把这种情况整个放过
      if (t === document || t === document.documentElement || t === document.body) {
        if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
        return
      }
      if (!(t instanceof HTMLElement)) return
      // 先看便宜的：没被滚就什么都不用做（绝大多数事件走到这里就结束）
      if (!t.scrollTop && !t.scrollLeft) return
      if (!neverScrolls(t)) return
      t.scrollTop = 0
      t.scrollLeft = 0
    }
    // 捕获阶段：scroll 不冒泡，只有 capture 能听到子元素的
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  return (
    <div
      className={`app${viewMode === 'canvas' ? ' canvas' : ''}${viewMode === 'board' ? ' board-mode' : ''}${wikiDrawerOpen ? ' wiki-open' : ''}${resDrawerOpen ? ' res-open' : ''}`}
    >
      <div className="titlebar">
        {viewMode === 'split' && activeProject ? (
          <div className="titlebar-project" data-tip={activeProject.path}>
            <FolderIcon size={14} className="titlebar-project-icon" />
            <span className="titlebar-project-name">{activeProject.name}</span>
            <span className="titlebar-project-path">{activeProject.path}</span>
          </div>
        ) : (
          <span className="titlebar-title">Eas-Term</span>
        )}
        <div className="titlebar-actions">
          {/* 待处理铃铛：画布有自己的运行监视窗，看板没有 —— 这里给它补上，
              不然看板模式下「哪个终端在等你」只剩卡片上一个小点 */}
          {viewMode !== 'canvas' && <TerminalAttention />}
          <QuotaBarToggle />
          <McpIndicator />
          <DictBubbleToggle />
          <FootprintPanel />
          {/* 挨着「扩展能力」放：两者是同类，都在讲「这软件在你机器上存了什么」 */}
          <SecretsPanel />
          {/* 常驻但平时不渲染任何东西，AI 调 request_secret 时才弹出来 */}
          <SecretRequestHost />
      <TeamBatchHost />
          {/* 不渲染任何东西，只负责把干完活的 agent 会话窗口收起来。
              常驻是必需的：写在团队面板里的话，面板关着就不工作，
              而没在看面板的时候恰恰最需要它 */}
          <TeamAutoTuckHost />
          <ModeSwitch />
          {/* 平时不渲染，只有查到新版本才冒出来 */}
          <UpdateBadge />
          {/* 设置摆在最右：全局的东西，两种视图模式下都在同一个位置 */}
          <SettingsPanel />
        </div>
      </div>
      <div className="body">
        {viewMode === 'split' && <Sidebar />}
        <main className="main">
          {viewMode === 'split' && <TabBar />}
          <div className="tab-stack">
            {viewMode === 'split' && !hasProjectTabs && (
              <div className="empty-state">
                <div className="empty-card">
                  <div className="empty-title">没有打开的终端</div>
                  {projects.length === 0 ? (
                    <button className="primary-btn" onClick={() => void addProject()}>
                      添加项目文件夹
                    </button>
                  ) : (
                    <button className="primary-btn" onClick={() => void openTerminal({})}>
                      在 {activeProject?.name ?? '主目录'} 打开终端
                    </button>
                  )}
                  <div className="empty-hint">
                    <span>⌘T 新建终端 · ⌘D 分屏 · ⌘W 关闭面板</span>
                    <span>点击文件树中的文件即可预览代码 / 图片</span>
                    <span>每个面板左上角的下拉框可切换：终端 / 代码预览 / 图片预览</span>
                  </div>
                </div>
              </div>
            )}
            {viewMode === 'canvas' && <CanvasStage />}
            <QuotaBar />
            {viewMode === 'gantt' && (
              // 独立边界：甘特图渲染或数据崩溃只掉这一块，不连累根级边界把整个
              // App（含 PaneLayer 里的终端）一起卸载。见 GanttErrorBoundary.tsx 顶部注释。
              <GanttErrorBoundary>
                <GanttStage />
              </GanttErrorBoundary>
            )}
            {viewMode === 'board' && <BoardStage />}
            <PaneLayer />
            {/* 标记层必须在 PaneLayer 之后：它要压在活终端之上（见 CanvasShapeLayer 顶部注释） */}
            <CanvasShapeLayer />
            {/* 三个抽屉/浮层跟着画布一起给看板 —— 看板也是「在项目里干活」的视图，
                在这儿想查知识库、看文件信息的需求和画布里没有区别 */}
            {viewMode !== 'split' && <CanvasDrawer />}
            {viewMode !== 'split' && <CanvasWikiDrawer />}
            {viewMode !== 'split' && <CanvasDictBubble />}
          </div>
        </main>
      </div>
      <ConfirmDialog />
      <AgentOnboarding />
      <ArchivePlanPanel />
      <Tooltip />
      <BuildStamp />
    </div>
  )
}
