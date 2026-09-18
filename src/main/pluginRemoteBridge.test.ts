import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
test('remote Eas plugins receive the shared shim instead of disappearing from CLI config',()=>{
 const source=ts.createSourceFile('mcpBridge.ts',readFileSync(new URL('./mcpBridge.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='easPluginMcpServer')!
 const exports:Record<string,any>={}
 runInNewContext(ts.transpileModule(fn.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,findPlugin:()=>({name:'fixture',cli:'eas',remote:{auth:'none'}}),runnerFor:(args:string[])=>({command:'node',args}),pluginShimPath:()=>'/app/eas-plugin-shim.mjs'})
 assert.equal(exports.easPluginMcpServer('eas:fixture')?.env.EAS_PLUGIN,'fixture')
})
