import { tm } from '../../shared/i18n/current.ts'
import {isIP, BlockList} from 'node:net'

/** Exact-origin, credential-free remote endpoint policy. DNS checks are separate. */
export function validateRemoteEndpoint(raw: string, approvedOrigins: readonly string[]): URL {
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
      !approvedOrigins.includes(url.origin) || isIP(host) || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.') || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(tm('errPlugin.conn.e88'))
  }
  return url
}


// 2026-09-30（用户拍板）：不再屏蔽 198.18.0.0/15。这段是 RFC 2544 基准测试保留段，公网上不存在，
// 实际几乎只被 Clash / Surge 等代理的 fake-ip 使用——国内开代理访问 GitHub 的用户，远程插件域名会被解析到这里，
// 屏蔽它等于让这些用户一律连不上。防「插件借 DNS 访问内网」的主力是 TLS 按域名校验证书，这道不变；
// 10/8、127/8、172.16/12、192.168/16、169.254/16、100.64/10 等真正的内网段照旧屏蔽（endpointPolicy.test.ts 钉着）。
const blocked = new BlockList()
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(ip,bits,'ipv4')
const global = new BlockList()
global.addSubnet('2000::',3,'ipv6')
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip,bits,'ipv6')
/** Caller must pin validated answers at connection time; this alone does not prevent rebinding. */
export function validatePublicAddresses(answers: readonly string[]): void {
  if (!answers.length || answers.length > 64) throw Error(tm('errPlugin.conn.e89'))
  for (const ip of answers) {
    const family=isIP(ip)
    if (family===4 && !blocked.check(ip,'ipv4')) continue
    if (family===6 && !ip.includes('%') && global.check(ip,'ipv6') && !blocked.check(ip,'ipv6')) continue
    throw Error(tm('errPlugin.conn.e90'))
  }
}
