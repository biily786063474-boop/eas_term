// 数据文件变了就通知面板。
//
// 面板原来只在「经宿主调用 desk_* 工具」后收到 tool-result 才刷新。但数据文件谁都能写：
// 没接好发布台的会话里，AI 会自己起一个 server.mjs 把卡片写进来（2026-10-02 实际发生），
// 别的进程、手改文件也一样 —— 这些都绕过了宿主，已经开着的面板一直是空的，要关掉重开才看得到。
// 所以由宿主托管的那个 server 盯住数据目录：数据文件一变就发 notifications/resources/updated，
// 宿主把插件主动发的通知原样转给这个插件的所有面板（pluginHost.ts onNotification）。
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'publish-desk.json'

/** 监听 dir 下的数据文件；变化（按大小 + 修改时间判断）时去抖后回调一次。返回停止函数 */
export function watchData(dir, onChange, debounceMs = 120) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, FILE)
  const sig = () => { const st = fs.statSync(file, { throwIfNoEntry: false }); return st ? `${st.size}:${st.mtimeMs}:${st.ino}` : '' }
  let last = sig(), timer = null
  // 监听目录而不是文件：store 是写临时文件再 rename 覆盖，文件句柄每次都换，盯文件会在第一次写入后失效
  const watcher = fs.watch(dir, (_event, name) => {
    if (name && name !== FILE) return // 锁文件、临时文件不算
    clearTimeout(timer)
    timer = setTimeout(() => {
      const now = sig()
      if (now === last) return
      last = now
      try { onChange() } catch {}
    }, debounceMs)
  })
  watcher.on('error', () => {}) // 目录被删之类：不让插件进程因此崩掉，面板仍可手动刷新
  return () => { clearTimeout(timer); watcher.close() }
}
