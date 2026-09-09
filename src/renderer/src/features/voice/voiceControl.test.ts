import {test} from 'node:test'
import assert from 'node:assert/strict'
import {claimVoiceStopper,clearVoiceStopper,stopVoiceOnSend} from './voiceControl.ts'
test('发送即使没有录音也清除语音草稿历史',async()=>{const previous=Object.getOwnPropertyDescriptor(globalThis,'document');let count=0;Object.defineProperty(globalThis,'document',{configurable:true,value:{dispatchEvent:(e:Event)=>{if(e.type==='voice:discard')count++}}});try{await stopVoiceOnSend();assert.equal(count,1)}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document')}})
test('第二个麦克风不能抢走第一段录音的发送取消句柄',async()=>{let a=0,b=0;const fa=async()=>{a++},fb=async()=>{b++};assert.equal(claimVoiceStopper(fa),true);assert.equal(claimVoiceStopper(fb),false);clearVoiceStopper(fb);await stopVoiceOnSend();assert.equal(a,1);assert.equal(b,0)})
