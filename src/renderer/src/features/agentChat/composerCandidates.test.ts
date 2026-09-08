import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triggerAt, insertCandidate, filterCandidates, dictCandidates, commandCandidates, popupPosition, type Candidate } from './composerCandidates.ts'
const item: Candidate = { id:'f', category:'file', name:'src/my file.ts', description:'file', insert:'@"src/my file.ts"' }
test('caret query and replacement preserve suffix and quoted paths', () => {
  const text = '请看 @src 后面的说明'
  const trigger = triggerAt(text, 7)!
  assert.deepEqual(trigger, {mode:'@',query:'src',start:3,end:7})
  assert.deepEqual(insertCandidate(text, trigger, item), {text:'请看 @"src/my file.ts" 后面的说明',caret:20})
})
test('email, path, selected ranges and completed tokens do not open a picker', () => {
  for (const text of ['a@b.com', 'src/main/', '@file ', '/model opus']) assert.equal(triggerAt(text,text.length),null)
  assert.equal(triggerAt('@hello',3,5),null)
  assert.equal(triggerAt('看（@防抖',5)?.query,'防抖')
  assert.equal(triggerAt('/',1)?.mode,'/')
})
test('dictionary aliases find one identity and preload wins over library', () => {
  const rows = dictCandidates([{id:'d',label:'防抖',text:'本次版本'}], [{id:'d',zh:'防抖',en:'debounce',keywords:['延迟'],prompt:'库版本',logic:''}])
  assert.equal(rows.length,1)
  assert.equal(rows[0].chip?.text,'本次版本')
  assert.equal(filterCandidates(rows,'debounce','dict')[0].id,'dict:d')
  assert.equal(filterCandidates(rows,'延迟','dict').length,1)
  assert.equal(filterCandidates(rows,'debounce','file').length,0)
})
test('commands expose existing local controls only, never cross-transport TUI commands', () => {
  for(const cli of ['codex','claude','omp']) {
    const list=commandCandidates({model:true,effort:false,compact:false})
    assert.deepEqual(list.map(x=>x.name),['mention','model'])
    assert.ok(list.every(x=>x.category==='common'),cli)
  }
  assert.deepEqual(commandCandidates({model:false,effort:true,compact:true}).map(x=>x.name),['mention','effort','compact'])
})
test('popup stays inside narrow viewport and hides fully offscreen anchors',()=>{
  const pos=popupPosition({left:580,top:400,right:900,bottom:480,width:320,height:80},640,600)!
  assert.ok(pos.left>=8 && pos.left+pos.width<=632)
  assert.equal(popupPosition({left:-600,top:10,right:-20,bottom:90,width:580,height:80},640,600),null)
})
