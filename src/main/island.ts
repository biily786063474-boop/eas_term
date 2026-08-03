// 灵动岛：屏幕顶部常驻的状态胶囊窗口。
//
// 它是**第二个渲染进程**，独立 HTML 入口、独立精简 preload，不复用主窗口的渲染树。
// 这么分的理由：这个窗口的存在前提正是「主窗口不在前台」——最小化时主窗口的渲染树
// 是否还在正常跑不该由它来赌。主进程在中间做转发，两边谁挂了都不牵连对方。
//
// 状态永远只有一份，在主窗口的 zustand 里。这里只存「最后收到的那帧快照」用于新窗口首帧，
// 绝不在主进程里二次加工——两处算同一件事，迟早算出两个结果。
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import type { IslandAction, IslandState } from '../shared/types'

const EMPTY: IslandState = { running: [], notices: [] }

/** 退场动画时长，必须和 island.css 里 `.isl-shell.leaving` 的 animation-duration 一致。
 *  改一处忘了另一处的表现：要么窗口在动画播完前被抽走（看到半截），
 *  要么动画早结束了窗口还空挂着。 */
const LEAVE_MS = 160

let islandWin: BrowserWindow | null = null
let lastState: IslandState = EMPTY
/** 渲染层量出来的内容尺寸；没量到之前用这个保底，避免首帧一个巨大的透明窗糊在屏幕上 */
let contentSize = { w: 190, h: 30 }
/** 退场倒计时。非空 = 正在播退场动画，此时窗口还活着但已判定要关 */
let leaveTimer: ReturnType<typeof setTimeout> | null = null
/** 上一条诊断日志，用于去重（见 reconcile） */
let lastLogLine = ''
/** 屏幕几何只在第一次开窗时打一条 */
let loggedDisplay = false

/** 主窗口 = 除灵动岛之外的那个窗口 */
function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isIslandWindow(w)) ?? null
}

/** 主窗口在不在前台。
 *
 *  **实时查，不维护镜像状态。** 一开始这里存的是一个 `mainForeground` 布尔量、
 *  靠 focus/blur 事件维护——结果是：app 启动时若焦点被别的应用抢走，
 *  窗口从来没 focus 过，也就永远不会 blur，那个布尔量就永久卡在 true，
 *  灵动岛一次都不出现。事件只配触发重算，不配当事实来源。 */
function mainInForeground(): boolean {
  const w = mainWindow()
  if (!w) return false // 主窗口没了，谈不上在前台
  return w.isFocused() && !w.isMinimized() && w.isVisible()
}

/** 推一帧给灵动岛。刘海尺寸随状态一起发——渲染层要按它留出中间那块透明区，
 *  分成两条消息的话会有一帧「耳朵还没让开、正压在刘海上」。 */
function pushState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('island:state', {
    ...lastState,
    notch: notchOf(screen.getPrimaryDisplay())
  })
}

/** 窗口该不该在：不在前台 且 确实有东西可报。两者缺一，窗口就该整个销毁。 */
function shouldShow(): boolean {
  if (mainInForeground()) return false
  return lastState.running.length > 0 || lastState.notices.length > 0
}

/** 刘海几何。Electron 没有 safeAreaInsets，这里靠两个信号推：
 *
 *  1. **有没有刘海**看屏幕宽高比。带刘海的内置屏因为把刘海那条也算进了 bounds，
 *     比例会低于 16:10 —— 14" 是 3024×1964(1.540)、16" 是 3456×2234(1.547)，
 *     而任何非刘海屏都 ≥1.6（16:10 / 16:9 / 超宽）。比「菜单栏高不高」可靠得多：
 *     菜单栏高度会随缩放档变（这台在 1147×745 档下只有 26pt），拿它当判据必然误判。
 *  2. **刘海多宽**按屏幕宽度取 13.5%。实测 14"/16" 都在 12.3%~12.6%，
 *     取略大一点是刻意的——宁可两侧内容离刘海远一点，也不要压在它边缘上。
 *
 *  拿不准的时候一律当没有刘海：那条路径（挂在菜单栏下方）在任何机器上都能看。 */
function notchOf(display: Electron.Display): { w: number; h: number } {
  if (process.platform !== 'darwin') return { w: 0, h: 0 }
  const { bounds, workArea } = display
  const hasNotch = bounds.height > 0 && bounds.width / bounds.height < 1.58
  if (!hasNotch) return { w: 0, h: 0 }
  return {
    w: Math.round(bounds.width * 0.135),
    // 菜单栏高度就是刘海高度——刘海机的菜单栏正是被刘海撑起来的
    h: Math.max(0, workArea.y - bounds.y)
  }
}

