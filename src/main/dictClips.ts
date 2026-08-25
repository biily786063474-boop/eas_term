// 名词词典里那些动效词条的演示短片。
//
// ── 为什么是短片而不是 SVG ────────────────────────────────────────────────
// 词典原本用手绘 SVG 当示意图，对「防抖」这类概念够用；但动效词条要回答的是
// 「它长什么样、怎么动」，手绘再像也只是示意。这些短片是**真组件跑出来的实录**，
// 而且带一个模拟指针按 触发方式（出现 / 悬停 / 点击 / 滚动）分节演一遍 ——
// 用户 hover 一下就看完了，鼠标不用动。
//
// 145 个片子共约 13MB，随包走 extraResources。
//
// ── 为什么要自定义协议 ────────────────────────────────────────────────────
// 渲染层不能直接 file:// 读本地文件。同 bizone.ts 的 registerBizoneScheme 那套：
// 注册一个私有 scheme，主进程按文件名回流。
//
// **文件名要严格校验**：这个 handler 把参数当路径用，不校验就是任意文件读取。
// 只放行 `<英数>.webm`，任何分隔符、点号、上级引用一律拒绝。
import { app, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SCHEME = 'dict-clip'
/** 只认「字母数字开头 + .webm」。**不许出现 / \ . : 等任何路径成分** */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.webm$/

const clipDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'dict-clips')
    : path.join(app.getAppPath(), 'resources', 'dict-clips')

/** 必须在 app ready 之前调用（同 registerBizoneScheme 的约束）。 */
export function registerDictClipScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      // stream:true —— <video> 要能按范围请求拉流，不给的话大一点的片子会卡
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

export function registerDictClipHandlers(): void {
  protocol.handle(SCHEME, async (request) => {
    // `dict-clip://c/Crosshair.webm` —— host 段固定占位，取 pathname
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    if (!NAME_RE.test(name)) return new Response('bad name', { status: 400 })
    const f = path.join(clipDir(), name)
    // 双保险：解析后必须仍在 clipDir 之内。正则已经挡掉了路径成分，
    // 但这类「参数当路径」的地方值得两道门 —— 漏一次就是任意文件读取。
    if (!f.startsWith(clipDir() + path.sep) || !fs.existsSync(f)) {
      return new Response('not found', { status: 404 })
    }
    const res = await net.fetch(pathToFileURL(f).toString())
    return new Response(res.body, { status: 200, headers: { 'Content-Type': 'video/webm' } })
  })
}
