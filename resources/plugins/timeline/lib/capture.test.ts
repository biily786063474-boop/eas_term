import test from 'node:test'
import assert from 'node:assert/strict'
import {candidateFromEvent} from './capture.mjs'
const event=(text,extra={})=>({eventId:'event-1',sessionId:'session-1',turnId:'turn-1',projectId:'project-1',date:'2026-09-18',completedAt:'2026-09-18T15:00:00Z',outcome:'completed',text,...extra})
test('explicit delivery produces an unverified, source-linked candidate, not a verified milestone',()=>{const r=candidateFromEvent(event('已完成时间线项目标签筛选。'));assert.equal(r.status,'pending');assert.equal(r.source.eventId,'event-1');assert.deepEqual(r.evidence,[]);assert.equal(r.title,'已完成时间线项目标签筛选。');assert.deepEqual(r,candidateFromEvent(event('已完成时间线项目标签筛选。')))})
test('ordinary answers, plans, negation and quoted claims do not become delivery',()=>{for(const text of ['你好','计划明天完成时间线','尚未完成，未验证','还没有修复','如果已完成就记录','用户说“已完成”','> 已完成所有测试','没有交付，也没有完成'])assert.equal(candidateFromEvent(event(text)),null,text)})
test('cancelled/failed turns and successful existing record receipt suppress candidates',()=>{for(const extra of [{outcome:'cancelled'},{outcome:'failed'},{recorded:true}])assert.equal(candidateFromEvent(event('已完成任务',extra)),null)})
test('missing provenance or invalid date cannot create candidate',()=>{for(const extra of [{eventId:''},{projectId:''},{date:'2026-02-30'},{completedAt:'bad'}])assert.throws(()=>candidateFromEvent(event('已完成任务',extra)))})
test('bounded text, extractive title, no generated evidence',()=>{const r=candidateFromEvent(event('已修复显示问题。\n'+ '细节'.repeat(4000)));assert.ok(r.summary.length<=4000);assert.ok(r.title.length<=160);assert.equal(r.author,'自动捕获 · 待确认')})
test('candidate keeps host-provided original user question separately',()=>{const r=candidateFromEvent(event('已完成时间轴',{originalQuestion:'请记录用户最初问了什么'}));assert.equal(r.originalQuestion,'请记录用户最初问了什么');assert.equal(candidateFromEvent(event('已完成时间轴',{originalQuestion:'  '})).originalQuestion,undefined)})
