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
test('mixed private DNS blocks even when traffic uses system proxy',()=>{
 assert.throws(()=>policy.planConnection('https://mcp.example.com/mcp',['https://mcp.example.com'],['8.8.8.8','127.0.0.1'],'PROXY 127.0.0.1:7890'),/DNS/)
})
