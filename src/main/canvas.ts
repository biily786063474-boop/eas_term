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

    const size = fs.statSync(filePath).size
    const fileUrl = pathToFileURL(filePath).toString()

    // <video> 靠「有没有收到 206 + Content-Range」判断这个源能不能寻址：能才会在
    // seek / 缓冲跳段时改发 Range 请求；判定不能寻址，就退化成「一条连接从头
    // 读到尾、不可回退」的模式——那种模式下只要连接中途抖一下需要断点续传，
    // 或者用户拖进度条，播放就直接卡死不动（画面还在但再也不走）。
    // 之前这里的实现完全没看 request 带没带 Range，一律整份 200 转发，
    // 相当于永远在告诉 <video>「我不支持范围请求」——即使 net.fetch 对 file://
    // 其实是认 Range 的（实测 body 会精确按区间切好），只是它自己报出来的
    // status/头永远是 200、不带 Content-Range/Accept-Ranges。这里把 net.fetch
    // 已经切好的 body 转发，自己按请求头补上 206 + Content-Range，
    // 相当于把 net.fetch「切对了但没报对」的部分修正回来。
    const range = request.headers.get('range')
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null

    if (!m || (!m[1] && !m[2])) {
      // 没带 Range，或者格式认不出来：整份返回，但要带 Accept-Ranges，
      // 否则 <video> 会把「这次没问我要区间」误判成「这个源根本不支持区间」，
      // 之后就再也不会发 Range 请求了。
      const res = await net.fetch(fileUrl)
      return new Response(res.body, {
        status: 200,
        headers: { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) }
      })
    }

    let start: number
    let end: number
    if (m[1]) {
      start = parseInt(m[1], 10)
      end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
    } else {
      // 后缀形式 "bytes=-N"：最后 N 字节
      start = Math.max(0, size - parseInt(m[2], 10))
      end = size - 1
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }

    const res = await net.fetch(fileUrl, { headers: { Range: range! } })
    return new Response(res.body, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`
      }
    })
  })
}
