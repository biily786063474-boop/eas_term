import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createOmpLoginController } from './login.ts'
import type { OmpLoginState } from '../../../shared/ompLogin.ts'
const host = { isPackaged: false, resourcesPath: '', appPath: '/fixture', userData: '/tmp/omp-login-fixture', home: '/tmp/omp-login-fixture' }
function fixture() {
 const procs: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => boolean })[] = []
 const c = createOmpLoginController(() => { const p = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true }); procs.push(p); return p as unknown as ChildProcess })
 return { c, procs }
}
test('取消旧进程后迟到的输出、错误、close 不影响新登录', () => {
 const {c,procs}=fixture();const seen: OmpLoginState[]=[]
 c.start(host,'google-gemini-cli',()=>{},1);c.cancel(1)
 c.start(host,'anthropic',s=>seen.push(s),1)
 procs[0].stdout.write('Credentials saved to /old/db\n');procs[0].emit('error',new Error('old'));procs[0].emit('close',1)
 assert.equal(c.inFlight(1)?.provider,'anthropic');assert.equal(seen.at(-1)?.phase,'starting')
 c.cancel(1)
})
test('只允许拥有者提交/取消；回调等待态不接受手动值', () => {
 const {c,procs}=fixture();c.start(host,'google-gemini-cli',()=>{},7)
 assert.equal(c.submit('code',7).ok,false)
 procs[0].stdout.write('Paste the authorization code (or full redirect URL): ')
 assert.equal(c.submit('code',8).ok,false);assert.equal(c.cancel(8).ok,false);assert.equal(c.inFlight(8),null)
 assert.equal(c.submit('custom-scheme://callback?code=demo',7).ok,true)
 assert.equal(c.submit('duplicate',7).ok,false);c.cancel(7)
})
test('等 close 而非 exit 排空输出；只有保存标记 + 成功退出才算成功', () => {
 const {c,procs}=fixture();const seen: OmpLoginState[]=[];c.start(host,'google-gemini-cli',s=>seen.push(s))
 procs[0].emit('exit',0);procs[0].stdout.write('Credentials saved to /tmp/db');procs[0].emit('close',0)
 assert.equal(seen.at(-1)?.phase,'done');assert.equal(c.inFlight(),null)
})
test('错误退出不因保存标记被误报成功；状态不泄漏授权 URL', () => {
 const {c,procs}=fixture();const seen: OmpLoginState[]=[];c.start(host,'google-gemini-cli',s=>seen.push(s))
 procs[0].stdout.write('Open this URL in your browser:\nhttps://example.com/auth?state=SECRET\nCredentials saved to /tmp/db\n')
 procs[0].emit('close',1)
 assert.equal(seen.at(-1)?.phase,'failed');assert.equal(seen.at(-1)?.url,undefined)
 assert.equal(JSON.stringify(seen.at(-1)).includes('SECRET'),false)
})
test('stdin 异步错误给明确失败，不崩溃；不接收多行注入', () => {
 const {c,procs}=fixture();const seen: OmpLoginState[]=[];c.start(host,'anthropic',s=>seen.push(s))
 procs[0].stdout.write('Enter your API key: ')
 assert.equal(c.submit('one\ntwo').ok,false)
 procs[0].stdin.emit('error',new Error('EPIPE'));assert.equal(seen.at(-1)?.phase,'failed')
})
test('project configuration error survives native stderr and terminal event without secrets',()=>{
 const {c,procs}=fixture();const seen: OmpLoginState[]=[]
 c.start(host,'google-gemini-cli',s=>seen.push(s))
 procs[0].stderr.write('OAuthError: This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable. See https://example.test/?code=SECRET\n')
 procs[0].emit('close',1)
 assert.equal(seen.at(-1)?.phase,'failed')
 assert.deepEqual(seen.at(-1)?.lines,['GOOGLE_CLOUD_PROJECT_REQUIRED'])
 assert.equal(JSON.stringify(seen).includes('SECRET'),false)
})
