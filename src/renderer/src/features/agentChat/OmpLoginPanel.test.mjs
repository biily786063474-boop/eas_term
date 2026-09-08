import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
const result = buildSync({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {OmpLoginPanel} from './src/renderer/src/features/agentChat/OmpLoginPanel.tsx';export default function render(state){return renderToStaticMarkup(React.createElement(OmpLoginPanel,{state,provider:'Fixture provider',onStart(){},onCancel:async()=>{},onSwitch:async()=>{},onContinue(){}}))}",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',logLevel:'silent'})
const compiled={exports:{}}
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports)
const render=compiled.exports.default
const base={provider:'fixture',lines:[]}
test('原生回调+手动备用并存时，主界面仍是等待回调，输入折叠',()=>{
 const html=render({...base,phase:'input',url:'https://auth.example.com',prompt:'Paste the authorization code (or full redirect URL):'})
 assert.ok(html.includes('等待浏览器授权结果'));assert.ok(html.includes('未自动返回？手动补充'))
 assert.match(html,/<details class="ac-native-fallback">/)
 assert.doesNotMatch(html,/type="url"/)
})
test('设备码授权只有原生指令，不制造额外输入框',()=>{
 const html=render({...base,phase:'browser',url:'https://example.com/device',instructions:'Enter code: DEMO-1234'})
 assert.ok(html.includes('DEMO-1234'));assert.doesNotMatch(html,/<input/)
})
test('密钥字段默认隐藏；未知原生问题仍可回答，不按 provider 名字分类',()=>{
 assert.match(render({...base,phase:'input',prompt:'Enter API key:'}),/type="password"/)
 assert.match(render({...base,phase:'input',prompt:'Choose account:'}),/type="text"/)
})
test('终态不展示旧授权地址或原始诊断，成功明确送到模型选择',()=>{
 for(const phase of ['done','failed','cancelled']){
  const html=render({...base,phase,url:'https://example.com/?code=SECRET',instructions:'SECRET',lines:['SECRET']})
  assert.equal(html.includes('SECRET'),false);assert.equal(html.includes('打开授权页面'),false)
 }
 assert.ok(render({...base,phase:'done'}).includes('选择模型'))
})
