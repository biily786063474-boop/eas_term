// 灵动岛：屏幕顶部常驻的状态胶囊窗口。
//
// 它是**第二个渲染进程**，独立 HTML 入口、独立精简 preload，不复用主窗口的渲染树。
// 这么分的理由：这个窗口的存在前提正是「主窗口不在前台」——最小化时主窗口的渲染树
// 是否还在正常跑不该由它来赌。主进程在中间做转发，两边谁挂了都不牵连对方。
//
// 状态永远只有一份，在主窗口的 zustand 里。这里只存「最后收到的那帧快照」用于新窗口首帧，
// 绝不在主进程里二次加工——两处算同一件事，迟早算出两个结果。
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import type { IslandAction, IslandState } from '../shared/types'
import { getPrefs, setPref } from './prefs'

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
/** 崩溃后自动重建的节流时刻。参照 index.ts 里 reloadWindowThrottled 的同款 3s 节流——
 *  没有它，一旦渲染进程反复崩（比如某种系统性故障），会变成"建→崩→建→崩"的死循环。 */
let lastCrashRecreateAt = 0

/**
 * 主窗口（排除灵动岛）——全仓库找「主窗口」都应该走这一个函数。
 *
 * 这个 app 同时挂着两扇 `BrowserWindow`：主窗口（整个应用界面）和灵动岛
 * （屏幕顶部常驻状态胶囊，独立 HTML 入口 + 独立精简 preload，见文件顶部说明）。
 * 灵动岛的建出条件是「有终端在跑 或 有待处理通知」（见下面 shouldShow）——
 * 也就是说用户日常使用中它几乎总是存在，`getAllWindows()` 几乎总是回两个。
 *
 * 数组里谁排第几只取决于创建顺序，不代表语义。任何不排除灵动岛的
 * `getAllWindows().find(...)` / `getAllWindows()[0]`，在灵动岛不存在时侥幸能跑对，
 * 一旦它建出来就是在赌数组顺序——而灵动岛的 preload 是独立的精简版，
 * 认错窗口的调用方（比如 mcpBridge 把 IPC 发过去）只会一直等到超时，
 * 且这个故障几乎只在「有终端在跑」时才触发，偏偏那正是它最该好用的时候。
 */
export function mainWindow(): BrowserWindow | null {
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
    notch: notchOf(screen.getPrimaryDisplay()),
    mini: getPrefs().islandMini
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
  // 收成圆点时挪到**刘海左边**，不再居中 —— 居中的话那颗点正好被刘海盖住。
  // 没刘海的屏幕（外接显示器）没有可让的位置，就贴屏幕中线偏左一点，
  // 视觉上仍是「在摄像头那一侧」。
  const mid = bounds.x + bounds.width / 2
  const x = getPrefs().islandMini
    ? Math.round(mid - (notch.w > 0 ? notch.w / 2 : 60) - w - 8)
    : Math.round(bounds.x + (bounds.width - w) / 2)
  win.setBounds(
    {
      // 展开时按屏幕中线居中，不是按 workArea——刘海是相对物理屏幕居中的
      x,
      y: notch.w > 0 ? bounds.y : workArea.y + 4,
      width: w,
      height: h
    },
    false // 不要动画：顶部是常驻区，每次内容变化都滑一下很烦
  )
}

// ============================ 可观测性 ============================
//
// 背景：用户反馈过"灵动岛用着用着就只剩一行没样式的裸文字，也不知道报的什么错"——
// 查下来发现这扇窗口的渲染进程出任何事，主进程压根不接：did-fail-load / preload-error /
// console-message / render-process-gone 一个监听都没挂过，它出事时主进程日志里
// 不会有一个字。加上它是双击 .app 启动的，stdout 本来就无处可看（见 logIslandFatal）。
// 下面这一段专门补这个洞。

/** 致命错误落盘的文件名。只记"fatal"这一档（加载失败/崩溃/preload 报错/渲染层 console.error），
 *  不记 reconcile 那种每 250ms 一条的调试日志——那种密度的东西塞进同一个文件，
 *  用户想找的那一条会被冲得没法看。 */
