import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { guardedHandle } from './ipcGuard'
import { mainWindow } from './island'
import { coordinate, livePageOwner, localPageUrl, safeText, type LivePageContext } from './livePagePolicy'
import type { LivePageState } from '../shared/livePage'
import { markLivePageWindow } from './livePageWindowTag'

type LiveTool = 'page_live_open' | 'page_live_inspect' | 'page_live_click' | 'page_live_type' | 'page_live_scroll' | 'page_live_close'
interface LiveSession { window: BrowserWindow; state: LivePageState; timer: NodeJS.Timeout | null; capturing: boolean }
const sessions = new Map<string, LiveSession>()
const MAX_SESSIONS = 2
let workbench: BrowserWindow | null = null

function attachWorkbench(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed() || workbench === window) return
  workbench = window
  window.once('closed', () => {
    if (workbench !== window) return
    workbench = null
    for (const owner of [...sessions.keys()]) destroy(owner)
  })
}

function emit(state: LivePageState): void {
  // A pending capture/navigation may finish after close. Never resurrect that session in the renderer.
  if (!sessions.has(state.owner) && state.url) return
  const win = workbench && !workbench.isDestroyed() ? workbench : mainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('livePage:state', state)
}

function ownRenderer(event: IpcMainInvokeEvent): void {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || event.senderFrame !== event.sender.mainFrame || [...sessions.values()].some(s => s.window === win) || (workbench && !workbench.isDestroyed() && win !== workbench)) throw new Error('仅工作台主窗口可控制页面观察窗')
  attachWorkbench(win)
}

function stopCapture(session: LiveSession): void {
  if (session.timer) clearInterval(session.timer)
  session.timer = null
}

async function capture(session: LiveSession): Promise<void> {
  if (session.capturing || !session.state.visible || session.state.popout || session.window.isDestroyed()) return
  session.capturing = true
  try {
    const image = await session.window.webContents.capturePage()
    if (!image.isEmpty() && sessions.get(session.state.owner) === session && session.state.visible && !session.state.popout) {
      const size = image.getSize()
      const width = Math.min(960, size.width)
      const bytes = image.resize({ width, quality: 'good' }).toJPEG(60)
      if (bytes.byteLength < 350_000) {
        const frame = 'data:image/jpeg;base64,' + bytes.toString('base64')
        if (frame !== session.state.frame) { session.state.frame = frame; emit(session.state) }
      }
    }
  } catch { /* navigation/close can race a frame; next capture recovers */ }
  finally { session.capturing = false }
}

function startCapture(session: LiveSession): void {
  stopCapture(session)
  if (session.state.visible && !session.state.popout) {
    void capture(session)
    session.timer = setInterval(() => void capture(session), 700)
  }
}

function destroy(owner: string): void {
  const session = sessions.get(owner)
  if (!session) return
  sessions.delete(owner)
  stopCapture(session)
  emit({ ...session.state, visible: false, popout: false, loading: false, frame: undefined, url: '' })
  if (!session.window.isDestroyed()) session.window.destroy()
}

function create(owner: string, leafId: string): LiveSession {
  if (sessions.size >= MAX_SESSIONS) throw new Error('同时最多观察两个页面，请先结束一个预览')
  if (!workbench || workbench.isDestroyed()) attachWorkbench(mainWindow())
  const win = new BrowserWindow({
    width: 1080, height: 780, show: false, paintWhenInitiallyHidden: true,
    title: 'Eas-Term · 页面观察窗',
    webPreferences: { partition: 'live-page-' + Date.now() + '-' + Math.random().toString(36).slice(2), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true }
  })
  markLivePageWindow(win)
  const state: LivePageState = { owner, leafId, url: '', title: '页面开发', loading: true, visible: true, popout: false }
  const session: LiveSession = { window: win, state, timer: null, capturing: false }
  sessions.set(owner, session)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => { try { localPageUrl(url) } catch { event.preventDefault(); state.error = '已阻止离开本机开发服务器'; emit(state) } })
  win.webContents.on('will-redirect', (event, url) => { try { localPageUrl(url) } catch { event.preventDefault(); state.error = '已阻止跳转到外部网站'; emit(state) } })
  win.webContents.on('did-start-loading', () => { state.loading = true; emit(state) })
  win.webContents.on('did-stop-loading', () => { state.loading = false; state.url = win.webContents.getURL(); state.title = win.webContents.getTitle() || '页面开发'; emit(state); void capture(session) })
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) { state.loading = false; state.error = '页面未能加载：' + description; state.url = url; emit(state) }
  })
  win.on('close', (event) => {
    if (sessions.get(owner) !== session) return
    event.preventDefault()
    win.hide()
    state.popout = false
    state.visible = true
    emit(state)
    startCapture(session)
  })
  return session
}

