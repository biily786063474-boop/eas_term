import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parsePluginConfig} from './pluginConfig.ts'
const base={id:'target',label:'目标',purpose:'限定插件访问范围',required:true}
test('configuration preserves explicit bounded strings, enum choices and directory access without values',()=>{
 const config={fields:[{...base,type:'string',maxLength:256},{...base,id:'region',type:'enum',options:[{value:'cn',label:'中国'}]},{...base,id:'root',type:'directory',access:'read'}]}
 assert.deepEqual(parsePluginConfig(config),config)
 assert.equal(parsePluginConfig(undefined),undefined)
})
test('constraints fail closed instead of downgrading to unconstrained text or filesystem access',()=>{
 for(const field of [
  {...base,type:'string'}, {...base,type:'string',maxLength:4097}, {...base,type:'string',maxLength:1.5},
  {...base,type:'string',maxLength:64,pattern:'.*'},
  {...base,type:'enum',options:[]}, {...base,type:'enum',options:[{value:'x',label:'X'},{value:'x',label:'Y'}]},
  {...base,type:'enum',options:[{value:'x',label:'X',command:'evil'}]},
  {...base,type:'directory'}, {...base,type:'directory',access:'all'}, {...base,type:'directory',access:'read',path:'/Users'},
  {...base,type:'secret',default:'secret'}, {...base,type:'secret',required:'true'},
  {...base,type:'secret',id:'../escape'}, {...base,type:'secret',purpose:'line\nbreak'}
 ])assert.throws(()=>parsePluginConfig({fields:[field]}),Error,JSON.stringify(field))
})