const FATAL_LOG_FILE = 'island-error.log'
/** 封顶字节数。这台机器上岛可能常年不重建（有终端在跑就走不到 hide→destroy 这条自愈路径，
 *  见 shouldShow 的注释），日志得防着自己无限长大，而不是指望进程重启来清零。 */
const FATAL_LOG_CAP = 256_000

/** 灵动岛致命错误：写 console.error（`npm run dev` / 终端里跑 app 能看到）
 *  + 落盘一份（双击 .app 打开时终端输出根本无处可看，这是用户唯一能事后翻到的地方）。
 *  同步文件 I/O 是故意的——这条路径只在真出故障时走，不是 reconcile 那种热路径，
 *  没必要为了这个引入异步队列的复杂度。 */
/** 同一条错误连着刷屏时，只记一次 + 计数。
 *
 *  2026-08-21 排查时踩到：日志里同一个 SyntaxError 重复了十几遍，
 *  把真正有用的上下文挤出了封顶窗口，而它们本来就是同一次故障的回声。 */
let lastFatalKey = ''
let lastFatalCount = 0

/** 出故障那一刻，把「现场」一起记下来。
 *
 *  **只记一行错误是没法排查的**（2026-08-21 的教训）：用户拿来一条
 *  `Unexpected token '}' (island-xxx.js:1)`，而我把本地产物、asar 里的副本
 *  逐一检查过去，字节一致、语法全通过 —— 因为日志没说它当时**加载的是哪个文件、
 *  在不在、多大、哪个版本**。缺这些，剩下的只有猜。
 *
 *  收集本身要绝对安全：任何一步失败都跳过那一项，绝不能因为「记日志」
 *  把灵动岛再拖垮一次。 */
function islandScene(): string {
  const parts: string[] = []
  try {
    parts.push(`v${app.getVersion()}`)
  } catch {
    /* 拿不到版本就算了 */
  }
  try {
    parts.push(`electron=${process.versions.electron}`)
  } catch {
    /* 同上 */
  }
  try {
    // 它加载的是哪份产物、在不在、多大 —— 「脚本没加载上」这类故障全靠这三样定位
    // 跟 createIsland 里的加载路径**保持同一个来源**：dev 走 ELECTRON_RENDERER_URL，
    // 打包后是 __dirname/../renderer/island.html
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      parts.push(`url=${devUrl}/island.html (dev)`)
    } else {
      const f = path.join(__dirname, '../renderer/island.html')
      const dir = path.dirname(f)
      const st = fs.statSync(f)
      parts.push(`html=${f} ${st.size}B`)
      // 同目录下的 assets：名字 + 大小。产物被截断时这里一眼看得出来
      const assets = path.join(dir, 'assets')
      const names = fs
        .readdirSync(assets)
        .filter((n) => n.startsWith('island') || n.startsWith('index'))
        .slice(0, 6)
      for (const n of names) {
        parts.push(`${n}=${fs.statSync(path.join(assets, n)).size}B`)
      }
    }
  } catch (e) {
    parts.push(`scene读取失败=${e instanceof Error ? e.message : String(e)}`)
  }
  return parts.join(' ')
}

function logIslandFatal(line: string): void {
  console.error('[island]', line)
  try {
    const file = path.join(app.getPath('userData'), FATAL_LOG_FILE)
    let prev = ''
    try {
      prev = fs.readFileSync(file, 'utf8')
    } catch {
      /* 第一次落盘，文件还不存在 */
    }
    // 去重：同一条连着来只记一次，之后只更新计数（重写最后一行）
    const key = line.slice(0, 200)
    if (key === lastFatalKey) {
      lastFatalCount += 1
      const idx = prev.lastIndexOf('\n', prev.length - 2)
      const head = idx >= 0 ? prev.slice(0, idx + 1) : ''
      const next = `${head}${new Date().toISOString()} [×${lastFatalCount}] ${line}\n`
      fs.writeFileSync(file, next.length > FATAL_LOG_CAP ? next.slice(-FATAL_LOG_CAP) : next, 'utf8')
      return
    }
    lastFatalKey = key
    lastFatalCount = 1
    // 换了一条新错误 —— 这时才值得把现场重新记一遍
    const next = prev + `${new Date().toISOString()} ${line}\n  ↳ 现场: ${islandScene()}\n`
    fs.writeFileSync(file, next.length > FATAL_LOG_CAP ? next.slice(-FATAL_LOG_CAP) : next, 'utf8')
  } catch {
    // 落盘本身失败（磁盘满/权限问题）不能反过来把灵动岛拖下水——原样吞掉，
    // 上面那行 console.error 已经尽力了。
  }
}

