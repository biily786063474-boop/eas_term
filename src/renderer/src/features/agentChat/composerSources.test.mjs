import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {transformSync} from 'esbuild'
const code=transformSync(fs.readFileSync(new URL('./composerSources.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code
function source(plugins){
 const context={exports:{},module:{exports:{}},require:()=>({}),window:{api:{plugins:{list:async()=>plugins}}}}
 vm.runInNewContext(code,context)
 return context.module.exports
}
test('remote MCP candidates stay in plugin category across all three CLIs without bypassing binding',async()=>{
 const remote={id:'eas:remote',cli:'eas',displayName:'Remote',name:'remote',remote:{transport:'streamable-http',url:'https://example.com/mcp',approvedOrigins:['https://example.com'],auth:'none'}}
 for(const cli of ['claude','codex','omp']){
  const api=source([remote,{...remote,id:'off',enabled:false},{...remote,id:'other',cli:'foreign'},{id:'app',cli:'eas',name:'app',displayName:'App'}])
  const rows=await api.loadPlugins(cli)
  assert.equal(rows.length,2);assert.equal(rows[0].category,'plugin');assert.ok(rows[0].disabled)
  assert.equal(rows[1].category,'app')
  assert.equal((await api.loadPlugins(cli,'eas:remote'))[0].disabled,undefined)
 }
})
