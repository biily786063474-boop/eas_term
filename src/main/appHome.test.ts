import {test} from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import {applicationHome,setApplicationHome} from './appHome.ts'
test('application configuration isolation never changes OS HOME',async()=>{
 const original=process.env.HOME
 assert.equal(applicationHome(),os.homedir())
 setApplicationHome('/isolated/lab')
 assert.equal(applicationHome(),'/isolated/lab')
 assert.equal(process.env.HOME,original)
 const {PROBE_ENV}=await import('./probeEnv.ts')
 assert.equal(PROBE_ENV.HOME,'/isolated/lab')
})
