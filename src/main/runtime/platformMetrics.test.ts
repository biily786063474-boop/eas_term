import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMacMemory, parseLinuxMemory, parseMacPressure } from './platformMetrics.ts'
test('macOS读取匿名/锁定/压缩物理页，不把文件缓存都算满',()=>{
 const raw=`Mach Virtual Memory Statistics: (page size of 16384 bytes)\nAnonymous pages: 100.\nPages wired down: 20.\nPages occupied by compressor: 5.\nPages purgeable: 10.`
 assert.equal(parseMacMemory(raw,1000*16384),115*16384)
})
test('macOS缺失/坏数值/超物理内存时为未知，不能返回0',()=>{
 assert.equal(parseMacMemory('',1000),null)
 assert.equal(parseMacMemory('page size of 0 bytes',1000),null)
})
test('Linux按MemAvailable计算，缺失时不拿MemFree冒充',()=>{
 assert.deepEqual(parseLinuxMemory('MemTotal: 1000 kB\nMemAvailable: 400 kB\nMemFree: 10 kB'),{total:1024000,used:614400})
 assert.equal(parseLinuxMemory('MemTotal: 1000 kB\nMemFree: 10 kB'),null)
 assert.equal(parseLinuxMemory('MemTotal: 1000 kB\nMemAvailable: 2000 kB'),null)
})
test('macOS adds measured physical carveouts instead of an empirical correction constant',()=>{
 const raw=`Mach Virtual Memory Statistics: (page size of 16384 bytes)\nAnonymous pages: 100.\nPages wired down: 20.\nPages occupied by compressor: 5.\nPages purgeable: 10.`
 assert.equal(parseMacMemory(raw,1000*16384,900*16384),215*16384)
 assert.equal(parseMacMemory(raw,1000*16384,1001*16384),null)
 assert.equal(parseMacMemory(raw,1000*16384,0),null)
})

test('mac pressure reads dispatch flags, not the distinct internal 0-based enum',()=>{
 assert.equal(parseMacPressure('1\n'),'normal');assert.equal(parseMacPressure('2'),'warning');assert.equal(parseMacPressure('4'),'critical')
 for(const raw of ['0','3','5','','1 junk','NaN'])assert.equal(parseMacPressure(raw),null)
})