function requireSession(owner: string): LiveSession {
  const session = sessions.get(owner)
  if (!session || session.window.isDestroyed()) throw new Error('页面观察会话已关闭，请先打开本机网页')
  return session
}

async function point(session: LiveSession, selector: unknown): Promise<{ x: number; y: number }> {
  if (typeof selector !== 'string' || !selector || selector.length > 500) throw new Error('需要有效的 CSS 选择器')
  const rect = await session.window.webContents.executeJavaScript(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) throw new Error('页面中找不到该元素')
  return rect
}

export async function invokeLivePage(tool: string, raw: unknown, ctx: LivePageContext): Promise<unknown> {
  const name = tool as LiveTool
  const args = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const owner = livePageOwner(ctx)
  if (name === 'page_live_open') {
    const url = localPageUrl(args.url)
    let session = sessions.get(owner)
    if (!session) session = create(owner, ctx.agentLeafId || '')
    session.state.error = undefined
    session.state.visible = true
    session.state.loading = true
    emit(session.state)
    try { await session.window.loadURL(url.href) } catch (error) { session.state.error = '开发服务器未就绪：' + String(error); emit(session.state); throw error }
    session.state.url = url.href
    startCapture(session)
    return { owner, url: url.href, title: session.window.webContents.getTitle() }
  }
  const session = requireSession(owner)
  if (name === 'page_live_close') { destroy(owner); return { closed: true } }
  if (name === 'page_live_inspect') {
    const data = await session.window.webContents.executeJavaScript(`(() => ({title:document.title,text:(document.body?.innerText||'').slice(0,4000),elements:[...document.querySelectorAll('a,button,input,textarea,select,[role="button"]')].slice(0,60).map((e,i)=>({index:i,tag:e.tagName.toLowerCase(),text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,100),id:e.id||undefined}))}))()`)
    return { url: session.window.webContents.getURL(), ...data }
  }
  if (name === 'page_live_click') {
    const [width, height] = session.window.getContentSize()
    const xy = typeof args.selector === 'string' ? await point(session, args.selector) : { x: coordinate(args.x) * width, y: coordinate(args.y) * height }
    session.window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(xy.x), y: Math.round(xy.y), button: 'left', clickCount: 1 })
    session.window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(xy.x), y: Math.round(xy.y), button: 'left', clickCount: 1 })
  } else if (name === 'page_live_type') {
    await point(session, args.selector)
    const selector = String(args.selector)
    await session.window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.focus()`)
    session.window.webContents.insertText(safeText(args.text))
  } else if (name === 'page_live_scroll') {
    const delta = Number(args.deltaY)
    if (!Number.isFinite(delta) || Math.abs(delta) > 3000) throw new Error('滚动距离超过限制')
    const [width, height] = session.window.getContentSize()
    session.window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(width / 2), y: Math.round(height / 2), deltaY: delta, deltaX: 0, canScroll: true })
  } else throw new Error('未知的页面观察工具')
  await new Promise(resolve => setTimeout(resolve, 180))
  void capture(session)
  return { url: session.window.webContents.getURL(), title: session.window.webContents.getTitle(), action: name }
}

export function registerLivePageHandlers(): void {
  guardedHandle('livePage:state', own => { ownRenderer(own); return [...sessions.values()].map(s => s.state) })
  guardedHandle('livePage:open', async (event, url: string, leafId: string) => {
    ownRenderer(event)
    if (typeof leafId !== 'string' || leafId.length > 200) throw new Error('无效的 AI 对话位置')
    return invokeLivePage('page_live_open', { url }, { agentLeafId: leafId || undefined, ptyId: leafId || 'manual' })
  })
  guardedHandle('livePage:visible', (event, owner: string, visible: boolean) => { ownRenderer(event); const s = requireSession(owner); s.state.visible = visible; emit(s.state); visible ? startCapture(s) : stopCapture(s); return s.state })
  guardedHandle('livePage:popout', (event, owner: string) => { ownRenderer(event); const s = requireSession(owner); s.state.popout = true; stopCapture(s); s.window.show(); s.window.focus(); emit(s.state); return s.state })
  guardedHandle('livePage:dock', (event, owner: string) => { ownRenderer(event); const s = requireSession(owner); s.window.hide(); s.state.popout = false; s.state.visible = true; emit(s.state); startCapture(s); return s.state })
  guardedHandle('livePage:close', (event, owner: string) => { ownRenderer(event); destroy(owner) })
  app.on('before-quit', () => { for (const owner of [...sessions.keys()]) destroy(owner) })
}
