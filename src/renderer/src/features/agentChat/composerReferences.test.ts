import { test } from 'node:test'
import assert from 'node:assert/strict'
import { referenceRanges, referenceFromCandidate } from './composerReferences.ts'

test('chips preserve canonical payload, use longest match, and exclude email text', () => {
  const refs = [referenceFromCandidate({id:'d1',category:'dict',name:'代码',description:'',insert:'@代码',chip:{id:'d1',label:'代码',text:'short'}}),referenceFromCandidate({id:'d2',category:'dict',name:'代码规范',description:'',insert:'@代码规范',chip:{id:'d2',label:'代码规范',text:'full prompt'}})]
  const text='按 @代码规范 和 @代码 修改 a@代码.com'
  const ranges=referenceRanges(text,refs)
  assert.deepEqual(ranges.map(r=>[text.slice(r.from,r.to),r.reference.payload]),[['@代码规范','full prompt'],['@代码','short']])
})
test('file, plugin and image references retain type-specific preview and exact send text', () => {
  const file=referenceFromCandidate({id:'f',category:'file',name:'src/my file.ts',description:'my file.ts',insert:'@"src/my file.ts"'})
  const plugin=referenceFromCandidate({id:'p',category:'plugin',name:'Figma',description:'设计文件工具',insert:'使用插件「Figma」'})
  assert.equal(file.payload,'@"src/my file.ts"')
  assert.equal(plugin.detail,'设计文件工具')
  assert.equal(plugin.kind,'plugin')
  const image=referenceFromCandidate({id:'im',category:'file',name:'image.png',description:'',insert:'@image.png',imagePath:'/tmp/image.png'})
  assert.equal(image.kind,'image')
  assert.equal(image.imagePath,'/tmp/image.png')
  assert.equal(referenceRanges('请看 '+file.raw+' 然后 '+plugin.raw,[file,plugin]).length,2)
})
test('duplicate occurrences remain separate atomic ranges without consuming adjacent prose', () => {
  const ref=referenceFromCandidate({id:'f',category:'file',name:'a.ts',description:'',insert:'@a.ts'})
  const text='@a.ts @a.ts 后缀'
  assert.deepEqual(referenceRanges(text,[ref]).map(r=>[r.from,r.to]),[[0,5],[6,11]])
  assert.equal(referenceRanges('name@a.ts',[ref]).length,0)
  assert.equal(referenceRanges('@a.tsx',[ref]).length,0)
})
