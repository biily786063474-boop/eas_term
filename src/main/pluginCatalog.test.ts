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
