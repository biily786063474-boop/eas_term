// 迷你浏览器（<webview>）里 window.open 的策略。
//
// 2026-09-15：原来所有 window.open 都被 setWindowOpenHandler 拦成「在当前 webview 内 loadURL」，
// 这破坏了 OAuth 弹窗流 —— Google 登录（Google Identity Services）先 window.open('about:blank')
// 拿到 window 引用、再异步把它指向 accounts.google.com，登录完 postMessage 回父页面。
// 被拦成同页导航后：about:blank 顶掉了用户的登录页（变空白），window.open 返回 null，
// 后续 location / postMessage 全落空 —— 表现就是「点了没反应」。
// 改成开一个受控子窗口（无 preload、沙箱、共享会话），父页面不动，OAuth 正常。
import {hardenWebviewPreferences} from './webviewGuard.ts'

export type WebviewOpenAction = 'favorites' | 'popup'

/** eas-favorites: 是内部路由（打开收藏 UI，不建窗口）；其余都开受控弹窗。 */
export function webviewOpenAction(url: string): WebviewOpenAction {
  return url.startsWith('eas-favorites:') ? 'favorites' : 'popup'
}

/** 受控弹窗的 webPreferences：与 <webview> 同一套加固（无 preload → 无 window.api / IPC），
 *  再共享迷你浏览器的会话 partition，让 cookie-based OAuth 的登录态回到父页面。 */
export function popupWebPreferences(partition: string): Record<string, unknown> {
  return hardenWebviewPreferences({partition})
}
