import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryState} from './recoveryState.ts'
test('draft checkpoint deep copies text, chips and image metadata; restore does not alias',()=>{
 const s=createRecoveryState();s.write('draft:a',{text:'unsent',chips:[{id:'x'}],images:[{path:'/tmp/p.png',external:false}]})
 const checkpoint=s.snapshot();s.write('draft:a',{text:'changed'});const restored=createRecoveryState();restored.restore(checkpoint)
 assert.equal(restored.read<{text:string}>('draft:a')?.text,'unsent')
 const value=restored.read<{text:string}>('draft:a')!;value.text='mutated';assert.equal(restored.read<{text:string}>('draft:a')?.text,'unsent')
})
test('nonserializable values and oversized payloads are rejected, leaving old checkpoint intact',()=>{
 const s=createRecoveryState(80);s.write('a','old');assert.throws(()=>s.write('b',()=>{}));assert.throws(()=>s.write('b','x'.repeat(100)));assert.equal(s.read('a'),'old');assert.equal(s.read('b'),undefined)
})
test('restore validates entire payload atomically and does not merge stale state',()=>{
 const s=createRecoveryState();s.write('stale',1);assert.throws(()=>s.restore(null));assert.equal(s.read('stale'),1)
 s.restore({version:1,values:{fresh:'ok'}});assert.equal(s.read('stale'),undefined);assert.equal(s.read('fresh'),'ok')
})
