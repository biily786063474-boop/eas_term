// 灵动岛：屏幕顶部常驻的状态胶囊窗口。
//
// 它是**第二个渲染进程**，独立 HTML 入口、独立精简 preload，不复用主窗口的渲染树。
// 这么分的理由：这个窗口的存在前提正是「主窗口不在前台」——最小化时主窗口的渲染树
// 是否还在正常跑不该由它来赌。主进程在中间做转发，两边谁挂了都不牵连对方。
//
// 状态永远只有一份，在主窗口的 zustand 里。这里只存「最后收到的那帧快照」用于新窗口首帧，
// 绝不在主进程里二次加工——两处算同一件事，迟早算出两个结果。
import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import path from 'path'
import { execFile } from 'child_process'
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
/** 同理，Dock 菜单内容的去重 */
let lastDockLine = ''
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
    foreground: mainInForeground(),
    notch: notchOf(screen.getPrimaryDisplay())
  })
}

/** 前台被「手动叫出来」之后留多久。
 *  只有 Dock 菜单的「显示灵动岛」会用到 —— 前台不再自动弹窗，见 shouldShow。 */
const FG_NOTICE_MS = 20_000
/** 手动唤出的截止时刻（epoch ms）。0 = 没人叫过它 */
let fgUntil = 0
/** 用户把岛展开着在读 —— 这期间不许收窗口。
 *  没有这个的话：前台的露面窗口期一到，正读着的列表会当着人的面消失。 */
let held = false
/** 已经为哪些通知露过面。不记的话每一帧推送都会重新开窗口期，等于常驻 */
const fgSeen = new Set<string>()
/** 窗口期到点后回来重算一次的定时器 */
let fgTimer: ReturnType<typeof setTimeout> | null = null

/** 记下哪些通知已经见过。
 *
 *  留着这张表是为了「同一个终端下一轮再完成时能重新算作新的」，
 *  它不再驱动任何弹窗行为（见函数体里的说明）。 */
function noteFreshNotices(): void {
  const ids = new Set(lastState.notices.map((n) => n.id))
  // 消失的通知要从记录里摘掉：同一个终端下一轮又完成时得能再触发一次
  for (const id of [...fgSeen]) if (!ids.has(id)) fgSeen.delete(id)

  // 只记「见过了」，**不再因为来了新通知就把窗口弹出来**。
  //
  // 曾经这里会给前台开一个 9 秒的露面窗口期，结果是：你正在软件里打字，
  // 一个任务跑完，屏幕顶上突然多出个窗口，macOS 顺手还把 Space 切了。
  // 前台的通知交给标题栏计数 + 提示音，那两样不抢你的窗口。
  lastState.notices.filter((n) => !fgSeen.has(n.id)).forEach((n) => fgSeen.add(n.id))
}

/** 窗口该不该在。
 *
 *  **你正在软件里干活时，这个窗口一概不出现** —— 连审批也不例外。
 *
 *  它是个 alwaysOnTop('screen-saver') + visibleOnFullScreen 的窗口，
 *  macOS 为了显示它会把你从当前 Space 拽走（全屏用的时候尤其明显，感觉像被强制切了窗口）。
 *  而你人就在屏幕前，通知根本不需要靠它送达：标题栏的待处理计数在闪、提示音在响、
 *  抽屉里那条在呼吸，够了。
 *
 *  只有两种情况前台也显示：你自己从 Dock 菜单点了「显示灵动岛」，
 *  或者你正把它展开着在读（held）—— 两者都是你主动要的，不是它自己蹦出来。 */
function shouldShow(): boolean {
  const hasContent = lastState.running.length > 0 || lastState.notices.length > 0
  if (mainInForeground()) {
    // hasContent 这一条别省：通知被处理光后只看窗口期，会留下一个空胶囊挂着
    return hasContent && (held || Date.now() < fgUntil)
  }
  if (lastState.notices.some((n) => n.kind === 'approval')) return true
  return hasContent
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
    // **macOS 必须配上 type:'panel'**，光有 focusable:false 不够。
    // 后者只管「别成为 key window」（不接管键盘），拦不住**点击激活整个 app** ——
    // 于是你在别的软件里干活、顺手点岛上的「知道了」，Eas-Term 整个跳到前台，
    // 主窗口糊你一脸。而这条通知你本来就只是想让它别再响，压根没打算切过来。
    // type:'panel' 让 Electron 建成 NSPanel + NonactivatingPanel 样式掩码，
    // 点击只送到窗口自己，app 的前后台状态一动不动。
    // 仅 macOS：Windows 上这个值不认，传了会被忽略，但没必要冒险。
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
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
  held = false
  // 退出路径上不播动画，直接收掉——这时候没人在看，动画只会拖慢退出
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  if (islandWin && !islandWin.isDestroyed()) islandWin.destroy()
  islandWin = null
}

