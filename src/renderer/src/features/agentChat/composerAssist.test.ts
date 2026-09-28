import test from 'node:test'
import assert from 'node:assert/strict'
import { composerHistory, composerSuggestion, historyStep, acceptsAssistKey } from './composerAssist.ts'
const turn=(role:'user'|'assistant',text:string)=>({role,text})
test('history stays in supplied conversation, newest first, deduped, no blank/unsent entries',()=>{
 assert.deepEqual(composerHistory([turn('user','first'),turn('assistant','answer'),turn('user','second'),turn('user','first'),turn('user',' '),{...turn('user','not sent'),unsentText:'not sent'}]),['first','second'])
 assert.equal(composerHistory(Array.from({length:90},(_,i)=>turn('user',String(i)))).length,50)
})
test('suggest only the latest unanswered response options; prefer explicit recommendation',()=>{
 const options=turn('assistant','你选哪一个？\n1. 先看说明\n2. 开始实现（推荐）')
 assert.equal(composerSuggestion([turn('user','如何做'),options]),'开始实现（推荐）')
 assert.equal(composerSuggestion([options,turn('user','已选')]),'')
 assert.equal(composerSuggestion([options],true),'')
 assert.equal(composerSuggestion([turn('assistant','已完成，没有需要选择的选项')]),'')
 assert.equal(composerSuggestion([options,turn('assistant','补充说明')]),'开始实现（推荐）')
})
test('history navigation keeps a snapshot and returns original draft, edits exit navigation',()=>{
 const a=historyStep(null,'ArrowUp','',['new','old'])!
 assert.equal(a.text,'new')
 const b=historyStep(a.state,'ArrowUp',a.text,['arrived later'])!
 assert.equal(b.text,'old')
 assert.equal(historyStep(b.state,'ArrowUp',b.text,[])?.text,'old')
 const c=historyStep(b.state,'ArrowDown',b.text,[])!
 assert.equal(c.text,'new')
 assert.deepEqual(historyStep(c.state,'ArrowDown',c.text,[]),{text:'',state:null})
 assert.equal(historyStep(a.state,'ArrowUp','edited',[]),null)
 assert.equal(historyStep(null,'ArrowUp','draft',['old']),null)
 assert.equal(historyStep(null,'ArrowDown','',['old']),null)
})
test('IME, modifiers, menu, disabled, selections and normal text never yield assist keys',()=>{
 const base={key:'Tab',text:'',from:0,to:0}
 assert.equal(acceptsAssistKey(base),true)
 for(const flag of ['isComposing','ctrlKey','altKey','metaKey','shiftKey','menuOpen','disabled'])assert.equal(acceptsAssistKey({...base,[flag]:true}),false)
 assert.equal(acceptsAssistKey({...base,keyCode:229}),false)
 assert.equal(acceptsAssistKey({...base,text:'a',from:0,to:1}),false)
 assert.equal(acceptsAssistKey({...base,key:'Enter'}),false)
})
