import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const dir=new URL('../../src/renderer/src/features/dict/',import.meta.url)
test('every design has a distinct packaged cover and a verified-source preview URL',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('design-systems.json',dir)))
 const manifest=JSON.parse(fs.readFileSync(new URL('design-previews.json',dir)))
 for(const r of rows){const p=manifest[r.slug];assert.ok(p,r.slug);if(!p.cover){assert.ok(p.unavailableReason,r.slug);continue;}assert.equal(p.cover,`design-covers/${r.slug}.jpg`);assert.equal(new URL(p.previewUrl).hostname,'cdn.vechooool.com');const file=new URL('../../src/renderer/public/'+p.cover,import.meta.url);assert.ok(fs.statSync(file).size>1000,r.slug)}
})
test('mock preview cannot regress back into the picker',()=>{
 const s=fs.readFileSync(new URL('DesignPicker.tsx',dir),'utf8');assert.ok(s.includes('dsp-cover'));assert.ok(!s.includes('你的下一个好想法'));assert.ok(s.includes('原页面封面暂不可用'))
})
