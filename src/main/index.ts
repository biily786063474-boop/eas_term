import { app, BrowserWindow, Menu, MenuItemConstructorOptions, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerPtyHandlers, killPtysForWebContents, killAllPtys, anyPtyBusy, anyPtyAlive } from './pty'
import { registerBoardHandlers } from './board'
import { registerGanttHandlers } from './gantt'
import { registerTodoHandlers } from './todos'
import { registerProjectHandlers } from './projects'
import { registerFsHandlers } from './fs'
import { registerPasteImageHandlers, sweepPasteImages } from './pasteImages'
import { registerPrefsHandlers } from './prefs'
import { registerSnapshotHandlers } from './snapshot'
import { registerUpdaterHandlers, schedule as scheduleUpdateCheck } from './updater'
import { registerTelemetry } from './telemetry'
import { registerGitHandlers } from './git'
import { registerSessionHandlers } from './session'
import { registerCanvasHandlers, registerMediaScheme } from './canvas'
import { registerAgentHandlers } from './agent'
import { registerSttHandlers } from './stt'
import { registerDesignHandlers } from './design'
import { registerMcpBridge } from './mcpBridge'
import { registerSkillHandlers, hasCli } from './agentSkill'
import { registerHookHandlers } from './agentHook'
import { registerRoleHandlers } from './roles'
import { registerWikiHandlers } from './wiki'
import { registerSkillLibraryHandlers } from './skillLibrary'
import { registerDictHandlers } from './dict'
import { registerRulesHandlers } from './agentRules'
import { registerAgentInstallHandlers } from './agentInstall'
import { registerBizoneScheme, registerBizoneHandlers } from './bizone'
import { registerSecretHandlers } from './secrets'
import { registerIslandHandlers, nudgeIsland, isIslandWindow, destroyIsland, mainWindow } from './island'
import { registerAgentChatHandlers, killAllAgentChatSessions } from './agentChat/session.ts'

// 切到后台不降速。Chromium 默认会把「隐藏/最小化/被完全遮挡」的窗口狠狠节流,
// 实测(最小化 10s,独立探针对比):setInterval 只剩 26%、requestAnimationFrame 只剩 11%、
// 定时发起的 fetch 只剩 50%(**连接没被切,是发起它的定时器慢了**)。
// 对普通网页无所谓,对这个应用是硬伤:终端输出靠 rAF 写进 xterm(TerminalView 那段合帧),
// rAF 一停,agent 在后台跑出来的东西就全堵在缓冲里,要切回来才吐。
// 这三个开关必须在 app ready 之前加,晚了不生效。窗口那边还要配 backgroundThrottling:false。
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// 主进程兜底:任一未捕获异常/拒绝都不让 Node 默认 process.exit(1) 打掉整个 app(全窗口瞬灭)。
// 只记录、不退出——白屏根因之一就是这里缺兜底,一个 EPIPE/EIO 就能整死主进程。
process.on('uncaughtException', (err) => {
  console.error('[main:uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main:unhandledRejection]', reason)
})

// 画布迷你浏览器(webview):点链接 / target=_blank / window.open 都在**同一 webview 内**导航
// (不弹原生新窗),并通知渲染层「聚焦到这个浏览器节点」(画布模式下 pan 过去)。
// 用 web-contents-created 捕获所有 webview guest(比 did-attach-webview 对命令式创建的 webview 更可靠)。
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return
  contents.setWindowOpenHandler(({ url }) => {
    // 在 handler 里同步 loadURL 会被 Electron 忽略 → setImmediate 延迟到 handler 返回后导航
    setImmediate(() => {
      if (contents.isDestroyed()) return
      try {
        void contents.loadURL(url)
      } catch {
        /* 非法 url 忽略 */
      }
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('browser:focus', contents.id)
      }
    })
    return { action: 'deny' }
  })
})

// GPU/工具进程崩溃 → 若拖垮了某个窗口渲染,重载该窗口(节流防崩溃循环)
app.on('child-process-gone', (_e, details) => {
  console.error('[main:child-process-gone]', details.type, details.reason)
  if (details.type === 'GPU' && details.reason !== 'clean-exit') {
    for (const w of BrowserWindow.getAllWindows()) reloadWindowThrottled(w)
  }
})

// 渲染/GPU 崩溃自动重载的节流:同一窗口 3s 内不重复 reload,避免「崩溃—重载—再崩」死循环
const lastReloadAt = new WeakMap<BrowserWindow, number>()
function reloadWindowThrottled(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const now = Date.now()
  if (now - (lastReloadAt.get(win) ?? 0) < 3000) return
  lastReloadAt.set(win, now)
  win.reload()
}