export function registerIslandHandlers(): void {
  // 启动就摆一个空菜单：在第一帧状态推来之前右键 Dock 也不该是空的
  updateDockMenu()

  // app 级兜底：主窗口自己的 blur/focus 已经接了，但整个 app 失活这条路
  // （比如从没被激活过就被别的应用抢了焦点）走不到窗口事件上。
  app.on('browser-window-blur', nudgeIsland)
  app.on('browser-window-focus', (_e, win) => {
    // 点了岛以外的地方 → 让它收回去。
    // 岛是 focusable:false 的窗口，自己收不到 blur，只能由主进程在别的窗口拿到焦点时告诉它。
    // 这覆盖了最常见的那次点击：看完岛上的列表，回主窗口干活。
    if (!isIslandWindow(win) && islandWin && !islandWin.isDestroyed()) {
      islandWin.webContents.send('island:collapse')
    }
    nudgeIsland()
  })

  // 主窗口推状态（已在渲染层节流过）
  ipcMain.on('island:sync', (_e, state: IslandState) => {
    lastState = state && Array.isArray(state.running) ? state : EMPTY
    noteFreshNotices()
    reconcile()
    // 跟着内容走，不跟着焦点走：reconcile 会因为切窗口频繁触发，
    // 而菜单的内容只和任务状态有关，重建太勤会让右键菜单在打开时闪
    updateDockMenu()
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

  // 用户把岛展开着在读 → 别在这期间把窗口收走。
  // 折叠回去（或跳走）时会再发一次 false，前台的露面计时随即恢复。
  ipcMain.on('island:hold', (_e, v: boolean) => {
    const next = !!v
    if (next === held) return
    held = next
    // 松手时重新起算露面窗口期，否则「读完折叠」会立刻消失，显得很突兀
    if (!held && mainInForeground()) fgUntil = Date.now() + FG_NOTICE_MS
    reconcile()
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
    dispatchAction(action)
  })
}

/** 把一个动作送到主窗口执行。灵动岛和 Dock 菜单共用这一条路 ——
 *  两处各写一遍的话，「跳转前要不要先激活 app」这种细节迟早只在一处是对的。 */
function dispatchAction(action: IslandAction): void {
  const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isIslandWindow(w))
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
    // **窗口 focus 了，网页内容不一定 focus。** 只做 win.focus() 的话，
    // 键盘焦点可能还留在原处（甚至留在灵动岛那个 panel 上），
    // 页面里第一次点击就成了「先把焦点收回来」，点什么都像没反应。
    main.webContents.focus()
    // 上面这几行只改得动 Electron/Chromium 自己的记账，改不动 macOS 真正认定的
    // 「当前活跃 app」——见 verifyRealActivation 的注释，这是实测确认过的落差，
    // 不是猜测。放一个兜底核实，查不到时把 Dock 图标弹起来。
    if (process.platform === 'darwin') verifyRealActivation(main)
  }
  main.webContents.send('island:action', action)
}

/** macOS 对「后台进程自己把自己切到前台」有一套不透明的节流，实测（osascript 反复触发
 *  + 轮询系统真实前台 app 对照）确认过：哪怕完全绕开灵动岛、在主进程里直接连续调
 *  `app.focus({steal:true})` + `win.focus()`，WindowServer 认定的「真正活跃的 app」
 *  也经常压根没跟着换——而 Electron 自己的 `isFocused()`、渲染层的 `document.hasFocus()`
 *  几乎立刻翻真。那一半只是本进程内部的 key-window 记账，不代表 OS 真的信了。
 *
 *  表现就是主窗口"看着"聚焦了（甚至可能已经盖在别的窗口上面），实际上鼠标键盘
 *  还在喂给切走前台的那个 app——点画布、点输入框都像没反应，直到用户自己做一次
 *  「显示所有窗口」之类的真实交互，把 WindowServer 的账强制对平。这正是 0.4.11 那两处
 *  改动（acceptFirstMouse / webContents.focus）没能修好的原因：那两处改的都是
 *  Electron/Chromium 自己的状态，而卡住的是更底层、这两处完全够不到的那一层。
 *
 *  Electron 自己的 API 问不出这个偏差（问它，只会用同一套失真的账回答你），
 *  这里退而求其次问操作系统本身：一次 osascript 大概 30~80ms，只在「灵动岛/Dock 菜单
 *  跳转」这个低频动作后触发一次，不是常驻轮询，开销可以接受。
 *
 *  **这不是一个"能保证修好"的补丁。** 实测过好几种候选（原地重复 focus、中间插延迟、
 *  `hide()+show()`……），没有一种能把成功率顶到接近 100%——这看起来是 macOS 侧的限制，
 *  不是这段代码单方面能彻底解决的事。两次尝试都没能确认真的切过来时，退而求其次弹一下
 *  Dock 图标：用户自己点 Dock 图标这条路走的是系统认可的真实交互，不受这层限制影响，
 *  实测里是唯一每次都成功的路径。 */
