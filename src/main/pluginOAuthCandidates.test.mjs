import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {parseManifest} from './pluginManifest.ts'
import {buildPluginRegistries} from '../../scripts/plugin-registry-build.mjs'
test('Notion and Sentry candidates package approved dynamic endpoints without secrets or legacy exposure',t=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'oauth-candidates-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}))
 const roots=['notion','sentry'].map(name=>path.resolve('plugins-store',name))
 for(const root of roots){
  const raw=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8')),result=parseManifest(raw,root)
  assert.ok(result.ok);if(!result.ok)return
  assert.equal(result.info.remote?.auth,'oauth');assert.equal(result.info.mcp,undefined)
  assert.ok(raw.requirements.capabilities.includes('auth.oauth.dcr'))
  assert.equal(raw.mcp.oauth.clientId,undefined);assert.equal(raw.mcp.oauth.clientSecret,undefined)
  assert.equal(raw.mcp.approvedOrigins.length,1)
  assert.equal(new URL(raw.mcp.oauth.registrationEndpoint).origin,raw.mcp.approvedOrigins[0])
  assert.match(raw.description,/未验收/)
 }
 const {v1,v2}=buildPluginRegistries({plugins:roots,outRoot:out})
 assert.equal(v1.plugins.length,0);assert.deepEqual(v2.plugins.map(p=>p.name).sort(),['notion','sentry'])
 for(const entry of v2.plugins)assert.ok(fs.statSync(path.join(out,entry.name,entry.name+'-'+entry.version+'.zip')).size>0)
 // Default distribution must not quietly promote unverified candidates.
 const defaults=fs.readFileSync('scripts/build-plugin-registry.mjs','utf8')
 for(const name of ['notion','sentry'])assert.ok(!defaults.includes('plugins-store/'+name))
})
