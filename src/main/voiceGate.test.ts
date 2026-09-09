import {test} from 'node:test'
import assert from 'node:assert/strict'
import {VoiceGate} from './voiceGate.ts'
test('静音不送识别，人声保留前置帧，尾静音有限',()=>{
 const g=new VoiceGate(2,2)
 assert.deepEqual(g.push(new Float32Array([1]),false),[])
 assert.deepEqual(g.push(new Float32Array([2]),false),[])
 assert.deepEqual(g.push(new Float32Array([3]),true).map(x=>x[0]),[1,2,3])
 assert.equal(g.push(new Float32Array([4]),false).length,1)
 assert.equal(g.push(new Float32Array([5]),false).length,1)
 assert.equal(g.push(new Float32Array([6]),false).length,0)
})
test('重置清空旧会话音频',()=>{const g=new VoiceGate(2,2);g.push(new Float32Array([1]),false);g.reset();assert.equal(g.push(new Float32Array([2]),true).length,1)})
test('持续非人声缓存有界',()=>{const g=new VoiceGate(2,2);for(let i=0;i<10000;i++)g.push(new Float32Array([i]),false);assert.equal(g.push(new Float32Array([1]),true).length,3)})
