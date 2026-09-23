import test from 'node:test'
import assert from 'node:assert/strict'
import {startupConfiguration} from './configurationStartup.ts'
test('deferred mode never touches vault; existing mode still fails closed',()=>{
 let calls=0
 const connect=()=>{calls++;throw Error('locked')}
 assert.equal(startupConfiguration({startup:'deferred',fields:[]},connect),undefined)
 assert.equal(calls,0)
 assert.throws(()=>startupConfiguration({fields:[]},connect),/locked/)
 assert.equal(calls,1)
 assert.equal(startupConfiguration(undefined,connect),undefined)
})