registerBizoneScheme()
registerMediaScheme()

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 520,
    title: 'Eas-Term',
    // **非活动窗口的第一次点击直接传给内容。** macOS 默认要「先点一下激活、
    // 再点一下才算数」—— 从灵动岛跳回来时正好撞上：窗口刚被 focus，
    // 你伸手去点画布上的模块，那一下被系统吃掉当成激活用了，表现成「模块点不动」。
    // 对一个工作台来说，看见什么就该能点什么，不该有这道空转。
    acceptFirstMouse: true,
    // mac：隐藏式标题栏 + vibrancy 透出桌面模糊；Windows/Linux：系统标题栏 + 不透明深色底
    // （vibrancy/hiddenInset/红绿灯定位是 macOS 专属，在其他平台会导致背景异常或缺少窗口按钮）
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 13 },
          backgroundColor: '#00000000',
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const
        }
      : {
          backgroundColor: '#0f1117'
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // 窗口切到后台/最小化时不降速 —— 见文件顶部那三个 commandLine 开关的说明。
      // 两处都要:开关管进程级,这个管这个窗口自己。
      backgroundThrottling: false,
      // 画布「迷你浏览器」节点用 <webview>（唯一能跟随画布 CSS transform 缩放的真 Chromium 内核）
      webviewTag: true,
      // 版本号走 additionalArguments 而不是 IPC：这样 preload 能**同步**拿到，
      // 界面右下角那个水印首帧就是对的。走 IPC 的话会先渲染成空再补上，
      // 而这个水印存在的意义恰恰是「一眼确认自己开的是哪个包」——闪一下就削弱了它。
      additionalArguments: [
        `--eas-version=${app.getVersion()}`,
        `--eas-packaged=${app.isPackaged ? '1' : '0'}`
      ]
    }
  })

  // 页面刷新/导航时回收该窗口名下所有 PTY，避免泄漏。
  // 注意：closed 触发时 win.webContents 已销毁，必须提前取 id
  const wcId = win.webContents.id
  win.webContents.on('did-navigate', () => killPtysForWebContents(wcId))
  win.on('closed', () => {
    killPtysForWebContents(wcId)
    // 灵动岛是主窗口状态的投影，主窗口没了就没有可投的东西。
    // 更要紧的是：留着它，window-all-closed 永远不会触发，app 退不掉，
    // 屏幕顶上只剩一条连不上任何东西的幽灵胶囊。
    destroyIsland()
  })

  // 渲染进程崩溃/被杀(OOM 等)→ 自动重载,避免永久白屏(白屏根因之一:崩了没恢复机制)。
  // clean-exit(正常导航/关闭)不处理;节流防崩溃循环。画布存档已持久化,重载能还原布局。
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details.reason)
    if (details.reason !== 'clean-exit') reloadWindowThrottled(win)
  })
  // 页面卡死无响应 → 记录(暂不强制处理,交给用户或后续等待 responsive)
  win.on('unresponsive', () => console.error('[window:unresponsive]'))

  // 放行渲染进程的麦克风/媒体请求(语音输入用 getUserMedia)、以及全屏请求(画布视频节点
  // 原生 <video controls> 的全屏按钮)。Electron 默认拦截 getUserMedia,不设 handler 则采麦
  // 直接失败;'fullscreen' 同样是这个 handler 管的权限类型之一(见 electron.d.ts
  // setPermissionRequestHandler 的 permission 联合类型)——当初只想放行 media,
  // 结果 cb(permission === 'media') 把 fullscreen 一并拒了:按钮点击触发的
  // requestFullscreen() 请求被拒绝后 Promise 既不 resolve 也不 reject,表现成「点了没反应」,
  // 且没有任何 console 报错。web 节点浏览器用 persist:browser 独立 session,不受此影响。
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'fullscreen')
  })


  // 退出/关窗口前：若仍有终端在运行命令，弹窗确认，避免误杀进程。
  // 覆盖红绿灯关闭按钮与 ⌘Q（before-quit 会触发窗口的 close）
  let allowClose = false
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    void anyPtyBusy().then(async (busy) => {
      if (!busy) {
        allowClose = true
        win.close()
        return
      }
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['取消', '仍要退出'],
        defaultId: 0,
        cancelId: 0,
        message: '仍有终端正在运行命令',
        detail: '退出 Eas-Term 会终止这些正在运行的进程，确定要退出吗？'
      })
      if (response === 1) {
        allowClose = true
        win.close()
      }
    })
  })

  // 灵动岛的出现条件是「主窗口不在前台」。这四个事件覆盖了所有离开/回来的路径：
  // 切到别的 app（blur/focus）、最小化到 Dock、⌘H 隐藏后再点 Dock 图标（hide/show 走 focus）。
  win.on('blur', nudgeIsland)
  win.on('focus', nudgeIsland)
  win.on('minimize', nudgeIsland)
  win.on('restore', nudgeIsland)
  win.on('show', nudgeIsland)
  win.on('hide', nudgeIsland)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  // 自定义菜单：保留编辑/视图等系统角色，去掉 Cmd+W 关闭窗口，让快捷键留给"关闭终端面板"
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 Eas-Term' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Eas-Term' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Eas-Term' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 单实例：两个实例会共用同一份 userData（canvas.json 尤其致命——后保存的直接覆盖
// 先保存的，画布互吞）。第二个实例直接退出，把已开的那个窗口唤到前台。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 不能随便挑一扇——灵动岛也是一个 BrowserWindow，但它 focusable:false，
    // 挑到它的话 restore()/focus() 全部落空，用户会觉得「叫了半天，应用没反应」。
    const win = mainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      // 窗口 focus 不等于网页内容 focus —— 不补这句，用户从 Dock/命令行
      // 唤回来之后第一次点击只是在「把焦点收回页面」，看着像点不动
      win.webContents.focus()
    }
  })
}

