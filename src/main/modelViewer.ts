import { guardedHandle } from './ipcGuard'
import { app, net, protocol, WebContents } from 'electron'
import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import {
  MODEL_VIEWER_FILE,
  MODEL_VIEWER_URL,
  MODEL_VIEWER_SHA256,
  MODEL_VIEWER_SIZE
} from '../shared/modelViewerDep'

// 3D 模型预览的主进程侧：一个按需下载的查看器（model-viewer，不进主包）+ 一个隔离用的
// easmodel:// 特权 scheme。设计见 docs/superpowers/specs/2026-09-16-3d-model-preview-design.md。
//
// 隔离：.glb 跑在一个裸 <webview> 里，加载 easmodel://view/<glb> —— 这里现生成一个查看器
// HTML（内联 <model-viewer>），CSP 走响应头、只放行本 scheme。主渲染层 CSP 一个字不动。

const depsDir = (): string => path.join(app.getPath('userData'), 'deps')
const depFile = (): string => path.join(depsDir(), MODEL_VIEWER_FILE)

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
/** 查看器是否已下载且校验通过。 */
function installed(): boolean {
  try {
    return fs.statSync(depFile()).isFile() && sha256(depFile()) === MODEL_VIEWER_SHA256
  } catch {
    return false
  }
}

// base64url → 绝对路径。
function decodeEnc(enc: string): string | null {
  try {
    const b64 = enc.replace(/-/g, '+').replace(/_/g, '/')
    const p = Buffer.from(b64, 'base64').toString('utf8')
    return p || null
  } catch {
    return null
  }
}

// 现生成的查看器页。model-viewer 只从 lib（脚本）和内联的 data: URL（模型）取数据 ——
// **不让它 fetch 自定义 scheme**：Electron 里对自定义 scheme 的 fetch 在这套 webview 下取不到
// （script/navigation 能加载，fetch 一律「Failed to fetch」、handler 都到不了）。所以把 .glb 直接
// base64 内联成 data: URL 塞进 src。CSP 只放行 easmodel:（脚本）+ data:/blob:（模型与内部贴图）。
// 主渲染层的 CSP 与此无关（webview 是独立文档，独立 CSP）。
function viewerHtml(glbBase64: string): string {
  const csp = [
    "default-src 'none'",
    "script-src easmodel:",
    "connect-src data: blob:",
    "img-src data: blob:",
    "style-src easmodel: 'unsafe-inline'",
    "worker-src blob:",
    "base-uri 'none'"
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;height:100%;background:#0b0d12;overflow:hidden}
model-viewer{width:100%;height:100vh;--poster-color:transparent}</style>
<script src="easmodel://m/lib"></script></head>
<body><model-viewer src="data:model/gltf-binary;base64,${glbBase64}" camera-controls auto-rotate
 loading="eager" reveal="auto" interaction-prompt="none" shadow-intensity="1" exposure="1" tone-mapping="neutral"></model-viewer>
</body></html>`
}

/** 注册 easmodel 为 privileged —— 必须在 app ready 前，和 registerMediaScheme 一起调。 */
export function registerModelScheme(): void {
  // corsEnabled 是关键：model-viewer 用 fetch() 取 .glb，光有 supportFetchAPI 还不够，
  // 没 corsEnabled 的话对本 scheme 的 fetch 一律「Failed to fetch」、请求都到不了 handler。
  protocol.registerSchemesAsPrivileged([
    { scheme: 'easmodel', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

let downloading: Promise<{ ok: boolean; error?: string }> | null = null

async function download(wc: WebContents | undefined): Promise<{ ok: boolean; error?: string }> {
  if (installed()) return { ok: true }
  if (downloading) return downloading
  const send = (p: object): void => { if (wc && !wc.isDestroyed()) wc.send('modelDep:downloadProgress', p) }
  downloading = (async () => {
    fs.mkdirSync(depsDir(), { recursive: true })
    const dest = depFile()
    const tmp = dest + '.part'
    try {
      const res = await net.fetch(MODEL_VIEWER_URL)
      if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status}`)
      const out = fs.createWriteStream(tmp)
      const reader = res.body.getReader()
      let received = 0
      send({ phase: 'downloading', received, total: MODEL_VIEWER_SIZE })
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        out.write(Buffer.from(value))
        received += value.byteLength
        send({ phase: 'downloading', received, total: MODEL_VIEWER_SIZE })
      }
      await new Promise<void>((r) => out.end(r))
      if (sha256(tmp) !== MODEL_VIEWER_SHA256) {
        fs.unlinkSync(tmp)
        throw new Error('查看器校验失败，请重试')
      }
      fs.renameSync(tmp, dest)
      send({ phase: 'done', received, total: MODEL_VIEWER_SIZE })
      return { ok: true }
    } catch (e) {
      try { fs.existsSync(tmp) && fs.unlinkSync(tmp) } catch { /* ignore */ }
      const error = e instanceof Error ? e.message : String(e)
      send({ phase: 'error', error })
      return { ok: false, error }
    } finally {
      downloading = null
    }
  })()
  return downloading
}

async function handleEasmodel(request: GlobalRequest): Promise<GlobalResponse> {
  // easmodel://m/<kind>/<enc?> —— 全部同一个 host（m），只按路径首段分资源，避免跨源
  // （view/lib/model 分成不同 host 会是不同 origin，model-viewer 取 .glb 的 fetch 被 CORS 拦）。
  const parts = new URL(request.url).pathname.replace(/^\//, '').split('/')
  const kind = parts[0] // lib / viewer / asset
  const enc = parts.slice(1).join('/')

  if (kind === 'lib') {
    if (!installed()) return new Response('viewer not installed', { status: 404 })
    const body = fs.readFileSync(depFile())
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })
  }

  if (kind === 'viewer') {
    const filePath = decodeEnc(enc)
    // 路径白名单：绝对路径 + 存在 + 扩展名必须是 .glb（首版只收单文件 glb），否则拒。
    if (!filePath || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.glb' || !fs.existsSync(filePath))
      return new Response('not found', { status: 404 })
    // 把 .glb 直接 base64 内联进 data: URL（见 viewerHtml 头注：自定义 scheme 的 fetch 走不通）。
    const glbBase64 = fs.readFileSync(filePath).toString('base64')
    return new Response(viewerHtml(glbBase64), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  return new Response('bad request', { status: 400 })
}

export function registerModelViewerHandlers(): void {
  guardedHandle('modelDep:status', () => ({ installed: installed() }))
  guardedHandle('modelDep:download', (e) => download(e.sender as WebContents))
  // 默认 session（easfile 等同一处）。webview 也用默认 session（不设 partition），
  // 否则 handler 够不着；而独立 partition 上 fetch 又取不到 .glb。
  protocol.handle('easmodel', handleEasmodel)
}
