import test from 'node:test'
import assert from 'node:assert/strict'
import { ActivityBook, activitySnapshot, parseActivity, dayKey } from './activity.ts'
import type { UsageRow } from '../../shared/usage.ts'
const at = (day: number) => new Date(2026, 8, day, 12).getTime()
test('only fixed event names and bounded plugin IDs enter the local daily ledger', () => {
 const b = new ActivityBook(at(1))
 b.record('term',at(2)); b.record('voice',at(2)); b.record('/secret/prompt',at(2))
 b.recordPlugin('timeline','open',at(2)); b.recordPlugin('../../key','call',at(2))
 assert.deepEqual(b.data.days[0].counts,{term:1,voice:1})
 assert.deepEqual(b.data.days[0].plugins,[{id:'timeline',opens:1,calls:0}])
 assert.ok(!JSON.stringify(b.data).includes('secret'))
})
test('unknown token day, partial collection day and real zero remain different', () => {
 const b=new ActivityBook(at(4))
 const row=(day:number,meter?:UsageRow['meter']):UsageRow=>({id:String(day),session:'s',project:'p',projectName:'p',cli:'codex',model:'x',startedAt:at(day),status:'completed',meter})
 const s=activitySnapshot(b.data,[row(4),row(5,{input:0,output:0}),row(6,{input:50,output:10})],at(4),at(7),7)
 assert.equal(s.days.length,7)
 assert.equal(s.days[0].tokens,null)
 assert.equal(s.days[3].tokens,null)
 assert.equal(s.days[3].tokenPartial,true)
 assert.equal(s.days[4].tokens,0)
 assert.equal(s.days[6].tokens,0)
 assert.equal(s.sessions,1);assert.equal(s.projects,1)
 assert.equal(s.days[0].actions,null)
})
test('local calendar streak can continue from yesterday; no artificial activity from queries',()=>{
 const b=new ActivityBook(at(1)); for(const d of [2,3,4,6,7]) b.record('term',at(d))
 const s=activitySnapshot(b.data,[],at(1),at(8),8)
 assert.equal(s.activeDays,5); assert.equal(s.currentStreak,2);assert.equal(s.longestStreak,3)
 assert.equal(s.days.at(-1)?.actions,0)
 assert.equal(activitySnapshot(b.data,[],at(1),at(9),9).currentStreak,0)
})
test('pruning is by local day, old data and future timestamps do not inflate totals',()=>{
 const b=new ActivityBook(at(1));b.record('term',at(1)); b.record('term',at(7)); b.prune(at(7),3)
 assert.deepEqual(b.data.days.map(d=>d.date),[dayKey(at(7))])
 const s=activitySnapshot(b.data,[],at(1),at(6),3)
 assert.equal(s.activeDays,0)
})
test('malformed persistence fails closed, unknown fields are not copied through',()=>{
 assert.throws(()=>parseActivity({version:1,since:at(1),days:[{date:'2026-02-30',counts:{},plugins:[]}]}))
 assert.throws(()=>parseActivity({version:1,since:at(1),days:[{date:'2026-09-02',counts:{term:-1},plugins:[]}]}))
 const b=new ActivityBook(at(1));b.record('term',at(2))
 assert.deepEqual(parseActivity({...b.data,prompt:'SECRET'}),b.data)
 assert.throws(()=>parseActivity({...b.data,days:[b.data.days[0],b.data.days[0]]}))
})
test('calendar iteration handles DST without duplicate or missing dates',()=>{
 const old=process.env.TZ;process.env.TZ='America/Los_Angeles'
 try {const now=new Date(2026,2,10,12).getTime();const s=activitySnapshot(new ActivityBook(now).data,[],now,now,5)
 assert.deepEqual(s.days.map(d=>d.date),['2026-03-06','2026-03-07','2026-03-08','2026-03-09','2026-03-10'])
 } finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
})
test('disabled ledgers stay unknown across midnight, not fake empty days',()=>{
 const b=new ActivityBook(at(2))
 const s=activitySnapshot(b.data,[],at(2),at(5),5,{activity:false,token:false})
 assert.ok(s.days.every(d=>d.actions===null&&d.tokens===null))
 assert.equal(s.activeDays,0)
})
test('unavailable usage totals and daily rounds are unknown, not zero',()=>{
 const s=activitySnapshot(new ActivityBook(at(1)).data,[],at(1),at(5),5,{activity:false,token:false})
 assert.equal(s.sessions,null);assert.equal(s.projects,null)
 assert.ok(s.days.every(d=>d.rounds===null))
 assert.equal(s.activityAvailable,false)
})
