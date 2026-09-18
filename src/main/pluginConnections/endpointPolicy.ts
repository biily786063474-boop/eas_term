import {isIP, BlockList} from 'node:net'

/** Exact-origin, credential-free remote endpoint policy. DNS checks are separate. */
export function validateRemoteEndpoint(raw: string, approvedOrigins: readonly string[]): URL {
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
      !approvedOrigins.includes(url.origin) || isIP(host) || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.') || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('远程插件端点不在授权的公开 HTTPS 范围内')
  }
  return url
}


const blocked = new BlockList()
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(ip,bits,'ipv4')
const global = new BlockList()
global.addSubnet('2000::',3,'ipv6')
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip,bits,'ipv6')
/** Caller must pin validated answers at connection time; this alone does not prevent rebinding. */
export function validatePublicAddresses(answers: readonly string[]): void {
  if (!answers.length || answers.length > 64) throw Error('DNS 结果为空或过多')
  for (const ip of answers) {
    const family=isIP(ip)
    if (family===4 && !blocked.check(ip,'ipv4')) continue
    if (family===6 && !ip.includes('%') && global.check(ip,'ipv6') && !blocked.check(ip,'ipv6')) continue
    throw Error('DNS 包含非公开地址')
  }
}