/** 主文档都没能加载上时的兜底页：不引用任何外部 CSS/JS（全部内联），这样它不会重蹈
 *  "资源加载失败"的覆辙。目的只有一个——把"一行不明所以的裸文字"换成一句人话，
 *  告诉用户还有得救（右键 Dock 图标能叫回来），而不是留一片空白让人以为它卡死了。 */
function loadFailureHtml(): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
    '<style>' +
    'html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    '.b{box-sizing:border-box;width:300px;padding:9px 14px;border-radius:0 0 10px 10px;' +
    'background:#000;color:#fda4af;font:12px -apple-system,BlinkMacSystemFont,' +
    "'PingFang SC',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    '</style></head><body><div class="b">灵动岛加载失败，右键 Dock 图标可重新叫出</div></body></html>'
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

  // 换过一次兜底页就不再换第二次——见下面 did-fail-load / did-finish-load 里的用法：
  // 没有这个标记，兜底页自己 did-finish-load 之后会被"根节点没内容"探测再命中一次，
  // 变成兜底页换兜底页的空转。
  let usedFallback = false

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

    // "文档本身加载成功，但里面引用的脚本 404" 这种情况，did-finish-load 照样会触发
    // （HTML 加载没失败，失败的是脚本这个子资源）——did-fail-load / console-message
    // 两条都不会响（实测确认：见 task-23 报告，Chromium 对 file:// + crossorigin 的
    // 子资源失败异常安静），岛会变成一具"窗口在、内容永远不来"的空壳。这里退而求其次：
    // 给渲染层留够启动时间后，直接问一下 DOM 里到底有没有真的长出东西。
    // usedFallback 挡两件事：兜底页自己没有 #root（探测必然判定"空"）、以及避免重复触发。
    if (!usedFallback) {
      setTimeout(() => {
        if (win.isDestroyed() || usedFallback) return
        win.webContents
          .executeJavaScript(
            '(() => { const r = document.getElementById("root"); return r ? r.children.length : -1 })()'
          )
          .then((n: number) => {
            if (n !== 0 || win.isDestroyed() || usedFallback) return
            // **光说「没起来」是排查不动的**（2026-08-21 的教训）。
            // Chromium 对 file:// + crossorigin 的子资源失败异常安静，
            // 所以到这一步我们手上什么都没有 —— 只能主动去页面里问：
            // 那些 script/link 标签指向哪、浏览器认为它们加载成功了吗。
            win.webContents
              .executeJavaScript(
                `(() => {
                  const out = []
                  for (const el of document.querySelectorAll('script[src], link[href]')) {
                    const u = el.src || el.href || ''
                    out.push((el.tagName === 'SCRIPT' ? 'script' : el.rel || 'link') + '=' + u.split('/').pop())
                  }
                  return out.join(' ') + ' | readyState=' + document.readyState
                })()`
              )
              .then((tags: string) => {
                logIslandFatal(
                  '渲染层疑似没跑起来（root 挂载 2s 后仍为空，多半是脚本没加载上）\n' +
                    `  ↳ 页面引用: ${tags}`
                )
              })
              .catch(() => {
                logIslandFatal('渲染层疑似没跑起来（root 挂载 2s 后仍为空，且连页面都问不动了）')
              })
            usedFallback = true
            contentSize = { w: 300, h: 40 }
            void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadFailureHtml()))
          })
          .catch(() => {
            /* 探测本身失败（比如窗口正好在这一刻被销毁）不值得再报一次 */
          })
      }, 2000)
    }
  })
  win.on('closed', () => {
    if (islandWin === win) islandWin = null
  })

  // ---- 这扇窗口出的任何事，不接住就永远无人知晓（见文件顶部"可观测性"说明） ----

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED：导航被更晚的一次取代（比如极短时间内又调用了一次 loadFile/loadURL），
    // 这是正常噪声不是故障——灵动岛重建很频繁，不过滤掉这条每次重建都会误报一次。
    if (errorCode === -3) return
    logIslandFatal(
      `did-fail-load ${isMainFrame ? '[主文档]' : '[子资源]'} code=${errorCode} ${errorDescription} url=${validatedURL}`
    )
    // 主文档没加载上：这扇窗口的 did-finish-load 永远不会来，show()/placeWindow()/pushState()
    // 全部落空——用户会看到的其实是"什么都没有"（透明窗口，比"一行裸文字"更难查）。
    // 换成内联样式的兜底页，好歹说清楚"坏了、还能怎么办"。子资源（CSS/JS）失败不走这条：
    // 页面本身还在，只是丑，硬替换成兜底页反而丢了本来能看的内容。
    if (isMainFrame && !usedFallback) {
      usedFallback = true
      // 兜底页是固定尺寸，不是量出来的——先把窗口该多大直接定下来，
      // 否则 did-finish-load 会照着上一次内容的尺寸摆窗，兜底文字可能被裁掉。
      contentSize = { w: 300, h: 40 }
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadFailureHtml()))
    }
  })

  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logIslandFatal(`preload-error ${preloadPath} ${error?.message ?? error}`)
  })

  // 浏览器原生就会把"子资源加载失败"写成一条 console error（比如 CSS/JS 404 时的
  // net::ERR_FILE_NOT_FOUND）——did-fail-load 管不到子资源，那是 Chromium 的"帧导航失败"
  // 事件，<link>/<script> 的加载失败根本不算一次导航。这条才是真正能接住 CSS/JS 丢失的地方，
  // 也是"样式显示不出来"这类报告最可能命中的一条。只转发 warning/error，滤掉 info/debug——
  // 否则 React 开发模式的调试输出会把这当成刷屏日志源，掩盖真正要紧的那一条。
  win.webContents.on('console-message', (event) => {
    if (event.level !== 'error' && event.level !== 'warning') return
    const at = event.lineNumber ? `:${event.lineNumber}` : ''
    const line = `console.${event.level} ${event.message} (${event.sourceId}${at})`
    if (event.level === 'error') logIslandFatal(line)
    else console.error('[island]', line) // warning 只打日志、不占落盘配额
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') {
      // 正常的 destroy()/close() 收尾也会走这个事件——不是故障。dev 下留个印子方便对账，
      // 打包版连这个都不打，免得看着像"天天崩溃"。
      if (!app.isPackaged) console.log('[island] render-process-gone clean-exit（正常销毁）')
      return
    }
    logIslandFatal(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
    // 崩溃之后 BrowserWindow 对象不会自己变成 isDestroyed()——渲染进程没了，
    // 原生窗口壳还在，islandWin 还指着它。reconcile 的判定是"有 islandWin 就只推状态、
    // 不重建"，于是往一个死人耳朵里推消息，窗口就一直卡在崩溃前最后一帧，永远不会自愈。
    // 用户反馈的"用了一段时间就坏了、后来一直没恢复"，这条很可能是主因之一。
    if (win.isDestroyed()) return
    win.destroy()
    if (islandWin === win) islandWin = null
    const now = Date.now()
    if (now - lastCrashRecreateAt < 3000) {
      logIslandFatal('重建被节流（3s 内已建过一次），暂不重建，等下一次状态推送再说')
      return
    }
    lastCrashRecreateAt = now
    reconcile() // 该不该重建、建成什么样，交回 reconcile 的既有判断，这里不重复那套逻辑
  })

  win.on('unresponsive', () => logIslandFatal('unresponsive（页面卡死无响应）'))

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
    // running 和 notices 都要校验：以前只查了 running，notices 若是 undefined/畸形，
    // 下面 noteFreshNotices 和 reconcile 到处 lastState.notices.map(...)/.filter(...)，
    // 会在主进程里直接抛 TypeError——这个 ipcMain 处理器一炸，这一帧状态就丢了，
    // 灵动岛跟着卡在上一帧。防的不是"今天会发生"，是"以后改渲染层时忘了保证这个形状"。
    lastState =
      state && Array.isArray(state.running) && Array.isArray(state.notices) ? state : EMPTY
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
    // 下限 40 会把**收起态那颗圆点**（26×26）整条上报丢掉 —— 窗口停在展开时的
    // 三百多宽，里面只画了颗小点，剩下的透明区照样挡住底下的内容，等于没收起。
    // 降到 18：比圆点小、又足够挡住「渲染层还没布局好时报 0」那种异常值。
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 18 || h < 16) return
    contentSize = { w: Math.min(760, w), h: Math.min(420, h) }
    if (islandWin && !islandWin.isDestroyed()) placeWindow(islandWin)
  })

  // 灵动岛的点击 → 转给主窗口执行（聚焦某个 session / 关掉某条通知）。
  // 主进程不自己解释这个动作：ptyId 到底落在哪个 tab、哪个画布节点，只有渲染层知道。
  ipcMain.on('island:action', (_e, action: IslandAction) => {
    if (!app.isPackaged) console.log('[island] action', JSON.stringify(action))
    // mini/unmini 是**岛自己的形态**，跟哪个终端无关，不转给主窗口。
    // 落 prefs 再推一次状态：渲染层据此换形态、placeWindow 据此换位置。
    if (action.type === 'mini' || action.type === 'unmini') {
      setPref('islandMini', action.type === 'mini')
      if (islandWin && !islandWin.isDestroyed()) {
        pushState(islandWin)
        // **位置要等渲染层把新尺寸报回来再摆。** 这里先摆一次是为了让
        // 「点圆点展开」立刻往中间走，不然会看到它在原地长大再平移过去。
        placeWindow(islandWin)
      }
      return
    }
    dispatchAction(action)
  })
}

