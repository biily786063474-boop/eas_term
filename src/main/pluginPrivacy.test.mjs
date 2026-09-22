import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const architecture = fs.readFileSync('docs/architecture/01-系统上下文.md', 'utf8')
const privacy = fs.readFileSync('site/privacy.html', 'utf8')
test('networked stdio connectors disclose endpoints and direct-network limitations in both records', () => {
  for (const document of [architecture, privacy]) {
    for (const marker of ['web-fetch', 'restapi.amap.com', '/v3/weather/weatherInfo', '/v3/geocode/geo', '/v3/place/around', '/v3/direction/walking', '/v3/direction/driving', 'EAS_PLUGIN_CONFIG']) {
      assert.ok(document.includes(marker), `missing disclosure: ${marker}`)
    }
    assert.match(document, /系统PAC/)
    assert.match(document, /不是OS沙箱/)
  }
})
test('privacy avoids obsolete absolute no-content-egress claims', () => {
  assert.ok(!privacy.includes('唯一会把你的内容主动送出本机的功能'))
  assert.ok(!privacy.includes('它唯一往外发的是'))
  assert.ok(!privacy.includes('唯一的例外是'))
  assert.ok(!privacy.includes('你的代码和对话不出这台电脑'))
  assert.ok(!privacy.includes('这些内容一个字节都不会离开你的电脑'))
})
