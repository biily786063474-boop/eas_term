import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { usesZh } from '../../../../shared/i18n/testKeys.ts'

const form=fs.readFileSync(new URL('./PluginConfigurationControls.tsx',import.meta.url),'utf8')
const panel=fs.readFileSync(new URL('../../../../../resources/plugins/jev/ui/panel.html',import.meta.url),'utf8')
const manifest=JSON.parse(fs.readFileSync(new URL('../../../../../resources/plugins/jev/plugin.json',import.meta.url),'utf8'))

test('Jev secret form places a key acquisition action beside the input and uses the in-app browser',()=>{
 assert.ok(usesZh(form,'获取密钥'),'获取密钥')
 // 2026-09-30：获取按钮改由清单 help 声明；Jev 旧包没有 help，secretHelpUrl 仍给它原来的控制台地址，同样用软件内浏览器打开
 assert.match(form,/plugin\.id==='eas:jev'&&field\.id==='api-key'\?'https:\/\/console\.typesafe\.ai\/'/)
 assert.match(form,/<WebView url=\{keyBrowserUrl!\} selected\/>/)
 assert.match(form,/setKeyBrowserUrl\(secretHelpUrl\(plugin,field\)!\)/)
})
test('Jev onboarding opens the official console rather than the documentation introduction',()=>{
 assert.match(panel,/id="getKey"/)
 assert.match(panel,/https:\/\/console\.typesafe\.ai/)
 assert.match(panel,/rpc\('ui\/open-link'/)
 assert.equal(manifest.version,'0.2.0') // decision UI and persistent recovery contract
 assert.ok(manifest.requirements.capabilities.includes('jev.decisions.v2'))
})
