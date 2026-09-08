import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleCapabilityServers, capabilitySummary } from './builtinCapabilities.ts'
const canvas={name:'eas-term',command:'node',args:['a b/服务.mjs'],envVars:['EAS_CAPABILITY_LEASE']}
const business={name:'business',command:'node',args:['business.mjs']}
test('基础能力与单个业务插件组合，禁用不回装',()=>{
 assert.deepEqual(assembleCapabilityServers([{enabled:false,server:canvas}],[]),[])
 assert.deepEqual(assembleCapabilityServers([{enabled:true,server:canvas}],[business]).map(s=>s.name),['eas-term','business'])
})
test('冲突必须显式失败，不能覆盖第三方同名配置',()=>{
 assert.throws(()=>assembleCapabilityServers([{enabled:true,server:canvas}],[canvas]),/冲突/)
})
test('会话快照不共享可变参数或环境，保留中文空格路径',()=>{
 const a=assembleCapabilityServers([{enabled:true,server:canvas}],[])
 a[0].args!.push('x');a[0].envVars!.push('x')
 assert.equal(canvas.args.length,1);assert.equal(canvas.envVars.length,1)
 assert.equal(a[0].args![0],'a b/服务.mjs')
})
test('文档存在不能当成工具就绪，禁用优先于历史连接状态',()=>{
 assert.equal(capabilitySummary({enabled:false,dependency:'available',session:'ready',toolCount:37}),'已禁用')
 assert.equal(capabilitySummary({enabled:true,dependency:'missing',session:'not-requested'}),'依赖未安装')
 assert.equal(capabilitySummary({enabled:true,dependency:'available',session:'ready',toolCount:0}),'握手成功但没有工具')
 assert.equal(capabilitySummary({enabled:true,dependency:'available',session:'ready',toolCount:37}),'已就绪 · 37 个工具')
})
