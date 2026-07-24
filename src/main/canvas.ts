import { app, ipcMain, net, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

// 无限画布场景持久化：整场景（frames/shapes/viewport/viewMode）落一个 JSON。
// 存在 userData（~/Library/Application Support/Eas-Term/canvas.json）——在 .app 外面，
// 所以升级替换 app、关机重启都不会丢。终端节点的 leafId 由渲染层在保存前剥掉（会话相关），
// 重开时按占位重新 spawn 绑定。
const storeFile = (): string => path.join(app.getPath('userData'), 'canvas.json')

// 画布媒体预览：只服务这些媒体扩展名（图片/动图/视频），其它一律拒绝（纵深防御）
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon'
}

// 必须在 app ready 前注册为 privileged（可被 <video>/<img> 以 secure origin 加载、支持流式 range）
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'easfile',
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

export function registerCanvasHandlers(): void {
  ipcMain.handle('canvas:load', () => {
    try {
      return JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    } catch {
      return null // 文件不存在或损坏 → 当作空画布
    }
  })

  const writeScene = (scene: unknown): void => {
    try {
      fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
      fs.writeFileSync(storeFile(), JSON.stringify(scene, null, 2), 'utf8')
    } catch {
      // 写盘失败（磁盘满 / 权限）不阻塞 UI，静默跳过
    }
  }
  ipcMain.handle('canvas:save', (_e, scene: unknown) => writeScene(scene))
  // 同步落盘：退出/刷新前(beforeunload)用它,阻塞到写完再放行,杜绝「改完就退,防抖没落盘」丢失。
  ipcMain.on('canvas:save-sync', (e, scene: unknown) => {
    writeScene(scene)
    e.returnValue = true
  })

  // easfile://media/<base64url(绝对路径)> → 流式返回媒体文件，带正确 Content-Type。
  // 仅限媒体扩展名白名单，避免变成任意文件读取通道。
  protocol.handle('easfile', async (request) => {
    let filePath: string
    try {
      const enc = new URL(request.url).pathname.replace(/^\//, '')
      const b64 = enc.replace(/-/g, '+').replace(/_/g, '/')
      filePath = Buffer.from(b64, 'base64').toString('utf8')
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = MEDIA_MIME[ext]
    if (!mime) return new Response('unsupported media type', { status: 415 })
    if (!path.isAbsolute(filePath) || !fs.existsSync(filePath))
      return new Response('not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(filePath).toString())
    return new Response(res.body, { status: 200, headers: { 'Content-Type': mime } })
  })
}