/** 把自己带到前台，走**「右键 Dock → 显示所有窗口」**那条路。
 *
 *  为什么不是 `shell.openPath(自己的 .app)`（这是上一版的做法，也是点 Dock 图标的等价物）：
 *  两者在「哪个 app 是前台」这个判据上实测**完全一样**（各 8 轮：后台唤起 8/8、
 *  已在前台时破坏 0/8），但那个判据量错了东西 —— **输入法（TSM）和 NSCursor 服务的是
 *  key window，不是 frontmost app**，两者可以分开：app 成了前台却没有 key window，
 *  表现就是「窗口在眼前，但打不出中文、hover 也没反应」。
 *
 *  `open <bundle>` 靠的是 `applicationShouldHandleReopen` 的默认行为（可能只 unhide /
 *  deminiaturize），而 `NSApplicationActivateAllWindows` 会**显式把本 app 的所有窗口
 *  order front**，这正是那个菜单项做的事。
 *
 *  为什么经 osascript 而不是 `app.focus({steal:true})`：后者是「进程自己请求激活自己」，
 *  实测 0/10（见下面 verifyRealActivation 的注释）。osascript 是**另一个进程**在调
 *  NSRunningApplication，不受那条限制 —— 这也正是上一版 shell.openPath 能成的原因，
 *  换成这条之后那个性质仍然保住。
 *
 *  **按 pid 定位而不是 bundle 路径**：这台机器上同 bundle id 的副本不止一份
 *  （/Applications 里的旧版备份、打包产物目录里的两份），lsregister 全都登记着。
 *  按 pid 命中的一定是「正在跑的这个我」，没有解析歧义。
 *
 *  options = 3 = NSApplicationActivateAllWindows(1) | NSApplicationActivateIgnoringOtherApps(2)。
 *  后者在新系统上标了 deprecated 但仍然生效；实测（8 轮）带不带它结果一样，留着更稳。 */
