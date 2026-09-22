import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {migrateTimeline} from './pluginMigration.ts'

function fixture(t:{after:(fn:()=>void)=>void}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'eas-migrate-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}))
 const seed=path.join(base,'seed','timeline'),home=path.join(base,'home');fs.mkdirSync(seed,{recursive:true});fs.mkdirSync(home)
 fs.writeFileSync(path.join(seed,'plugin.json'),JSON.stringify({name:'timeline',version:'1.0.0',mcp:{command:'node',args:['./server.mjs']}}));fs.writeFileSync(path.join(seed,'server.mjs'),'// trusted seed')
 return {base,seed,home,dest:path.join(home,'.eas','plugins','timeline')}
}
test('offline migration preserves data/grants and installs official independent copy once',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.home,'history.json'),'history');assert.equal(migrateTimeline(f.home,f.seed),'installed')
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dest,'.eas-market-source.json'),'utf8')).id,'official')
 assert.equal(fs.readFileSync(path.join(f.home,'history.json'),'utf8'),'history')
 fs.rmSync(f.dest,{recursive:true});assert.equal(migrateTimeline(f.home,f.seed),'done');assert.equal(fs.existsSync(f.dest),false)
})
test('existing user copy is untouched including unknown provenance',t=>{
 const f=fixture(t);fs.mkdirSync(f.dest,{recursive:true});fs.writeFileSync(path.join(f.dest,'plugin.json'),'user copy')
 assert.equal(migrateTimeline(f.home,f.seed),'preserved');assert.equal(fs.readFileSync(path.join(f.dest,'plugin.json'),'utf8'),'user copy')
 assert.equal(fs.existsSync(path.join(f.dest,'.eas-market-source.json')),false)
})
test('bad seed leaves retry possible without partial install',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.seed,'plugin.json'),'bad');assert.throws(()=>migrateTimeline(f.home,f.seed));assert.equal(fs.existsSync(f.dest),false)
 fs.writeFileSync(path.join(f.seed,'plugin.json'),JSON.stringify({name:'timeline',version:'1.0.0',mcp:{command:'node',args:['./server.mjs']}}))
 assert.equal(migrateTimeline(f.home,f.seed),'installed')
})
test('symlink destination parent rejected without writing outside home',t=>{
 const f=fixture(t);const outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.home,'.eas'))
 assert.throws(()=>migrateTimeline(f.home,f.seed),/软链/);assert.deepEqual(fs.readdirSync(outside),[])
})
test('seed symlinks rejected and migration not marked complete',t=>{
 const f=fixture(t);fs.symlinkSync('/etc/passwd',path.join(f.seed,'unsafe'))
 assert.throws(()=>migrateTimeline(f.home,f.seed),/软链/);assert.equal(fs.existsSync(f.dest),false)
})
test('corrupted completion marker fails closed',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.home,'.eas'),{recursive:true});fs.writeFileSync(path.join(f.home,'.eas','timeline-independent-v1.json'),'bad')
 assert.throws(()=>migrateTimeline(f.home,f.seed));assert.equal(fs.existsSync(f.dest),false)
})
test('packaging separates offline seed from runtime builtin plugins',()=>{
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
 const resources=pkg.build.extraResources
 const plugins=resources.find((r:{to:string})=>r.to==='plugins')
 assert.ok(plugins.filter.includes('!timeline{,/**}'))
 assert.ok(resources.some((r:{from:string;to:string})=>r.from==='resources/plugins/timeline'&&r.to==='plugin-migrations/timeline'))
 const code=fs.readFileSync('src/main/plugins.ts','utf8')
 assert.ok(code.includes('migrateTimeline(os.homedir(), timelineSeedDir())'))
 assert.ok(code.includes(".filter(p => p.name !== 'timeline')"))
})
test('completed migration no longer requires seed to ship',t=>{
 const f=fixture(t);migrateTimeline(f.home,f.seed);fs.rmSync(path.dirname(f.seed),{recursive:true})
 assert.equal(migrateTimeline(f.home,f.seed),'done')
})
test('symlink completion marker and existing destination fail closed',t=>{
 const f=fixture(t);fs.mkdirSync(path.dirname(f.dest),{recursive:true});fs.symlinkSync(f.seed,f.dest)
 assert.throws(()=>migrateTimeline(f.home,f.seed),/软链/)
 assert.equal(fs.existsSync(path.join(f.seed,'.eas-market-source.json')),false)
})
