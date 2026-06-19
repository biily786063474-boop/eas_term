import { app, BrowserWindow, Menu, MenuItemConstructorOptions, dialog } from 'electron'
import path from 'path'
import { registerPtyHandlers, killPtysForWebContents, killAllPtys, anyPtyBusy } from './pty'
import { registerProjectHandlers } from './projects'
import { registerFsHandlers } from './fs'
import { registerBizoneScheme, registerBizoneHandlers } from './bizone'

registerBizoneScheme()

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 520,
    title: 'Eas-Term',
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
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  // 页面刷新/导航时回收该窗口名下所有 PTY，避免泄漏。
  // 注意：closed 触发时 win.webContents 已销毁，必须提前取 id
  const wcId = win.webContents.id
  win.webContents.on('did-navigate', () => killPtysForWebContents(wcId))
  win.on('closed', () => killPtysForWebContents(wcId))

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

app.whenReady().then(() => {
  registerPtyHandlers()
  registerProjectHandlers()
  registerFsHandlers()
  registerBizoneHandlers()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  killAllPtys()
})
