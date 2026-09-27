import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProcessMetricsReader} from './processMetrics.ts'
test('diagnostic snapshot whitelists only aggregate numbers and rate-limits collection',()=>{
 let now=0,reads=0
 const sample=createProcessMetricsReader(()=>now,()=>{reads++;return [
  {pid:42,type:'Browser',name:'SECRET',serviceName:'/private/project',cpu:{percentCPUUsage:5},memory:{workingSetSize:1024,peakWorkingSetSize:2048}},
  {pid:43,type:'Tab',cpu:{percentCPUUsage:3},memory:{workingSetSize:512,peakWorkingSetSize:1024}}
 ]})
 assert.deepEqual(sample(),{sampledAt:0,scope:'electron-only',processCount:2,workingSetBytes:1572864,reportedPeakSumBytes:3145728,cpuPercent:8})
 now=1000;sample();assert.equal(reads,1)
 now=5000;sample();assert.equal(reads,2)
 assert.doesNotMatch(JSON.stringify(sample()),/SECRET|private|pid|serviceName/)
})
test('unknown or invalid metrics are null, never invented zero or partial totals',()=>{
 const sample=createProcessMetricsReader(()=>0,()=>[{type:'Tab',memory:{workingSetSize:NaN,peakWorkingSetSize:-1},cpu:{percentCPUUsage:NaN}}])
 assert.equal(sample()?.workingSetBytes,null)
 assert.equal(sample()?.cpuPercent,null)
 const fail=createProcessMetricsReader(()=>0,()=>{throw Error('secret path')})
 assert.equal(fail(),null)
})
