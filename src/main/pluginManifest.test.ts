import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest } from './pluginManifest.ts'

const DIR = '/x/plugins/board'
const good = (): Record<string, unknown> => ({
  name: 'board',
  displayName: '看板',
  brandColor: '#5E6AD2',
  mcp: { command: 'node', args: ['./server.mjs'], env: { A: '1' } },
  panels: [{ id: 'main', title: '看板', tool: 'board_show', entry: 'ui://board/panel', defaultSize: { w: 460, h: 340 } }],
  permissions: { canvas: ['canvas_open_file', 'canvas_snapshot'] }
})

test('合法清单 → PluginInfo：id 带 eas: 前缀、args 相对路径按目录解开、mcpServers 故意为空', () => {
  const r = parseManifest(good(), DIR, { exists: () => true })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.info.id, 'eas:board')
  assert.equal(r.info.cli, 'eas')
  assert.deepEqual(r.info.mcp?.args, ['/x/plugins/board/server.mjs'])
  assert.equal(r.info.mcp?.cwd, DIR)
  assert.equal(r.info.mcpServers, undefined)
  assert.equal(r.info.panels?.[0].entry, 'ui://board/panel')
})

test('permissions.canvas 与宿主白名单取交集：不认识的丢掉 + warning，不整份拒', () => {
  const r = parseManifest(good(), DIR)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.info.permissions?.canvas, ['canvas_open_file'])
  assert.ok(r.warnings.some((w) => w.includes('canvas_snapshot')))
})

test('name 与目录名不一致 → 拒', () => {
  const r = parseManifest({ ...good(), name: 'kanban' }, DIR)
  assert.equal(r.ok, false)
})

test('name 含非法字符（../）→ 拒，不碰文件系统', () => {
  const r = parseManifest({ ...good(), name: '../etc' }, DIR)
  assert.equal(r.ok, false)
})

test('mcp.command 缺 → 拒', () => {
  const m = good()
  m.mcp = { args: [] }
  assert.equal(parseManifest(m, DIR).ok, false)
})

test('mcp.args 里的相对路径跳出目录 → 拒', () => {
  const m = good()
  m.mcp = { command: 'node', args: ['../../evil.js'] }
  assert.equal(parseManifest(m, DIR).ok, false)
})

test('panels.entry 既不是 ui:// 也不在目录内 → 拒；目录内相对路径 → 通过', () => {
  const bad = good()
  ;(bad.panels as Record<string, unknown>[])[0].entry = '/etc/passwd'
  assert.equal(parseManifest(bad, DIR).ok, false)
  const ok = good()
  ;(ok.panels as Record<string, unknown>[])[0].entry = 'ui/panel.html'
  assert.ok(parseManifest(ok, DIR).ok)
})

test('defaultSize 夹在 [240,1200]，缺省 460×340', () => {
  const m = good()
  ;(m.panels as Record<string, unknown>[])[0].defaultSize = { w: 10, h: 99999 }
  const r = parseManifest(m, DIR)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.info.panels?.[0].defaultSize, { w: 240, h: 1200 })
  const m2 = good()
  delete (m2.panels as Record<string, unknown>[])[0].defaultSize
  const r2 = parseManifest(m2, DIR)
  assert.ok(r2.ok && r2.info.panels?.[0].defaultSize.w === 460)
})

test('composerIcon：目录内且存在才给 iconPath；不存在 → warning 不拒', () => {
  const m = { ...good(), composerIcon: './ui/icon.svg' }
  const r1 = parseManifest(m, DIR, { exists: () => true })
  assert.ok(r1.ok && r1.info.iconPath === '/x/plugins/board/ui/icon.svg')
  const r2 = parseManifest(m, DIR, { exists: () => false })
  assert.ok(r2.ok && r2.info.iconPath === undefined && r2.warnings.length > 0)
})

test('builtin 标记透传', () => {
  const r = parseManifest(good(), DIR, { builtin: true })
  assert.ok(r.ok && r.info.builtin === true)
})

test('remote no-auth transport is explicit, origin-bound and never becomes a command',()=>{
 const raw={name:'board',requirements:{capabilities:['mcp.remote']},mcp:{transport:'streamable-http',url:'https://mcp.example.com/mcp',auth:'none',approvedOrigins:['https://mcp.example.com']}}
 const result=parseManifest(raw,DIR)
 assert.ok(result.ok);if(!result.ok)return
 assert.equal(result.info.mcp,undefined);assert.equal(result.info.remote?.url,raw.mcp.url)
 for(const mcp of [{...raw.mcp,command:'node'},{...raw.mcp,url:'https://evil.example/mcp'},{...raw.mcp,auth:'oauth'},{...raw.mcp,transport:'unknown'}])assert.equal(parseManifest({...raw,mcp},DIR).ok,false)
})

