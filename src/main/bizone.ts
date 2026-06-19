// 笔纵画板（bizone-canvas）本地联动：读取其生图历史并支持插入到项目 V-assets。
// 数据布局（由 taptv 源码确认）：
//   ~/Library/Application Support/笔纵画板/BizoneCanvasData/
//     projects/_index.json            项目索引 [{id,name,updatedAt,...}]
//     projects/<projectId>.json       项目节点，node.mediaId 引用本地媒体
//     media/<mediaId>.bin             媒体二进制
//     media/<mediaId>.meta.json       { mimeType, size, createdAt }
import { app, ipcMain, net, protocol, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { pathToFileURL } from 'url'
import type { BizoneCheck, BizoneProject, BizoneMedia, InsertResult } from '../shared/types'

const WEBSITE = 'https://bzone.biily.top'
const VERSION_URL = 'https://bzone.biily.top/version.json'
const APP_BUNDLE = '/Applications/笔纵画板.app'
const MEDIA_ID_RE = /^media_\d+_[a-z0-9]+$/i

const dataDir = (): string =>
  path.join(app.getPath('appData'), '笔纵画板', 'BizoneCanvasData')
const mediaDir = (): string => path.join(dataDir(), 'media')
const projectsDir = (): string => path.join(dataDir(), 'projects')

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
}

