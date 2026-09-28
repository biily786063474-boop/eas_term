import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=(p:string)=>fs.readFileSync(new URL(p,import.meta.url),'utf8')
test('panel background tool reads are not counted as user actions',()=>{
 const host=read('../pluginHost.ts'),panel=host.slice(host.indexOf('async function panelRpc'),host.indexOf('export async function pluginRpcFromShim'))
 assert.ok(!panel.includes('capturePluginActivity('))
 assert.match(host,/capturePluginActivity\(info.name,'open'\)/)
 assert.match(host,/capturePluginActivity\(name,'call'\)/)
})
test('local activity is not routed through anonymous telemetry or payload channels',()=>{
 const s=read('activityCapture.ts')
 assert.ok(!/fetch\(|net\.|telemetry|https?:/.test(s))
 assert.ok(!/params|arguments|prompt|cwd/.test(s.replace(/\/\*.*?\*\//gs,'')))
 const index=read('index.ts');assert.match(index,/if\(key==='chat'\)return/)
 assert.match(index,/e.senderFrame!==e.sender.mainFrame/)
})
