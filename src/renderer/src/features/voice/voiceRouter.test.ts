import {test} from 'node:test'
import assert from 'node:assert/strict'
import {VoiceRouter} from './voiceRouter.ts'
test('片段按所属目标回写，不跟随迟到时的焦点串框',()=>{
 const r=new VoiceRouter();const a:string[]=[],b:string[]=[]
 r.register('a',t=>{a.push(t)});r.register('b',t=>{b.push(t)});r.focus('a');const old=r.current;r.focus('b');r.deliver(old,'旧句');r.deliver(r.current,'新句');assert.deepEqual(a,['旧句']);assert.deepEqual(b,['新句'])
})
test('目标卸载或无目标，拒绝插入；一次片段只能提交一次',()=>{
 const r=new VoiceRouter();let n=0;const off=r.register('a',()=>{n++});r.focus('a');assert.equal(r.deliver('a','text','s1'),true);assert.equal(r.deliver('a','text','s1'),false);off();assert.equal(r.deliver('a','late','s2'),false);assert.equal(r.current,'');assert.equal(n,1)
})