/**
 * 摆窗口。
 *
 * 有刘海 → **贴屏幕物理上沿**（y = bounds.y），内容分居刘海两侧，中间那块透明留给刘海。
 * 一开始这里贴的是 workArea 上沿（菜单栏下方），看着就是"悬在刘海下面的一条"，
 * 而不是"刘海长出来的东西"——灵动岛的形态感全在贴边这件事上。
 *
 * 没刘海 → 仍挂菜单栏下方：那种屏幕贴顶会压住菜单栏，得不偿失。
 */
function placeWindow(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay()
  const { bounds, workArea } = display
  const notch = notchOf(display)
  // 只在开窗那次打一条：「灵动岛位置不对 / 被刘海挡住」的报告，
  // 十有八九能从这条看出是几何判断错了还是别的问题。
  if (!app.isPackaged && !loggedDisplay) {
    loggedDisplay = true
    console.log(
      '[island] display',
      JSON.stringify({
        bounds,
        workArea,
        aspect: +(bounds.width / bounds.height).toFixed(3),
        notch,
        scale: display.scaleFactor
      })
    )
  }
  const w = Math.round(contentSize.w)
  const h = Math.round(contentSize.h)
  win.setBounds(
    {
      // 按屏幕中线居中，不是按 workArea——刘海是相对物理屏幕居中的
      x: Math.round(bounds.x + (bounds.width - w) / 2),
      y: notch.w > 0 ? bounds.y : workArea.y + 4,
      width: w,
      height: h
    },
    false // 不要动画：顶部是常驻区，每次内容变化都滑一下很烦
  )
}

function createIsland(): BrowserWindow {
  const win = new BrowserWindow({
    ...contentSize,
    // 先不显示，加载完再 showInactive()。
    //
    // **这一条不能省。** 默认的 show:true 在创建窗口的同时会把整个 app 激活，
    // 于是主窗口重新拿到焦点 → 判定「在前台」→ 灵动岛立刻被销毁 → 焦点又还回去
    // → 再次创建……自己把自己关掉的死循环，实测日志里就是 hasWin 在 true/false 之间跳。
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // 不抢焦点：卡片弹出来时你可能正在别的 app 里打字，绝不能把光标抢走。
    // macOS 上 focusable:false 的窗口照样收得到鼠标点击，只是不接管键盘。
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    // 允许窗口越过屏幕可见区。macOS 默认会把窗口「顶」回菜单栏下方
    // （AppKit 的 constrainFrameRect），实测 setBounds 到 y=0 会被悄悄改成 y=26 ——
    // 那就等于回到「悬在刘海下面」，贴边这件事根本做不成。
    enableLargerThanScreen: true,
    // 关掉 macOS 给无边框窗口自动加的圆角。开着的话**四个角**都会被抹圆，
    // 贴屏幕上沿的那两个角就会各露出一小片壁纸，看着像没贴住。
    // 圆角改由 CSS 控制（只圆下面两个），才能真正贴到屏幕边缘。
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/island.js'),
      // 和主窗口同理：它要在后台持续走秒、收推送，被 Chromium 节流就成了假状态
      backgroundThrottling: false
    }
  })

  // screen-saver 层级：盖得住全屏应用。普通 alwaysOnTop 在别人全屏时会被压下去，
  // 而「你切走了」恰恰常常意味着「你在全屏的编辑器里」。
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/island.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/island.html'))
  }

  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    placeWindow(win) // 创建时给的只是尺寸，位置还得摆一次
    win.showInactive() // 显示但不激活 app —— 用 show() 会把焦点从用户正在用的应用抢过来
    pushState(win)
  })
  win.on('closed', () => {
    if (islandWin === win) islandWin = null
  })
  return win
}

/** 按当前状态决定「开窗 / 关窗 / 推送」。所有入口最终都汇到这里，只有这一处能改窗口存亡。 */
function reconcile(): void {
  // dev 诊断：「灵动岛怎么没出来」的原因全在这一行里，省得下次又一处处加探针
  // （判定链路横跨两个进程，光看现象猜不出来——「窗口自己把自己关掉」这个 bug
  // 就是靠它一眼看出来的）。只在判定结果变化时打，否则 250ms 一条会淹掉别的日志。
  if (!app.isPackaged) {
    const w = mainWindow()
    const line = JSON.stringify({
      show: shouldShow(),
      focused: w?.isFocused() ?? null,
      minimized: w?.isMinimized() ?? null,
      visible: w?.isVisible() ?? null,
      running: lastState.running.length,
      notices: lastState.notices.length,
      hasWin: !!islandWin
    })
    if (line !== lastLogLine) {
      lastLogLine = line
      console.log('[island]', line)
    }
  }
  if (shouldShow()) {
    if (!islandWin || islandWin.isDestroyed()) {
      islandWin = createIsland()
      return // 首帧走 did-finish-load，这里推了也收不到
    }
    // 正在播退场动画的当口又要显示（切走一下马上切回来）→ 撤销这次关闭，
    // 让它原地淡回来。不撤的话会看到「刚消失又重新垂下来」闪一下。
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = null
      islandWin.webContents.send('island:enter')
    }
    // 只推数据，不重摆窗口：位置/尺寸由 island:resize 驱动（内容变了才动），
    // 在这里跟着每帧推送一起 setBounds 会让窗口每 250ms 抖一次。
    pushState(islandWin)
  } else if (islandWin && !islandWin.isDestroyed() && !leaveTimer) {
    // 不能直接 destroy —— 那样窗口是「啪」地消失的。先让渲染层播退场动画，
    // 到点再销毁。窗口销毁是主进程的事，动画是渲染层的事，中间只能靠这个时间差对齐：
    // 多给 60ms 余量，宁可多挂一会儿，也别在动画播完前就把窗口抽走（会看到半截）。
    islandWin.webContents.send('island:leave')
    const win = islandWin
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      if (!win.isDestroyed()) win.destroy()
      if (islandWin === win) islandWin = null
    }, LEAVE_MS + 60)
  }
}

