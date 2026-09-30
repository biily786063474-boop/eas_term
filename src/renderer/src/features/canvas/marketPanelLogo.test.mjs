import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const src=fs.readFileSync(new URL('./CanvasMarketPanel.tsx',import.meta.url),'utf8')
test('drawer market panel uses PluginLogo for installed and discover rows, no letter avatar',()=>{
 assert.equal(src.includes('avatar('),false)
 assert.match(src,/import \{ PluginLogo \} from '\.\/pluginLogos'/)
 assert.match(src,/<PluginLogo name=\{p\.name\} brandColor=\{p\.brandColor\} iconDataUrl=\{p\.iconDataUrl\}/)
 assert.match(src,/<PluginLogo name=\{e\.name\} brandColor=\{e\.brandColor\} iconDataUrl=\{e\.iconDataUrl\}/)
})
