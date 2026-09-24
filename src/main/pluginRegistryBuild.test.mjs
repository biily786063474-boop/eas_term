import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as builder from '../../scripts/plugin-registry-build.mjs'
import {parseCatalog} from './pluginCatalog.ts'
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-dual-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const out=path.join(root,'out');const plugin=(name,requirements)=>{const dir=path.join(root,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name,version:'1.0.0',mcp:{command:'node'},...(requirements?{requirements}:{})}));return dir};return {root,out,plugin}}
test('dual catalogs isolate requirement-bearing packages from legacy and validate v2 unavailable reasons',t=>{
 const f=fixture(t),dirs=[f.plugin('legacy'),f.plugin('new-host',{capabilities:['mcp.remote']})]
 builder.buildPluginRegistries({plugins:dirs,outRoot:f.out,unavailable:[{name:'pending',displayName:'Pending',reason:'Platform registration required'}]})
 const v1=JSON.parse(fs.readFileSync(path.join(f.out,'registry.json'))),v2=JSON.parse(fs.readFileSync(path.join(f.out,'v2/registry.json')))
 assert.equal(v1.schema,1);assert.deepEqual(v1.plugins.map(x=>x.name),['legacy']);assert.equal(v2.schema,2);assert.equal(v2.plugins.length,2)
 assert.equal(v2.unavailable[0].name,'pending');assert.equal(parseCatalog(v2,{allowedHosts:['eas.biily.top']}).ok,true)
 for(const entry of v2.plugins)assert.equal(fs.statSync(path.join(f.out,entry.name,entry.name+'-'+entry.version+'.zip')).size,entry.size)
})
test('same version is immutable and a failed build leaves both catalogs and old archive untouched',t=>{
 const f=fixture(t),dir=f.plugin('legacy')
 builder.buildPluginRegistries({plugins:[dir],outRoot:f.out})
 const paths=['registry.json','v2/registry.json','legacy/legacy-1.0.0.zip'],before=paths.map(x=>fs.readFileSync(path.join(f.out,x)))
 fs.writeFileSync(path.join(dir,'new-file.txt'),'changed package')
 assert.throws(()=>builder.buildPluginRegistries({plugins:[dir],outRoot:f.out}),/version|版本/)
 paths.forEach((x,i)=>assert.deepEqual(fs.readFileSync(path.join(f.out,x)),before[i]))
 assert.equal(fs.readdirSync(f.out).some(x=>x.startsWith('.build-')),false)
})
test('unavailable download fields and duplicate names are rejected before catalog promotion',t=>{
 const f=fixture(t),dir=f.plugin('legacy')
 assert.throws(()=>builder.buildPluginRegistries({plugins:[dir],outRoot:f.out,unavailable:[{name:'bad',displayName:'Bad',reason:'pending',url:'https://eas.biily.top/fake.zip'}]}),/目录/)
 assert.equal(fs.existsSync(path.join(f.out,'registry.json')),false)
 assert.throws(()=>builder.buildPluginRegistries({plugins:[dir,dir],outRoot:f.out}),/重复/)
})
test('catalog v2 directory cannot redirect a build through a symlink',t=>{
 const f=fixture(t),dir=f.plugin('legacy'),outside=path.join(f.root,'outside')
 fs.mkdirSync(f.out);fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.out,'v2'),'dir')
 assert.throws(()=>builder.buildPluginRegistries({plugins:[dir],outRoot:f.out}),/symbolic|符号/)
 assert.deepEqual(fs.readdirSync(outside),[])
 assert.equal(fs.existsSync(path.join(f.out,'registry.json')),false)
})
test('market details bind to exact published version and package digest',t=>{
 const f=fixture(t),details=path.join(f.root,'details');fs.mkdirSync(details)
 const entry={name:'board',version:'1.0.0',sha256:'a'.repeat(64)}
 fs.writeFileSync(path.join(details,'board.json'),JSON.stringify({name:'board',version:'1.0.0',sha256:'a'.repeat(64),detail:{summary:'整理任务'}}))
 assert.equal(builder.attachDetails([entry],details)[0].detail.summary,'整理任务')
 assert.throws(()=>builder.attachDetails([{...entry,sha256:'b'.repeat(64)}],details),/哈希|digest|版本/)
})
