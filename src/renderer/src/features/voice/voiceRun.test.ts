import {test} from 'node:test'
import assert from 'node:assert/strict'
import {VoiceRun} from './voiceRun.ts'
test('初始化等待或手动停止等待期间发送，旧结果都失效',()=>{const r=new VoiceRun();const start=r.begin();r.cancel();assert.equal(r.valid(start),false);const next=r.begin();assert.equal(r.valid(next),true);r.cancel();assert.equal(r.valid(next),false)})
