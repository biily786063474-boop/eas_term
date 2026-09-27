import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryAdmission} from './recoveryAdmission.ts'
test('candidate defaults deny, only explicit read paths pass; retired sender never starts work',()=>{
 const gate=createRecoveryAdmission();gate.candidate(2)
 assert.throws(()=>gate.enter(2,'agentChat:start'));assert.throws(()=>gate.enter(2,'future:newWork'))
 const release=gate.enter(2,'prefs:get');release();gate.promote(2);gate.enter(2,'agentChat:start')()
 gate.retire(1);assert.throws(()=>gate.enter(1,'agentChat:start'))
})
test('inflight is tracked to real settlement, writes invalidate generation but passive polls do not',()=>{
 const g=createRecoveryAdmission(),before=g.generation();const release=g.enter(1,'runtime:monitor');assert.equal(g.pending(),1);assert.equal(g.generation(),before);release();assert.equal(g.pending(),0)
 const done=g.enter(1,'pty:create');assert.ok(g.generation()>before);done();done();assert.equal(g.pending(),0)
})
test('candidate cleanup cannot disturb normal windows or count candidate boot as application activity',()=>{
 const g=createRecoveryAdmission();g.candidate(2);const before=g.generation();g.enter(2,'roles:list')();assert.equal(g.generation(),before)
 const done=g.enter(1,'fs:createFile');g.retire(2);assert.equal(g.pending(),1);done();assert.equal(g.pending(),0)
})
