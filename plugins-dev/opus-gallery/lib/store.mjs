// Opus 作品画廊 · 网络与磁盘：清单同步（ETag）、离线回退、图片缓存。
// 缓存目录由调用方给（server 里是宿主注入的 $EAS_PLUGIN_DATA）。
import fs from 'node:fs'
import path from 'node:path'
import { normalizeEntries, SLUG_RE } from './core.mjs'

export const DATA_URL = 'https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json'
export const MEDIA_BASE = 'https://media.skillry.dev/opus-5-5'
const IMAGE_CONCURRENCY = 4
const PREFETCH_CONCURRENCY = 2

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function createStore({ dir, fetchImpl = fetch, dataUrl = DATA_URL, mediaBase = MEDIA_BASE, timeoutMs = 15000, maxImageBytes = 3 * 1024 * 1024 }) {
  for (const sub of ['poster', 'preview']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  const listFile = path.join(dir, 'videos.json')
  const etagFile = path.join(dir, 'etag')
  let entries = null
  let offline = false
  let lastError = ''
  let syncing = null
  const inflight = new Map()
  let pfGen = 0
  const pfSeen = new Set()

  async function timed(url, init = {}, read = async (r) => r) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetchImpl(url, { ...init, signal: ac.signal })
      return await read(r)
    } finally {
      clearTimeout(timer)
    }
  }

  function readCache() {
    try {
      const list = normalizeEntries(JSON.parse(fs.readFileSync(listFile, 'utf8')))
      return list.length ? list : null
    } catch {
      return null
    }
  }

  async function doSync() {
    const cached = readCache()
    const headers = {}
    if (cached && fs.existsSync(etagFile)) headers['If-None-Match'] = fs.readFileSync(etagFile, 'utf8').trim()
    try {
      await timed(dataUrl, { headers }, async (r) => {
        if (r.status === 304 && cached) {
          entries = cached
          offline = false
          lastError = ''
          return
        }
        if (!r.ok) throw new Error(`上游返回 ${r.status}`)
        const text = await r.text()
        let fresh
        try {
          fresh = normalizeEntries(JSON.parse(text))
        } catch {
          throw new Error('上游清单不是合法 JSON')
        }
        if (!fresh.length) throw new Error('上游清单为空')
        writeAtomic(listFile, text)
        const etag = r.headers.get('etag')
        if (etag) writeAtomic(etagFile, etag)
        else fs.rmSync(etagFile, { force: true })
        entries = fresh
        offline = false
        lastError = ''
      })
    } catch (e) {
      lastError = e?.name === 'AbortError' ? '连接超时' : String(e?.message ?? e)
      if (cached) {
        entries = cached
        offline = true
        return
      }
      throw new Error(`拉取作品清单失败：${lastError}`)
    }
  }

  function sync() {
    syncing ??= doSync().finally(() => { syncing = null })
    return syncing
  }

  async function ensure() {
    if (!entries) await sync()
    return entries
  }

  // 并发闸：前台（4）与预热（2）各用一个，互不排队
  function createLimiter(max) {
    let active = 0
    const queue = []
    return async (fn) => {
      if (active >= max) {
        await new Promise((r) => queue.push(r))
      } else {
        active++
      }
      try {
        return await fn()
      } finally {
        if (queue.length > 0) {
          queue.shift()?.()
        } else {
          active--
        }
      }
    }
  }
  const limited = createLimiter(IMAGE_CONCURRENCY)
  const prefetchLimited = createLimiter(PREFETCH_CONCURRENCY)

  async function fetchImage(kind, entry, file, lim = limited) {
    const url = kind === 'poster' ? entry.posterUrl : `${mediaBase}/${entry.slug}/preview.webp`
    if (!url) return ''
    try {
      const buf = await lim(() => timed(url, {}, async (r) => {
        if (!r.ok) return ''
        const buf = Buffer.from(await r.arrayBuffer())
        if (!buf.length || buf.length > maxImageBytes) return ''
        writeAtomic(file, buf)
        return buf
      }))
      return buf
    } catch {
      return ''
    }
  }

  async function image(kind, entry) {
    if (kind !== 'poster' && kind !== 'preview') throw new Error(`未知图片类型 ${kind}`)
    if (!entry || !SLUG_RE.test(entry.slug)) return ''
    const file = path.join(dir, kind, `${entry.slug}.webp`)
    let buf = null
    try {
      buf = fs.readFileSync(file)
    } catch {
      const key = `${kind}:${entry.slug}`
      if (!inflight.has(key)) inflight.set(key, fetchImage(kind, entry, file).finally(() => inflight.delete(key)))
      buf = await inflight.get(key)
    }
    return buf && buf.length ? `data:image/webp;base64,${Buffer.from(buf).toString('base64')}` : ''
  }

  /** 后台预热：把这些条目的封面拉进磁盘缓存。不阻塞前台；已缓存跳过；失败静默；
   *  同一批不重复；新的一批（不同筛选/页）到来时，旧批里还没开始的任务作废。返回的 Promise 只给测试等。 */
  function prefetch(list) {
    const items = (Array.isArray(list) ? list : []).filter((e) => e && SLUG_RE.test(e.slug))
    if (!items.length) return Promise.resolve()
    const key = items.map((e) => e.slug).join(',')
    if (pfSeen.has(key)) return Promise.resolve()
    if (pfSeen.size > 200) pfSeen.clear()
    pfSeen.add(key)
    const gen = ++pfGen
    return Promise.all(items.map((entry) => prefetchLimited(async () => {
      if (gen !== pfGen) return
      const file = path.join(dir, 'poster', `${entry.slug}.webp`)
      if (fs.existsSync(file)) return
      const k = `poster:${entry.slug}`
      if (inflight.has(k)) return
      const p = fetchImage('poster', entry, file, (fn) => fn()).finally(() => inflight.delete(k))
      inflight.set(k, p)
      await p
    }).catch(() => {}))).then(() => {})
  }

  function status() {
    return { offline, lastError, all: entries?.length ?? 0 }
  }

  return { sync, ensure, image, prefetch, status }
}