function verifyRealActivation(win: BrowserWindow, attempt = 0): void {
  setTimeout(() => {
    if (win.isDestroyed()) return
    // 拿自己进程的可执行文件名当基准，不用 app.getName()——那个读的是 package.json 的
    // name 字段，dev 模式下是 "eas-term"，而 macOS/System Events 认的是运行中的
    // .app 包名（dev 下是 "Electron"，打包后才是 "Eas-Term"），两者对不上会让这条
    // 核实在 dev 模式下永远判定「没切过来」，白触发一堆不必要的兜底动作。
    const self = path.basename(process.execPath)
    execFile(
      '/usr/bin/osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      (err, stdout) => {
        if (win.isDestroyed() || err) return // 查不到就算了，诊断本身不能变成新的故障源
        const front = stdout.trim()
        if (front === self) return // 真的切过来了，什么都不用做
        if (!app.isPackaged) {
          console.log(`[island] 真实前台没切过来（仍是 ${front}），第 ${attempt + 1} 次尝试`)
        }
        if (attempt === 0) {
          // hide() 再 show() 走的是和单纯 focus() 不同的内部路径（实测过：单纯重复
          // focus()/加延迟都没用，这个偶尔能成），成本很低，值得当第二次尝试搏一把。
          win.hide()
          win.show()
          win.webContents.focus()
          verifyRealActivation(win, attempt + 1)
          return
        }
        // 两次都没能把真前台掰过来：弹 Dock 图标兜底。'critical' 会一直弹到用户自己
        // 点过来（那一下是真实交互，保真切换）或应用真的拿到前台为止，不会无限打扰。
        app.dock?.bounce('critical')
      }
    )
  }, 200)
}

/** 粗粒度时长，只给人扫一眼。主进程这边不引渲染层那份 fmtDur —— 
 *  为一个函数把渲染层的模块拉进主进程不划算。 */
function briefDur(ms?: number): string {
  if (!ms || ms < 0) return ''
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m${String(sec % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** Dock 图标的右键菜单：不进主窗口也能看清「谁完成了、谁还在跑」，点一条直接过去。
 *
 *  为什么要有它：灵动岛在主窗口前台时只露面几秒，退场之后想再看一眼就没有入口了 ——
 *  而点 Dock 图标（macOS 的系统行为）只会把主窗口拽出来，把岛顶掉。
 *  右键菜单是 macOS 上「不打断当前工作，瞄一眼后台任务」的标准位置。 */
function updateDockMenu(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const items: Electron.MenuItemConstructorOptions[] = []

  for (const n of lastState.notices) {
    const ptyId = n.id.split(':')[0]
    const tag = n.kind === 'approval' ? '等审批' : '已完成'
    items.push({
      label: `● ${n.project} · ${tag}${n.kind === 'done' && n.roundMs ? ' · ' + briefDur(n.roundMs) : ''}`,
      click: () => dispatchAction({ type: 'focus', key: ptyId })
    })
  }
  for (const r of lastState.running) {
    items.push({
      label: `○ ${r.project} · 跑了 ${briefDur(Date.now() - r.startedAt)}`,
      click: () => dispatchAction({ type: 'focus', key: r.key })
    })
  }
  if (!items.length) items.push({ label: '没有任务在跑', enabled: false })

  // 「显示灵动岛」：岛退场之后把它叫回来。没内容时给它禁用掉 ——
  // 能点但点了什么都不出现，比灰着更让人困惑。
  items.push({ type: 'separator' })
  items.push({
    label: '显示灵动岛',
    enabled: lastState.notices.length > 0 || lastState.running.length > 0,
    click: () => {
      fgUntil = Date.now() + FG_NOTICE_MS
      // 到点自己回来收摊：前台不会再有别的状态推送来触发回收，
      // 没这一下的话手动叫出来的窗口会一直挂着
      if (fgTimer) clearTimeout(fgTimer)
      fgTimer = setTimeout(() => {
        fgTimer = null
        reconcile()
      }, FG_NOTICE_MS + 100)
      reconcile()
    }
  })

  app.dock.setMenu(Menu.buildFromTemplate(items))
  // 菜单本身没法从外面读（AppleScript 要辅助访问权限），出问题时靠这条对
  if (!app.isPackaged) {
    const line = items.map((i) => i.label ?? '—').join(' | ')
    if (line !== lastDockLine) {
      lastDockLine = line
      console.log('[island] dock menu:', line)
    }
  }
}
