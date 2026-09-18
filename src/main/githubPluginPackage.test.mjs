import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {packPlugin} from '../../scripts/pack-plugin.mjs'
import {parseManifest} from './pluginManifest.ts'
test('GitHub package targets official remote MCP and requires a user-supplied encrypted secret',t=>{
 const dir=path.resolve('plugins-store/github'),raw=JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'))),parsed=parseManifest(raw,dir)
 assert.ok(parsed.ok);assert.equal(parsed.info.remote.url,'https://api.githubcopilot.com/mcp/')
 assert.equal(parsed.info.remote.auth,'bearer');assert.equal(parsed.info.mcp,undefined)
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'github-package-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}))
 const {entry,zipPath}=packPlugin(dir,{outRoot:out,registrySchema:2})
 assert.ok(entry.requirements.capabilities.includes('auth.bearer'));assert.equal(fs.statSync(zipPath).size,entry.size)
 assert.equal(raw.config.fields[0].type,'secret');assert.equal('value' in raw.config.fields[0],false)
})