/** 主窗口前台状态可能变了 → 重算一次。传不传值都行，实际状态现查（见 mainInForeground）。
 *  focus/blur/minimize/restore 全汇到这里。 */
export function nudgeIsland(): void {
  reconcile()
}

/** 灵动岛是不是这个窗口——`window-all-closed` / `activate` 里要排除它，
 *  否则它会被当成「还有窗口开着」，主窗口关了 app 也不退。 */
export function isIslandWindow(win: BrowserWindow): boolean {
  return islandWin !== null && win === islandWin
}

export function destroyIsland(): void {
  // 退出路径上不播动画，直接收掉——这时候没人在看，动画只会拖慢退出
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  if (islandWin && !islandWin.isDestroyed()) islandWin.destroy()
  islandWin = null
}

export function registerIslandHandlers(): void {
  // app 级兜底：主窗口自己的 blur/focus 已经接了，但整个 app 失活这条路
  // （比如从没被激活过就被别的应用抢了焦点）走不到窗口事件上。
  app.on('browser-window-blur', nudgeIsland)
  app.on('browser-window-focus', nudgeIsland)

  // 主窗口推状态（已在渲染层节流过）
  ipcMain.on('island:sync', (_e, state: IslandState) => {
    lastState = state && Array.isArray(state.running) ? state : EMPTY
    reconcile()
  })

  // 审批框没认全时，把当时的屏幕原样记一条。
  //
  // 这段解析读的是画给人看的 TUI，claude/codex 换个边框样式它就瞎了——
  // 而「瞎了」的表现只是灵动岛少给几个按钮，不报错、不崩，光看现象根本不知道
  // 是没认出来还是本来就没框。有了样本，下次调正则有据可依。
  ipcMain.on('island:parselog', (_e, reason: string, sample: string[]) => {
    if (app.isPackaged) return
    console.log(`[island] 解析样本(${reason}):\n` + sample.map((l) => '  | ' + l).join('\n'))
  })

  // 灵动岛挂载好了 → 补推一次当前状态（首帧的时序保险，见 preload/island.ts 的 ready）
  ipcMain.on('island:ready', () => {
    if (islandWin && !islandWin.isDestroyed()) pushState(islandWin)
  })

  // 灵动岛量完自己有多大 → 主进程照着摆。让渲染层说了算，
  // 这样调 UI 尺寸不用回来改主进程的魔法数字。
  ipcMain.on('island:resize', (_e, w: number, h: number) => {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40 || h < 16) return
    contentSize = { w: Math.min(760, w), h: Math.min(420, h) }
    if (islandWin && !islandWin.isDestroyed()) placeWindow(islandWin)
  })

  // 灵动岛的点击 → 转给主窗口执行（聚焦某个 session / 关掉某条通知）。
  // 主进程不自己解释这个动作：ptyId 到底落在哪个 tab、哪个画布节点，只有渲染层知道。
  ipcMain.on('island:action', (_e, action: IslandAction) => {
    if (!app.isPackaged) console.log('[island] action', JSON.stringify(action))
    const main = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && !isIslandWindow(w)
    )
    if (!main) return
    if (action?.type === 'focus') {
      // 跳转意味着「我来处理了」→ 主窗口必须回到前台，否则点了没反应。
      // 顺序有讲究：先把 app 整体激活，再聚焦具体窗口。反过来的话，
      // win.focus() 在 app 还不是 active application 时只是把它设成 key window，
      // 用户屏幕上什么都不会发生。
      if (main.isMinimized()) main.restore()
      if (!main.isVisible()) main.show()
      app.focus({ steal: true })
      main.moveTop()
      main.focus()
    }
    main.webContents.send('island:action', action)
  })
}
