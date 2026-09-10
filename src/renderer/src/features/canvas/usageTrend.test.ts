import test from 'node:test'
import assert from 'node:assert/strict'
import { smoothTrendPath } from './usageTrend.ts'

test('smooth curve passes through real points with rounded peaks',()=>{
 const d=smoothTrendPath([{x:0,y:100},{x:10,y:0},{x:20,y:60}])
 assert.match(d,/^M 0 100 C /)
 assert.match(d,/10 0 C /)
 assert.ok(d.endsWith('20 60'))
 // The peak has a horizontal tangent, without overshooting the actual maximum.
 assert.match(d,/6\.667 0 10 0 C 13\.333 0/)
})
test('unknown intervals break paths; no interpolation across missing values',()=>{
 const d=smoothTrendPath([{x:0,y:10},{x:10,y:20},null,{x:30,y:5},{x:40,y:15}])
 assert.equal((d.match(/M /g)??[]).length,2)
 assert.equal((d.match(/C /g)??[]).length,2)
 assert.ok(!d.includes('NaN'));assert.equal(smoothTrendPath([null,null]),'')
})
test('flat, single and empty series stay finite',()=>{
 assert.equal(smoothTrendPath([]),'')
 assert.equal(smoothTrendPath([{x:1,y:0}]),'M 1 0')
 assert.equal(smoothTrendPath([{x:0,y:0},{x:3,y:0}]),'M 0 0 C 1 0 2 0 3 0')
})
