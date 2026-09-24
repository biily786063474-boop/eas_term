import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCatalog} from './pluginCatalog.ts'
const options={allowedHosts:['eas.biily.top']}
test('v2 unavailable entries have reasons and never become installable archives',()=>{
 const r=parseCatalog({schema:2,plugins:[],unavailable:[{name:'canva',displayName:'Canva',category:'Design',reason:'等待应用回调审核',source:'https://www.canva.dev/docs/mcp/'}]},options)
 assert.ok(r.ok);if(!r.ok)return
 assert.equal(r.entries.length,0);assert.equal(r.unavailable[0].reason,'等待应用回调审核')
 assert.equal(parseCatalog({schema:2,plugins:[],unavailable:[{name:'canva',displayName:'Canva',reason:'pending',url:'https://eas.biily.top/fake.zip'}]},options).ok,false)
})
test('v1 stays compatible, unknown schemas and conflicting identities fail closed',()=>{
 const r=parseCatalog({schema:1,plugins:[]},options);assert.ok(r.ok);if(r.ok)assert.deepEqual(r.unavailable,[])
 assert.equal(parseCatalog({schema:3,plugins:[]},options).ok,false)
 const item={name:'canva',displayName:'Canva',reason:'pending'}
 assert.equal(parseCatalog({schema:2,plugins:[],unavailable:[item,item]},options).ok,false)
})
test('v2 preserves validated detail while invalid detail cannot hide a valid package',()=>{
 const base={name:'board',displayName:'看板',version:'1.0.0',url:'https://eas.biily.top/plugins/board/board-1.0.0.zip',sha256:'a'.repeat(64),size:6421}
 const r=parseCatalog({schema:2,plugins:[{...base,detail:{summary:'把任务整理在看板'}},{...base,name:'other',detail:{summary:'x'.repeat(1001)}}],unavailable:[]},options)
 assert.ok(r.ok);if(!r.ok)return
 assert.equal(r.entries[0].detail?.summary,'把任务整理在看板')
 assert.equal(r.entries[1].detail,undefined)
 assert.equal(r.warnings.length,1)
})
