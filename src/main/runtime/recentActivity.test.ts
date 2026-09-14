import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRecentActivity} from './recentActivity.ts'

// 运行中心的「最近结束」：任务/服务结束后留一条有界记录，让用户知道刚才那个排队的东西
// 到底是完成了、被取消了、还是排队超时了。只存脱敏字段（名字、归属、结局、时长），不存参数。
test('按窗口投影（应用级全窗口可见），新在前，有界',()=>{
 let now=1000
 const r=createRecentActivity(()=>now,3)
 r.record({id:'a',name:'甲',windowId:7,projectId:'p',kind:'task',outcome:'done',startedAt:0})
 now=2000;r.record({id:'b',name:'乙',windowId:null,projectId:null,kind:'task',outcome:'cancelled',startedAt:1500})
 now=3000;r.record({id:'c',name:'丙',windowId:8,projectId:null,kind:'service',outcome:'exited',startedAt:0})
 const seen7=r.list(7)
 assert.deepEqual(seen7.map(x=>x.id),['b','a'],'别的窗口的 c 不可见，应用级 b 可见，新在前')
 assert.equal(seen7[0].outcome,'cancelled');assert.equal(seen7[0].durationMs,500);assert.equal(seen7[0].ageMs,1000)
 now=4000;r.record({id:'d',name:'丁',windowId:7,projectId:null,kind:'task',outcome:'timeout',startedAt:0})
 assert.deepEqual(r.list(7).map(x=>x.id),['d','b'],'上限 3：最老的 a 被挤掉')
})
