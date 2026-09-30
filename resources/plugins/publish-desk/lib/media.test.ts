import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probe, ratioOf } from './media.mjs'

// ── 构造 ISO BMFF 盒子 ──
const box = (type: string, ...parts: Buffer[]) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]) }
const u32 = (...v: number[]) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x >>> 0, i * 4)); return b }
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b }
function mvhd(v: 0 | 1, timescale: number, duration: number) {
  return v === 0 ? box('mvhd', u32(0, 0, 0, timescale, duration), Buffer.alloc(80)) : box('mvhd', u32(1 << 24), u64(0), u64(0), u32(timescale), u64(duration), Buffer.alloc(80))
}
function tkhd(w: number, h: number, rotate90 = false) {
  const matrix = rotate90 ? u32(0, 0x10000, 0, -0x10000 >>> 0, 0, 0, 0, 0, 0x40000000) : u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
  return box('tkhd', u32(0x3, 0, 0, 1, 0, 0), Buffer.alloc(16), matrix, u32(w * 65536, h * 65536))
}
const hdlr = (t: string) => box('hdlr', u32(0, 0), Buffer.from(t, 'latin1'), Buffer.alloc(12))
const stsd = (codec: string) => box('stsd', u32(0, 1), u32(16), Buffer.from(codec, 'latin1'), Buffer.alloc(8))
const trak = (handler: string, w: number, h: number, rot = false) => box('trak', tkhd(w, h, rot), box('mdia', hdlr(handler), box('minf', box('stbl', stsd('avc1')))))
const ftyp = (brand = 'isom') => box('ftyp', Buffer.from(brand, 'latin1'), u32(0))

function tmp(t: import('node:test').TestContext, name: string, data: Buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-media-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const f = path.join(dir, name); fs.writeFileSync(f, data); return f
}

test('mp4：moov 在文件末尾也能读到（先跳过 mdat），取视频轨而不是音频轨', (t) => {
  const f = tmp(t, 'a.mp4', Buffer.concat([ftyp(), box('mdat', Buffer.alloc(5000)), box('moov', mvhd(0, 1000, 176043), trak('soun', 0, 0), trak('vide', 1080, 1440))]))
  const r = probe(f)
  assert.equal(r.kind, 'video')
  assert.deepEqual([r.width, r.height, r.durationSec, r.codec, r.ratio.label], [1080, 1440, 176.043, 'avc1', '3:4'])
})

test('mp4：手机竖拍的 90° 旋转矩阵 → 宽高对调；64 位 mvhd 也能读', (t) => {
  const f = tmp(t, 'b.mov', Buffer.concat([ftyp('qt  '), box('moov', mvhd(1, 600, 600 * 30), trak('vide', 1920, 1080, true))]))
  const r = probe(f)
  assert.deepEqual([r.format, r.width, r.height, r.durationSec, r.rotated, r.ratio.label], ['mov', 1080, 1920, 30, true, '9:16'])
})

test('mp4：没写完（没有 moov）不抛，返回原因', (t) => {
  const r = probe(tmp(t, 'c.mp4', Buffer.concat([ftyp(), box('mdat', Buffer.alloc(100))])))
  assert.match(r.error, /moov/)
})

test('图片：png / gif / webp / jpeg（含 EXIF 竖拍方向）', (t) => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(1280, 720), Buffer.alloc(5)])
  assert.deepEqual((({ format, width, height }) => [format, width, height])(probe(tmp(t, 'a.png', png))), ['png', 1280, 720])
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00]), Buffer.alloc(8)])
  assert.deepEqual([probe(tmp(t, 'a.gif', gif)).width, probe(tmp(t, 'a.gif', gif)).height], [320, 240])
  const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12); vp8x.writeUIntLE(1079, 24, 3); vp8x.writeUIntLE(1439, 27, 3)
  assert.deepEqual([probe(tmp(t, 'a.webp', vp8x)).width, probe(tmp(t, 'a.webp', vp8x)).height], [1080, 1440])
  // JPEG：APP1 EXIF（方向 6 = 顺时针 90°）+ SOF0 4032×3024 → 显示为 3024×4032
  const tiff = Buffer.concat([Buffer.from('MM'), Buffer.from([0, 42]), u32(8), Buffer.from([0, 1]), Buffer.from([0x01, 0x12, 0, 3]), u32(1), Buffer.from([0, 6, 0, 0]), u32(0)])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, 0]), Buffer.from('Exif\0\0'), tiff]); app1.writeUInt16BE(app1.length - 2, 2)
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0x0b, 0xd0, 0x0f, 0xc0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])])
  const r = probe(tmp(t, 'a.jpg', jpg))
  assert.deepEqual([r.format, r.width, r.height, r.rotated, r.ratio.label], ['jpeg', 3024, 4032, true, '3:4'])
})

test('不是文件 / 不存在 / 认不出：返回原因，不抛', (t) => {
  assert.match(probe(os.tmpdir()).error, /不是普通文件/)
  assert.match(probe('/nope/x.mp4').error, /不存在/)
  assert.match(probe(tmp(t, 'x.txt', Buffer.from('hello world'))).error, /认不出/)
})

test('比例命名：贴近常见比例才给名字', () => {
  assert.equal(ratioOf(1080, 1440).label, '3:4')
  assert.equal(ratioOf(1080, 1920).label, '9:16')
  assert.equal(ratioOf(1000, 700).label, '1.43')
})
