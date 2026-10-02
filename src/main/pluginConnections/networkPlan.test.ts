import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as policy from './networkPlan.ts'

test('direct plan pins one checked address while preserving TLS name',()=>{
 const p=policy.planConnection('https://mcp.example.com/mcp',['https://mcp.example.com'],['8.8.8.8'],'DIRECT')
 assert.equal(p.address,'8.8.8.8');assert.equal(p.servername,'mcp.example.com');assert.equal(p.proxy,undefined)
})
test('system proxy supports HTTP CONNECT and TLS proxy; no silent direct fallback',()=>{
 const make=(proxy:string)=>policy.planConnection('https://mcp.example.com/mcp',['https://mcp.example.com'],['8.8.8.8'],proxy)
 assert.equal(make('PROXY 127.0.0.1:7890; DIRECT').proxy?.href,'http://127.0.0.1:7890/')
 assert.equal(make('HTTPS proxy.example.com:8443').proxy?.href,'https://proxy.example.com:8443/')
 for(const proxy of ['','SOCKS5 127.0.0.1:1080; DIRECT','PROXY user:pass@proxy.example.com:8080','PROXY proxy.example.com/path'])assert.throws(()=>make(proxy))
})
test('system proxy connects by hostname: local DNS answers are not used, so fake-ip / private answers do not block (2026-09-30)',()=>{
 for(const answers of [['198.18.0.240'],['8.8.8.8','127.0.0.1'],['10.0.0.5']]){
  const p=policy.planConnection('https://mcp.example.com/mcp',['https://mcp.example.com'],answers,'PROXY 127.0.0.1:7890')
  assert.equal(p.address,'mcp.example.com');assert.equal(p.servername,'mcp.example.com');assert.equal(p.proxy?.href,'http://127.0.0.1:7890/')
 }
})
test('direct connection still rejects private answers, but accepts the fake-ip range used by Clash / Surge TUN',()=>{
 const direct=(answers:string[])=>policy.planConnection('https://mcp.example.com/mcp',['https://mcp.example.com'],answers,'DIRECT')
 assert.equal(direct(['198.18.0.240']).address,'198.18.0.240')
 for(const ip of ['127.0.0.1','10.0.0.5','192.168.1.9','172.16.3.4','169.254.169.254','100.64.0.9','0.0.0.0','::1','fc00::1','fe80::1'])assert.throws(()=>direct([ip]),/DNS/,ip)
 assert.throws(()=>direct(['8.8.8.8','192.168.1.9']),/DNS/,'mixed answers with one private address')
 assert.throws(()=>policy.planConnection('https://evil.example.net/mcp',['https://mcp.example.com'],['8.8.8.8'],'PROXY 127.0.0.1:7890'),Error,'proxy never bypasses the origin allowlist')
})
