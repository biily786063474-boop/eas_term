import test from 'node:test'
import assert from 'node:assert/strict'
import {jevTimelineReady} from './jevTimeline.ts'
test('legacy timeline cannot authorize paid enhancement',()=>{
 for(const v of [undefined,'1.0.0','0.9.9','1.0.1-beta','invalid'])assert.equal(jevTimelineReady(v),false)
 for(const v of ['1.0.1','1.1.0','2.0.0'])assert.equal(jevTimelineReady(v),true)
})
