// 发布台素材信息（P3）：纯 JS 读文件头拿到时长、宽高、编码、大小。
// 不调 ffprobe 之类的外部程序（用户机器上不一定有，而且插件不该多一个依赖），不联网。
// 只读文件头：图片读前 256KB；视频逐个跳过顶层盒子，只把 moov（元数据，通常几百 KB）读进来 ——
// 绝不整读成片（一条 3 分钟的片子上百 MB）。
import fs from 'node:fs'

const HEAD = 256 * 1024
const MOOV_MAX = 32 * 1024 * 1024

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len)
  const n = fs.readSync(fd, buf, 0, len, pos)
  return buf.subarray(0, n)
}

// ── 图片 ──────────────────────────────────────────────────────────────
function png(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null
  return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}
function gif(b) {
  if (b.length < 10 || b.toString('latin1', 0, 4) !== 'GIF8') return null
  return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}
function webp(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('latin1', 12, 16)
  if (chunk === 'VP8X') return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { format: 'webp', width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) } }
  if (chunk === 'VP8 ') return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  return null
}
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2, orientation = 1
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    const len = b.readUInt16BE(i + 2)
    if (m === 0xe1 && b.toString('latin1', i + 4, i + 8) === 'Exif') orientation = exifOrientation(b, i + 10) ?? 1
    // SOF0–SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      let height = b.readUInt16BE(i + 5), width = b.readUInt16BE(i + 7)
      // EXIF 方向 5–8 = 旋转了 90°：手机竖拍的照片文件里是横的，显示出来是竖的，平台看的是显示效果
      if (orientation >= 5 && orientation <= 8) [width, height] = [height, width]
      return { format: 'jpeg', width, height, ...(orientation !== 1 ? { rotated: orientation >= 5 } : {}) }
    }
    i += 2 + len
  }
  return null
}
function exifOrientation(b, tiff) {
  if (tiff + 8 > b.length) return null
  const le = b.toString('latin1', tiff, tiff + 2) === 'II'
  const u16 = (p) => (le ? b.readUInt16LE(p) : b.readUInt16BE(p))
  const u32 = (p) => (le ? b.readUInt32LE(p) : b.readUInt32BE(p))
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > b.length) return null
  const n = u16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 10 > b.length) return null
    if (u16(e) === 0x0112) return u16(e + 8)
  }
  return null
}

// ── 视频（ISO BMFF：mp4 / mov / m4v）─────────────────────────────────
function* boxes(b, start = 0, end = b.length) {
  let i = start
  while (i + 8 <= end) {
    let size = b.readUInt32BE(i), head = 8
    const type = b.toString('latin1', i + 4, i + 8)
    if (size === 1) { if (i + 16 > end) return; size = Number(b.readBigUInt64BE(i + 8)); head = 16 }
    else if (size === 0) size = end - i
    if (size < head || i + size > end) return
    yield { type, start: i + head, end: i + size }
    i += size
  }
}
const child = (b, box, type) => { for (const c of boxes(b, box.start, box.end)) if (c.type === type) return c; return null }

function parseMoov(b) {
  const moov = { start: 0, end: b.length }
  const mvhd = child(b, moov, 'mvhd')
  let durationSec = null
  if (mvhd) {
    const v = b[mvhd.start]
    const timescale = v === 1 ? b.readUInt32BE(mvhd.start + 20) : b.readUInt32BE(mvhd.start + 12)
    const duration = v === 1 ? Number(b.readBigUInt64BE(mvhd.start + 24)) : b.readUInt32BE(mvhd.start + 16)
    if (timescale) durationSec = duration / timescale
  }
  for (const trak of boxes(b, 0, b.length)) {
    if (trak.type !== 'trak') continue
    const mdia = child(b, trak, 'mdia'), hdlr = mdia && child(b, mdia, 'hdlr')
    if (!hdlr || b.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue
    const tkhd = child(b, trak, 'tkhd')
    if (!tkhd) continue
    const v = b[tkhd.start]
    const m = tkhd.start + 4 + (v === 1 ? 32 : 20) + 16   // 跳过时间戳/ID/时长，再跳过 reserved+layer+group+volume+reserved
    const a = b.readInt32BE(m), bb = b.readInt32BE(m + 4)
    let width = Math.round(b.readUInt32BE(m + 36) / 65536), height = Math.round(b.readUInt32BE(m + 40) / 65536)
    // 矩阵是旋转 90° / 270°（手机竖拍常见）：显示宽高要对调
    const rotated = a === 0 && bb !== 0
    if (rotated) [width, height] = [height, width]
    let codec
    const minf = child(b, mdia, 'minf'), stbl = minf && child(b, minf, 'stbl'), stsd = stbl && child(b, stbl, 'stsd')
    if (stsd && stsd.start + 16 <= stsd.end) codec = b.toString('latin1', stsd.start + 12, stsd.start + 16)
    return { width, height, durationSec, ...(codec ? { codec } : {}), ...(rotated ? { rotated } : {}) }
  }
  return durationSec == null ? null : { durationSec }
}

function video(fd, size, head) {
  if (head.length < 12 || head.toString('latin1', 4, 8) !== 'ftyp') return null
  const brand = head.toString('latin1', 8, 12).trim()
  let pos = 0
  while (pos + 8 <= size) {
    const h = readAt(fd, pos, 16)
    if (h.length < 8) break
    let len = h.readUInt32BE(0), hl = 8
    const type = h.toString('latin1', 4, 8)
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); hl = 16 } else if (len === 0) len = size - pos
    if (len < hl) break
    if (type === 'moov') {
      if (len - hl > MOOV_MAX) return { format: brand === 'qt' ? 'mov' : 'mp4', error: '元数据过大，没有读取' }
      const info = parseMoov(readAt(fd, pos + hl, len - hl))
      return { format: brand === 'qt' ? 'mov' : 'mp4', ...(info ?? { error: '没找到视频轨' }) }
    }
    pos += len
  }
  return { format: brand === 'qt' ? 'mov' : 'mp4', error: '没找到 moov（文件可能没写完）' }
}

/** 读一个素材文件的信息。不是常规文件、读不了、认不出格式都返回 error，不抛 */
export function probe(file) {
  let st
  try { st = fs.statSync(file) } catch { return { error: '文件不存在' } }
  if (!st.isFile()) return { error: '不是普通文件' }
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const head = readAt(fd, 0, Math.min(HEAD, st.size))
    const img = png(head) ?? jpeg(head) ?? gif(head) ?? webp(head)
    if (img) return { kind: 'image', bytes: st.size, ...img, ratio: ratioOf(img.width, img.height) }
    const v = video(fd, st.size, head)
    if (v) return { kind: 'video', bytes: st.size, ...v, ...(v.width ? { ratio: ratioOf(v.width, v.height) } : {}) }
    return { kind: 'unknown', bytes: st.size, error: '认不出的格式（支持 mp4 / mov / png / jpeg / gif / webp）' }
  } catch (e) {
    return { error: `读取失败：${e.message}` }
  } finally { if (fd !== undefined) fs.closeSync(fd) }
}

const COMMON = [[1, 1], [3, 4], [4, 3], [9, 16], [16, 9], [4, 5], [2, 3], [3, 2], [21, 9], [1.91, 1]]
/** 宽高比：贴近常见比例（误差 1% 内）就给名字，否则给小数 */
export function ratioOf(w, h) {
  if (!w || !h) return null
  const r = w / h
  for (const [a, b] of COMMON) if (Math.abs(r - a / b) / (a / b) < 0.01) return { label: `${a}:${b}`, value: r }
  return { label: r.toFixed(2), value: r }
}