test('OAuth public-client descriptor preserves only approved fixed endpoints and requires auth.oauth',()=>{
 const oauth={issuer:'https://auth.example.com',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',clientId:'registered-public-client',scope:'read write'}
 const raw={name:'board',requirements:{capabilities:['mcp.remote','auth.oauth']},mcp:{transport:'streamable-http',url:'https://mcp.example.com/mcp',auth:'oauth',approvedOrigins:['https://mcp.example.com','https://auth.example.com'],oauth}}
 const result=parseManifest(raw,DIR);assert.ok(result.ok)
 if(result.ok)assert.deepEqual(result.info.remote?.oauth,oauth)
 for(const change of [{tokenEndpoint:'https://evil.example/token'},{clientSecret:'must-not-be-in-package'},{clientId:''},{scope:'read\nwrite'},{resource:'https://other.example'}])assert.equal(parseManifest({...raw,mcp:{...raw.mcp,oauth:{...oauth,...change}}},DIR).ok,false)
 assert.equal(parseManifest({...raw,requirements:{capabilities:['mcp.remote']}},DIR).ok,false)
 assert.equal(parseManifest({...raw,mcp:{...raw.mcp,auth:'none'}},DIR).ok,false)
})

test('installed package version reaches PluginInfo for update comparison; unknown versions stay unknown',()=>{
 for(const [version,want] of [['1.2.3','1.2.3'],['latest',undefined],[undefined,undefined]] as const){
  const result=parseManifest({...good(),version},DIR)
  assert.ok(result.ok)
  if(result.ok)assert.equal(result.info.version,want)
 }
})

test('config declarations must survive parsing and explicitly require config.fields capability',()=>{
 const raw=good();raw.config={fields:[{id:'api-key',type:'secret',label:'API Key',purpose:'访问指定服务',required:true}]}
 assert.equal(parseManifest(raw,DIR).ok,false)
 raw.requirements={capabilities:['config.fields']}
 const result=parseManifest(raw,DIR);assert.ok(result.ok)
 if(result.ok)assert.deepEqual(result.info.config,raw.config)
})
test('config rejects inline secrets, executable validation, duplicate fields and unbounded schemas',()=>{
 const field={id:'api-key',type:'secret',label:'API Key',purpose:'访问服务',required:true}
 for(const config of [null,{fields:[]},{fields:[{...field,value:'private-key'}]},{fields:[{...field,validate:'return true'}]},{fields:[field,field]},{fields:[{...field,type:'unknown'}]},{fields:Array.from({length:33},(_,i)=>({...field,id:'f'+i}))}]){
  const raw={...good(),requirements:{capabilities:['config.fields']},config}
  assert.equal(parseManifest(raw,DIR).ok,false,JSON.stringify(config))
 }
})

test('remote bearer binds exactly one required secret reference, never an inline token',()=>{
 const raw={name:'board',requirements:{capabilities:['mcp.remote','auth.bearer','config.fields']},config:{fields:[{id:'token',type:'secret',label:'Token',purpose:'连接指定服务',required:true}]},mcp:{transport:'streamable-http',url:'https://mcp.example.com/mcp',approvedOrigins:['https://mcp.example.com'],auth:'bearer',bearer:{field:'token'}}}
 const good=parseManifest(raw,DIR);assert.ok(good.ok)
 for(const change of [{bearer:{field:'other'}},{bearer:{field:'token',value:'secret'}},{auth:'none'},{oauth:{clientId:'mixed'}}])assert.equal(parseManifest({...raw,mcp:{...raw.mcp,...change}},DIR).ok,false)
 assert.equal(parseManifest({...raw,requirements:{capabilities:['mcp.remote','config.fields']}},DIR).ok,false)
 for(const field of [{...raw.config.fields[0],required:false},{...raw.config.fields[0],type:'string',maxLength:100}])assert.equal(parseManifest({...raw,config:{fields:[field]}},DIR).ok,false)
})

test('dynamic OAuth requires a separately declared capability and one approved registration mode',()=>{
 const oauth={issuer:'https://auth.example.com',authorizationEndpoint:'https://auth.example.com/authorize',tokenEndpoint:'https://auth.example.com/token',registrationEndpoint:'https://auth.example.com/register'}
 const raw={name:'board',requirements:{capabilities:['mcp.remote','auth.oauth','auth.oauth.dcr']},mcp:{transport:'streamable-http',url:'https://mcp.example.com/mcp',auth:'oauth',approvedOrigins:['https://mcp.example.com','https://auth.example.com'],oauth}}
 const result=parseManifest(raw,DIR);assert.ok(result.ok)
 if(result.ok)assert.deepEqual(result.info.remote?.oauth,oauth)
 assert.equal(parseManifest({...raw,requirements:{capabilities:['mcp.remote','auth.oauth']}},DIR).ok,false)
 for(const change of [{clientId:'ambiguous'},{registrationEndpoint:''},{registrationEndpoint:'https://evil.example/register'},{clientSecret:'secret'},{registrationAccessToken:'secret'}])assert.equal(parseManifest({...raw,mcp:{...raw.mcp,oauth:{...oauth,...change}}},DIR).ok,false)
})

test('deferred onboarding requires explicit capability, local transport and panel', () => {
  const manifest = { ...good(), config: { startup: 'deferred', fields: [{ id: 'api-key', type: 'secret', label: 'API key', purpose: 'Connect provider', required: true }] }, requirements: { capabilities: ['config.fields', 'config.deferred'] } }
  assert.equal(parseManifest(manifest, DIR).ok, true)
  assert.equal(parseManifest({ ...manifest, requirements: { capabilities: ['config.fields'] } }, DIR).ok, false)
  assert.equal(parseManifest({ ...manifest, panels: [] }, DIR).ok, false)
  assert.equal(parseManifest({ ...manifest, requirements: { capabilities: ['config.fields', 'config.deferred', 'mcp.remote'] }, mcp: { transport: 'streamable-http', url: 'https://example.com/mcp', approvedOrigins: ['https://example.com'], auth: 'none' } }, DIR).ok, false)
})