function activateAllWindows(): void {
  execFile(
    '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('AppKit');var a=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${process.pid});a&&a.activateWithOptions(3)`
    ],
    { timeout: 1500 },
    () => {
      /* 成不成由 verifyRealActivation 判，这里不看返回值 */
    }
  )
}

/** 把一个动作送到主窗口执行。灵动岛和 Dock 菜单共用这一条路 ——
 *  两处各写一遍的话，「跳转前要不要先激活 app」这种细节迟早只在一处是对的。 */
function dispatchAction(action: IslandAction): void {
  const main = mainWindow()
  if (!main) return
  if (action?.type === 'focus') {
    // 跳转意味着「我来处理了」→ 主窗口必须回到前台，否则点了没反应。
    // 顺序有讲究：先把 app 整体激活，再聚焦具体窗口。反过来的话，
    // win.focus() 在 app 还不是 active application 时只是把它设成 key window，
    // 用户屏幕上什么都不会发生。
    if (main.isMinimized()) main.restore()
    if (!main.isVisible()) main.show()
    if (process.platform === 'darwin') {
      // 走「右键 Dock → 显示所有窗口」那条路，理由见 activateAllWindows 的注释。
      // 简言之：上一版的 shell.openPath 只保证「app 成为前台」，不保证**有 key window**，
      // 而输入法和鼠标指针服务的是后者 —— 那正是「进来了却打不了中文、hover 没反应」的来源。
      activateAllWindows()
    } else {
      // Windows/Linux 没有这个问题（这次排查明确是 macOS WindowServer 特有的行为），
      // 维持原逻辑，不在没证据的平台上动它。
      app.focus({ steal: true })
    }
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

/** 问操作系统「此刻真正在前台的 app 是不是我」。`true`/`false` 是答案，`null` 是**问不出来**——
 *  这三态必须分开，见 verifyRealActivation 里对 null 的处理。
 *
 *  **为什么不用 System Events 的 `frontmost` 属性**（这是 0.4.17 之前的写法，也是那一版
 *  「灵动岛跳回来没输入法、鼠标指针不变」的真凶）：那个属性走的是辅助功能（AX）那一层，
 *  而 **Eas-Term 在 AX 眼里是隐形的**。2026-08-10 实测，同一台机器同一分钟内：
 *
 *    · Eas-Term 真的在前台时 → `get name of first application process whose frontmost is true`
 *      连报 40/40 次错误 -1719（「无效的索引」＝符合条件的进程一个都没有）；
 *      全机 139 个进程里 frontmost=true 的个数是 **0**；直接点名问
 *      `frontmost of every application process whose name contains "Eas"` 得到 false。
 *    · 同一句话，把 Finder 切到前台后立刻正确答出 `Finder`。
 *
 *  也就是说这句查询对本 app 结构性失明，「核实自己是否已在前台」它**永远只会给否定答案**，
 *  于是每一次灵动岛跳转都必然掉进兜底路径。而当时的兜底动作是 `hide()+show()`，
 *  实测会把本来好好的前台状态弄坏（见下面的注释）——修复本身成了故障源。
 *
 *  NSWorkspace.frontmostApplication 才是这件事的权威来源，不经 AX，实测 6/6 准确，
 *  一次 50ms（比原来那句 120ms 还快）。**比 pid 不比名字**：dev 下进程名是 Electron、
 *  打包后是 Eas-Term，比名字得对着模式分支猜，比 pid 没有这个歧义。 */
function frontmostIsSelf(cb: (isSelf: boolean | null) => void): void {
  execFile(
    '/usr/bin/osascript',
    // -l JavaScript：走 JXA + ObjC 桥直接问 AppKit。AppleScript 那边没有等价的
    // 「不经 AX 拿前台 app」的说法，所以这里必须换语言，不是风格偏好。
    [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("AppKit"); String($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)'
    ],
    // 加超时：execFile 本身是异步的，不会卡住主进程，但一个永不返回的子进程会一直占着。
    // 1.5s 远够正常情况下 50ms 的 osascript 用，又不会让这次核实无限期悬着。
    { timeout: 1500 },
    (err, stdout) => cb(err ? null : stdout.trim() === String(process.pid))
  )
}

/** macOS 对「后台进程自己把自己切到前台」有一套不透明的节流，实测（osascript 反复触发
 *  + 轮询系统真实前台 app 对照）确认过：哪怕完全绕开灵动岛、在主进程里直接连续调
 *  `app.focus({steal:true})` + `win.focus()`，WindowServer 认定的「真正活跃的 app」
 *  也经常压根没跟着换——而 Electron 自己的 `isFocused()`、渲染层的 `document.hasFocus()`
 *  几乎立刻翻真。那一半只是本进程内部的 key-window 记账，不代表 OS 真的信了。
 *
 *  表现就是主窗口"看着"聚焦了（甚至可能已经盖在别的窗口上面），实际上鼠标键盘
 *  还在喂给切走前台的那个 app——点画布、点输入框都像没反应，直到用户自己做一次
 *  「显示所有窗口」之类的真实交互，把 WindowServer 的账强制对平。
 *
 *  Electron 自己的 API 问不出这个偏差（问它，只会用同一套失真的账回答你），
 *  所以这里问操作系统本身。只在「灵动岛/Dock 菜单跳转」这个低频动作后触发一次，
 *  不是常驻轮询，开销可以接受。
 *
 *  **这个函数的两条铁律，都是拿实测换来的（2026-08-10）：**
 *
 *  1. **问不出来时什么都不做。** 老版本把「查不到」当成「没切过来」，理由是「兜底动作
 *     基本无害」。这个前提是错的：兜底动作有害（见 2），而且查不到恰恰是常态（见
 *     frontmostIsSelf 的注释）。两个错误叠一起 → 每次跳转都执行一次有害动作。
 *     现在只在**确认**没切过来时才动手。
 *
 *  2. **重试不再用 `hide()+show()`，改成再走一次 activateAllWindows。** 8 轮对照实测：
 *     窗口本来就好好地在前台时，`hide()+show()` 有 **3/8** 的概率把前台交给一个
 *     毫不相干的后台 app（跑出来是 Safari），窗口却还亮在屏幕上——那正是
 *     「看着在前面、其实没有输入法、鼠标指针也不跟着变」的来源：macOS 的输入法
 *     和 NSCursor 都只服务于真正活跃的那个 app。同样条件下重复外部激活（先是
 *     `shell.openPath`，现在是 activateAllWindows）破坏率 **0/8**，
 *     后台唤起成功率 **8/8**（三种手段各 8 轮对照，见 activateAllWindows 的注释）。 */
function verifyRealActivation(win: BrowserWindow, attempt = 0): void {
  setTimeout(() => {
    if (win.isDestroyed()) return
    frontmostIsSelf((isSelf) => {
      if (win.isDestroyed()) return // 窗口没了，做什么都没意义
      if (isSelf === true) return // 确认在前台：收工
      if (isSelf === null) {
        // 问不出来。见上面铁律 1——不知道就别动手，动手的期望收益是负的。
        if (!app.isPackaged) console.log('[island] 前台核实问不出来，按「不动」处理')
        return
      }
      if (!app.isPackaged) console.log(`[island] 确认没切到前台，第 ${attempt + 1} 次尝试`)
      if (attempt === 0) {
        // 重试就再走一遍那条已经证明有效的路（见上面铁律 2）。
        activateAllWindows()
        win.moveTop()
        win.focus()
        win.webContents.focus()
        verifyRealActivation(win, attempt + 1)
        return
      }
      // 两次都没能把真前台掰过来：弹 Dock 图标兜底。'critical' 会一直弹到用户自己
      // 点过来（那一下是真实交互，保真切换）或应用真的拿到前台为止，不会无限打扰。
      // 注意这条现在只在**确认失败**后才走——老版本因为核实恒为否，每次跳转都弹一次。
      app.dock?.bounce('critical')
    })
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

  // 只在真出过事时才露出这一项——平时没出过故障的话，菜单里挂一条打不开东西的
  // "日志"入口比没有还让人费解。这是"用户看不到报错"这件事的最后一道兜底：
  // 双击 .app 打开时没有终端可看，这条菜单 + 落盘的文件是唯一能事后翻到根因的地方。
  const fatalLogPath = path.join(app.getPath('userData'), FATAL_LOG_FILE)
  if (fs.existsSync(fatalLogPath)) {
    items.push({
      label: '打开灵动岛错误日志',
      click: () => shell.showItemInFolder(fatalLogPath)
    })
  }

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
