import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkCardMedia, mediaChecklist, mediaInfo } from './mediaCheck.mjs'
import { platformOf, PLATFORMS } from './platforms.mjs'

// 最小 mp4：ftyp + moov(mvhd + 视频轨 tkhd)，时长秒 / 宽高可调；pad 撑文件大小
const box = (type: string, ...parts: Buffer[]) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]) }
const u32 = (...v: number[]) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x >>> 0, i * 4)); return b }
function mp4(sec: number, w: number, h: number) {
  const tkhd = box('tkhd', u32(3, 0, 0, 1, 0, 0), Buffer.alloc(16), u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000), u32(w * 65536, h * 65536))
  const trak = box('trak', tkhd, box('mdia', box('hdlr', u32(0, 0), Buffer.from('vide'), Buffer.alloc(12))))
  return Buffer.concat([box('ftyp', Buffer.from('isom'), u32(0)), box('moov', box('mvhd', u32(0, 0, 0, 1000, sec * 1000), Buffer.alloc(80)), trak)])
}
function file(t: import('node:test').TestContext, name: string, data: Buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-mc-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const f = path.join(dir, name); fs.writeFileSync(f, data); return f
}
const issues = (f: string, id: string) => checkCardMedia([f], platformOf(id).media).items[0].issues.map((i: any) => [i.level, i.message])

test('每个平台的素材规格数值都带来源；参考值和官方值分开', () => {
  for (const p of PLATFORMS) {
    const m = p.media
    if (!m) continue
    for (const kind of ['video', 'image']) for (const r of Object.values(m[kind] ?? {}) as any[]) { assert.match(r.source, /^https:\/\//, p.id); assert.equal(typeof r.verified, 'boolean') }
    if (m.cover) assert.match(m.cover.source, /^https:\/\//)
  }
  // 国内五个平台只有参考值
  for (const id of ['xiaohongshu', 'douyin', 'channels']) for (const r of Object.values(platformOf(id).media.video ?? {}) as any[]) assert.equal(r.verified, false, id)
})

test('X：3 分钟竖版超官方时长上限 → 超限；3:4 在比例范围内', (t) => {
  const f = file(t, 'a.mp4', mp4(176, 1080, 1440))
  assert.deepEqual(issues(f, 'x'), [['over', '时长 2分56秒，超过上限 2分20秒']])
})

test('YouTube Shorts：超 3 分钟 / 横屏不是超限，是会变普通视频', (t) => {
  assert.deepEqual(issues(file(t, 'a.mp4', mp4(176, 1080, 1440)), 'youtube-shorts'), [])
  const long = issues(file(t, 'b.mp4', mp4(200, 1920, 1080)), 'youtube-shorts')
  assert.deepEqual(long.map((x) => x[0]), ['warn', 'warn'])
  assert.match(long[0][1], /普通视频/); assert.match(long[1][1], /普通视频/)
})

test('参考值超了只提醒：视频号比例 0.33–3 之外', (t) => {
  const [[level, msg]] = issues(file(t, 'a.mp4', mp4(10, 400, 1500)), 'channels')
  assert.equal(level, 'warn'); assert.match(msg, /以上传页提示为准/)
})

test('Product Hunt 不收视频文件；知乎没有规格 → 不检查也不说「符合」', (t) => {
  const f = file(t, 'a.mp4', mp4(30, 1080, 1440))
  assert.match(issues(f, 'producthunt')[0][1], /YouTube 链接/)
  const r = checkCardMedia([f], platformOf('zhihu').media)
  assert.deepEqual([r.items[0].checked, r.items[0].issues.length], [false, 0])
  assert.equal(checkCardMedia([f], platformOf('x').media).items[0].checked, true)
})

test('Bluesky 图片最多 4 张（官方 lexicon）', (t) => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(100, 100), Buffer.alloc(5)])
  const fs5 = [1, 2, 3, 4, 5].map((i) => file(t, `${i}.png`, png))
  assert.deepEqual(checkCardMedia(fs5, platformOf('bluesky').media).issues.map((i: any) => i.message), ['图片 5 张，超过上限 4 张'])
})

test('素材清单由规格生成，参考值带「（参考）」', () => {
  assert.deepEqual(mediaChecklist(platformOf('x').media).slice(0, 1), ['视频：≤2分20秒，≤512MB，比例 1:2.39–2.39:1'])
  assert.match(mediaChecklist(platformOf('channels').media)[0], /（参考）/)
  assert.match(mediaChecklist(platformOf('producthunt').media)[0], /不能直接上传视频文件/)
})

test('读过的文件有缓存；文件变了会重读', (t) => {
  const f = file(t, 'a.mp4', mp4(10, 1080, 1920))
  assert.equal(mediaInfo(f).durationSec, 10)
  fs.writeFileSync(f, mp4(20, 1080, 1920)); fs.utimesSync(f, new Date(), new Date(Date.now() + 5000))
  assert.equal(mediaInfo(f).durationSec, 20)
})