interface MediaMeta {
  mimeType?: string
  size?: number
  createdAt?: number
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function readMeta(mediaId: string): MediaMeta | null {
  return readJson<MediaMeta>(path.join(mediaDir(), `${mediaId}.meta.json`))
}

function kindOf(mimeType: string): 'image' | 'video' {
  return mimeType.startsWith('video/') ? 'video' : 'image'
}

export function registerBizoneScheme(): void {
  // 必须在 app ready 前调用
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'bizone-media',
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

export function registerBizoneHandlers(): void {
  // bizone-media://local/<mediaId> → 流式返回 .bin，带正确 Content-Type
  protocol.handle('bizone-media', async (request) => {
    const id = new URL(request.url).pathname.replace(/^\//, '')
    if (!MEDIA_ID_RE.test(id)) return new Response('bad id', { status: 400 })
    const bin = path.join(mediaDir(), `${id}.bin`)
    if (!fs.existsSync(bin)) return new Response('not found', { status: 404 })
    const mime = readMeta(id)?.mimeType ?? 'application/octet-stream'
    const res = await net.fetch(pathToFileURL(bin).toString())
    return new Response(res.body, { status: 200, headers: { 'Content-Type': mime } })
  })

  ipcMain.handle('bizone:check', async (): Promise<BizoneCheck> => {
    const installed = fs.existsSync(APP_BUNDLE) || fs.existsSync(dataDir())
    let downloadUrl = WEBSITE
    if (!installed) {
      // 尽力取最新安装包直链（按平台选 Win/Mac），失败则退回官网
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 2500)
        const res = await net.fetch(VERSION_URL, { signal: ctrl.signal })
        clearTimeout(timer)
        const json = (await res.json()) as {
          downloadUrlMac?: string
          downloadUrlWin?: string
          downloadUrl?: string
        }
        const platformUrl = process.platform === 'win32' ? json.downloadUrlWin : json.downloadUrlMac
        downloadUrl = platformUrl ?? json.downloadUrl ?? WEBSITE
      } catch {
        // 离线时退回官网
      }
    }
    return { installed, website: WEBSITE, downloadUrl }
  })

  ipcMain.handle('bizone:listProjects', (): BizoneProject[] => {
    interface IndexEntry {
      id: string
      name: string
      updatedAt?: number
      nodeCount?: number
    }
    const index = readJson<IndexEntry[]>(path.join(projectsDir(), '_index.json')) ?? []
    let mediaCount = 0
    try {
      mediaCount = fs.readdirSync(mediaDir()).filter((f) => f.endsWith('.bin')).length
    } catch {
      // media 目录不存在
    }
    const projects: BizoneProject[] = index
      .filter((p) => p && p.id)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((p) => ({
        id: p.id,
        name: p.name || '未命名项目',
        updatedAt: p.updatedAt ?? 0,
        nodeCount: p.nodeCount ?? 0
      }))
    return [
      { id: '__all__', name: '全部媒体', updatedAt: Date.now(), nodeCount: mediaCount },
      ...projects
    ]
  })

  ipcMain.handle('bizone:listMedia', (_e, projectId: string): BizoneMedia[] => {
    const out: BizoneMedia[] = []
    if (projectId === '__all__') {
      let files: string[] = []
      try {
        files = fs.readdirSync(mediaDir()).filter((f) => f.endsWith('.meta.json'))
      } catch {
        return []
      }
      for (const f of files) {
        const mediaId = f.slice(0, -'.meta.json'.length)
        if (!MEDIA_ID_RE.test(mediaId)) continue
        const meta = readMeta(mediaId)
        if (!meta?.mimeType) continue
        if (!fs.existsSync(path.join(mediaDir(), `${mediaId}.bin`))) continue
        out.push({
          mediaId,
          kind: kindOf(meta.mimeType),
          mimeType: meta.mimeType,
          size: meta.size ?? 0,
          createdAt: meta.createdAt ?? 0
        })
      }
    } else {
      interface Node {
        type?: string
        title?: string
        mediaId?: string | null
        history?: { prompt?: string; model?: string }[]
        popupState?: { prompt?: string }
      }
      const proj = readJson<{ nodes?: Node[] }>(path.join(projectsDir(), `${projectId}.json`))
      for (const node of proj?.nodes ?? []) {
        if (!node.mediaId || !MEDIA_ID_RE.test(node.mediaId)) continue
        if (node.type !== 'image' && node.type !== 'video') continue
        if (!fs.existsSync(path.join(mediaDir(), `${node.mediaId}.bin`))) continue
        const meta = readMeta(node.mediaId)
        const mime = meta?.mimeType ?? (node.type === 'video' ? 'video/mp4' : 'image/png')
        const last = node.history?.[node.history.length - 1]
        out.push({
          mediaId: node.mediaId,
          kind: kindOf(mime),
          mimeType: mime,
          size: meta?.size ?? 0,
          createdAt: meta?.createdAt ?? 0,
          title: node.title,
          prompt: last?.prompt || node.popupState?.prompt || undefined,
          model: last?.model
        })
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  })

  ipcMain.handle(
    'bizone:insertToVAssets',
    async (_e, mediaId: string, projectPath: string): Promise<InsertResult> => {
      try {
        if (!MEDIA_ID_RE.test(mediaId)) return { ok: false, error: '非法的媒体 ID' }
        const bin = path.join(mediaDir(), `${mediaId}.bin`)
        if (!fs.existsSync(bin)) return { ok: false, error: '媒体文件不存在' }
        if (!fs.statSync(projectPath).isDirectory()) return { ok: false, error: '项目路径无效' }
        const meta = readMeta(mediaId)
        const ext = EXT_BY_MIME[meta?.mimeType ?? ''] ?? 'bin'
        const vDir = path.join(projectPath, 'V-assets')
        await fs.promises.mkdir(vDir, { recursive: true })
        const d = new Date(meta?.createdAt ?? Date.now())
        const pad = (n: number): string => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
        const suffix = mediaId.split('_').pop()
        let name = `bz_${stamp}_${suffix}.${ext}`
        let i = 1
        while (fs.existsSync(path.join(vDir, name))) {
          name = `bz_${stamp}_${suffix}-${i++}.${ext}`
        }
        await fs.promises.copyFile(bin, path.join(vDir, name))
        return { ok: true, relPath: `V-assets/${name}`, absPath: path.join(vDir, name) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('bizone:revealMedia', (_e, mediaId: string) => {
    if (!MEDIA_ID_RE.test(mediaId)) return
    const target = path.join(mediaDir(), `${mediaId}.bin`)
    // 绝对路径 /usr/bin/open：打包应用 PATH 受限，'open' 可能找不到（见 fs.ts 同因）
    if (process.platform === 'darwin') {
      execFile('/usr/bin/open', ['-R', target], (err) => {
        if (err) shell.showItemInFolder(target)
      })
    } else {
      shell.showItemInFolder(target)
    }
  })
}
