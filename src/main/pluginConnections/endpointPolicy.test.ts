import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as policy from './endpointPolicy.ts'
const origins=['https://mcp.example.com']
test('approved HTTPS endpoint is normalized',()=>{
 assert.equal(policy.validateRemoteEndpoint('https://MCP.example.com:443/mcp',origins).href,'https://mcp.example.com/mcp')
})
test('remote endpoint rejects implicit secrets, fragments, ports and unapproved origins',()=>{
 for(const url of ['http://mcp.example.com/mcp','https://mcp.example.com:444/mcp','https://user:pass@mcp.example.com/mcp','https://mcp.example.com/mcp?token=secret','https://mcp.example.com/mcp#fragment','https://evil.example/mcp','https://mcp.example.com.evil.test/mcp'])assert.throws(()=>policy.validateRemoteEndpoint(url,origins),url)
})
test('private and local endpoints rejected even if origin is declared',()=>{
 for(const host of ['localhost','localhost.','test.localhost','127.0.0.1','127.1','2130706433','0x7f000001','10.0.0.1','169.254.169.254','192.168.1.1','[::1]','[::ffff:127.0.0.1]','[fc00::1]']) {
  const url='https://'+host+'/mcp';assert.throws(()=>policy.validateRemoteEndpoint(url,[new URL(url).origin]),url)
 }
})
test('DNS answers must all be public, including IPv6 and mapped addresses',()=>{
 assert.doesNotThrow(()=>policy.validatePublicAddresses(['8.8.8.8','2606:4700:4700::1111']))
 for(const answers of [[],['8.8.8.8','127.0.0.1'],['::ffff:8.8.8.8'],['::1'],['2001:db8::1'],['2002:7f00:1::'],['fc00::1'],['169.254.1.1'],['100.64.1.1'],['224.0.0.1'],['0.0.0.0'],['garbage']])assert.throws(()=>policy.validatePublicAddresses(answers),/DNS/)
})
