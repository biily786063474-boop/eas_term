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
test('secret help (2026-09-30): https link and short steps are kept; anything else fails closed',()=>{
 const help={url:'https://github.com/settings/personal-access-tokens/new?name=x&contents=read',steps:'选仓库 → 只给 Read-only → 生成'}
 assert.deepEqual(parsePluginConfig({fields:[{...base,type:'secret',help}]}),{fields:[{...base,type:'secret',help}]})
 assert.deepEqual(parsePluginConfig({fields:[{...base,type:'secret',help:{url:help.url}}]}),{fields:[{...base,type:'secret',help:{url:help.url}}]})
 for(const bad of [{url:'http://github.com/x'},{url:'javascript:alert(1)'},{url:'https://user:pw@github.com/'},{url:'not a url'},{url:help.url,steps:'a\nb'},{url:help.url,run:'x'},{steps:'no url'},'https://github.com'])
  assert.throws(()=>parsePluginConfig({fields:[{...base,type:'secret',help:bad}]}),Error,JSON.stringify(bad))
 // 只有密钥字段能带帮助
 assert.throws(()=>parsePluginConfig({fields:[{...base,type:'string',maxLength:8,help}]}))
})
test('deferred configuration explicitly declares credential-free onboarding, not optional fields',()=>{
 const config={startup:'deferred',fields:[{...base,type:'secret'}]}
 assert.deepEqual(parsePluginConfig(config),config)
 assert.throws(()=>parsePluginConfig({...config,startup:'ignore-errors'}))
})