app.whenReady().then(() => {
  // dev 下 dock 也显示项目图标（打包版的图标由 electron-builder 用 build/icon.icns 写进 .app）
  if (!app.isPackaged && process.platform === 'darwin') {
    const devIcon = path.join(app.getAppPath(), 'build', 'icon.png')
    try {
      if (fs.existsSync(devIcon)) app.dock?.setIcon(devIcon)
    } catch {
      /* 图标缺失不影响启动 */
    }
  }
  registerMcpBridge() // 先起 MCP 桥：PTY spawn 时要注入它的 port/token
  // 密钥柜也必须排在 registerPtyHandlers 之前 —— 同理，PTY spawn 时要从它取值注入。
  // 另外它内部会断言 app.isReady()：safeStorage 在 ready 之前会**静默**用错密钥桶
  // （不报错，只是换成全局共享的那把），所以这个调用绝不能提到 whenReady 外面。
  registerSecretHandlers()
  registerSkillHandlers()
  registerAgentInstallHandlers()
  registerHookHandlers(hasCli)
  registerRoleHandlers()
  registerWikiHandlers()
  registerSkillLibraryHandlers()
  registerDictHandlers()
  registerRulesHandlers()
  registerPtyHandlers()
  registerProjectHandlers()
  registerBoardHandlers()
  registerGanttHandlers()
  registerTodoHandlers()
  registerFsHandlers()
  registerPasteImageHandlers()
  // 上次留下的粘贴图，过 24 小时的在这里清掉（见 pasteImages.ts 里为什么不发送后就删）
  sweepPasteImages()
  registerPrefsHandlers()
  registerSnapshotHandlers()
  registerUpdaterHandlers()
  // 检查更新：启动 12 秒后查第一次，之后每 6 小时。用户关掉开关就完全不发请求
  scheduleUpdateCheck()
  // 匿名使用统计（默认开，设置里可关）。采集边界写在 telemetry.ts 顶部，改之前先读
  registerTelemetry()
  registerGitHandlers()
  registerSessionHandlers()
  registerCanvasHandlers()
  registerAgentHandlers()
  registerSttHandlers()
  registerDesignHandlers()
  registerBizoneHandlers()
  registerIslandHandlers()
  registerAgentChatHandlers()
  buildMenu()
  createWindow()

  // 点 Dock 图标：灵动岛不算「还有窗口开着」——它开着的时候主窗口恰恰是关掉/藏起来的，
  // 不排除它的话点 Dock 图标什么都不会发生，等于 app 打不开了。
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter((w) => !isIslandWindow(w)).length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})


// 退出时清场：把所有终端连同它们底下跑的进程（claude / 构建 / dev server）一起收掉。
// 分两拍是为了给 CLI 存会话的机会：先 SIGTERM，300ms 后仍活着的一律 SIGKILL。
// 不这么做的话，app 退了那些进程还在，变成占着 CPU 和端口的孤儿。
// agent-chat 会话（session.ts 直接 spawn 的 claude/codex 进程，不经过 PTY）跟着同一个
// 两拍节奏一起收——同样是"进程管理"的题中之义，漏了这条，agent-chat 相关的 CLI 进程
// 会在 app 退出后变成孤儿。
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  destroyIsland() // 先收掉灵动岛：它会拦住 window-all-closed，退出流程会卡在这儿
  killAllPtys() // 软的
  killAllAgentChatSessions() // 软的
  setTimeout(() => {
    if (anyPtyAlive()) killAllPtys(true) // 硬的
    killAllAgentChatSessions(true) // 硬的
    app.quit()
  }, 300)
})

app.on('will-quit', () => {
  killAllPtys(true) // 兜底：任何路径走到这里都确保清干净
  killAllAgentChatSessions(true)
})
