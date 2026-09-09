import {test} from 'node:test'
import assert from 'node:assert/strict'
import {claimVoiceStopper,clearVoiceStopper,stopVoiceOnSend} from './voiceControl.ts'
test('第二个麦克风不能抢走第一段录音的发送取消句柄',async()=>{let a=0,b=0;const fa=async()=>{a++},fb=async()=>{b++};assert.equal(claimVoiceStopper(fa),true);assert.equal(claimVoiceStopper(fb),false);clearVoiceStopper(fb);await stopVoiceOnSend();assert.equal(a,1);assert.equal(b,0)})
