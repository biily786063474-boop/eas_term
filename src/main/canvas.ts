import { shouldBackup, backupName, prunable } from '../shared/canvasBackup'
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

  /** 盘上那份有几个 Frame。读不到 / 坏了一律当 0 —— 那时也没什么可备份的。 */
  const framesOnDisk = (): number => {
    try {
      const j = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as { frames?: unknown[] }
      return Array.isArray(j.frames) ? j.frames.length : 0
    } catch {
      return 0
    }
  }

  const writeScene = (scene: unknown): void => {
    try {
      fs.mkdirSync(path.dirname(storeFile()), { recursive: true })

      // **覆盖前，如果这次写入让画布大幅缩水，先留一份。**
      //
      // 2026-08-20：一个 React 报错弹出 ErrorBoundary，上面摆着「重置画布并重载」——
      // 人在界面崩了的时候最容易点它，而它就是 save(EMPTY_CANVAS)：
      // 25KB 的布局（20 个 Frame）当场变成 2KB（3 个），**没有备份、不可逆**。
      // 用户丢了所有工作区的节点摆放，projects.json 还在但布局全没了。
      //
      // 判据是「内容缩水」而不是「是不是手动重置」—— 那能一并挡住别的意外清空路径，
      // 不用一条条堵。判定与为什么宁可多备份，见 shared/canvasBackup.ts。
      const next = (scene as { frames?: unknown[] })?.frames
      if (shouldBackup(framesOnDisk(), Array.isArray(next) ? next.length : 0)) {
        try {
          fs.copyFileSync(storeFile(), backupName(storeFile(), Date.now()))
          const dir = path.dirname(storeFile())
          const base = path.basename(storeFile())
          for (const f of prunable(fs.readdirSync(dir).filter((n) => n.startsWith(base))))
            fs.rmSync(path.join(dir, f), { force: true })
        } catch (e) {
          // 备份失败不能挡住写入本身 —— 但要留痕，否则「以为有备份其实没有」
          console.error('[canvas] 备份失败', e)
        }
      }

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
      // 之后就再也不会发 Range 请求了。signal 透传见下面有 Range 分支的注释。
      const res = await net.fetch(fileUrl, { signal: request.signal })
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

    // start/end 到这里已经被上面的 Math.min/Math.max 夹成「相对 size 必然合法」的值——
    // 但夹的是数值，转发给 net.fetch 的 Range 头用的还是 range 这个原始字符串。数字位数
    // 极端多时（约 ≥19 位，超出 Chromium Range 解析器能安全处理的量级）两者就对不上了：
    // start/end 看着合法，实际转发出去的原始大数会被 Chromium 判定为不可满足而直接
    // 抛异常，而不是回落成一个普通的失败态 Response。用 try/catch 把这种情况兜成 416——
    // 语义上也站得住：一个大到解析器都处理不了的 Range，本就该答「无法满足」。没有这层
    // 兜底时，异常会从 net.fetch 直接冒泡出 protocol.handle，调用方只能看到笼统的
    // net::ERR_UNEXPECTED，而不是干净的 416。
    // signal 显式转发：<video> 快速连续拖进度条时会主动 abort 上一个还没回来的 Range
    // 请求，之前没传 signal，级联取消只靠"直接透传 res.body"隐式生效，不是显式保障。
    let res: Response
    try {
      res = await net.fetch(fileUrl, { headers: { Range: range! }, signal: request.signal })
    } catch {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
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
