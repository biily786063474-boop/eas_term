import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {packPlugin} from '../../../../scripts/pack-plugin.mjs'
import {checkPluginCompatibility} from '../../../../src/main/pluginCompatibility.ts'
import {parseManifest} from '../../../../src/main/pluginManifest.ts'
test('distributable package contains production assets, excludes tests, and rejects old host',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-package-'))
 try{
  execFileSync(process.execPath,['--check','resources/plugins/jev/server.mjs'])
  const packed=packPlugin('resources/plugins/jev',{outRoot:root,registrySchema:2})
  const files=execFileSync('unzip',['-Z1',packed.zipPath],{encoding:'utf8'})
  for(const entry of ['plugin.json','server.mjs','ui/panel.html','ui/icon.svg','skills/docs.md','THIRD_PARTY_NOTICES.md'])assert.ok(files.split('\n').includes(entry),entry)
  assert.equal(files.includes('.test.'),false);assert.equal(files.includes('fixture-fetch'),false)
  const manifest=JSON.parse(fs.readFileSync('resources/plugins/jev/plugin.json','utf8'))
  assert.equal(parseManifest(manifest,path.resolve('resources/plugins/jev'),{exists:fs.existsSync}).ok,true)
  const host={version:'0.4.105',platform:'darwin',architecture:'arm64',capabilities:['mcp.stdio','config.fields']}
  assert.equal(checkPluginCompatibility(manifest.requirements,host).ok,false)
  assert.equal(checkPluginCompatibility(manifest.requirements,{...host,capabilities:[...host.capabilities,'config.deferred']}).ok,true)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
