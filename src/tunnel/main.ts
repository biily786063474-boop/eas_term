// 隧道服务器的入口。**独立进程，跟 app 无关** —— 部署到公网那台机器上跑。
//
//   node hub.mjs --port 8443 --cert /etc/.../fullchain.pem --key /etc/.../privkey.pem
//
// 证书是给**电脑那条出站连接**用的（它要在 TLS 里发 agentKey）。
// 手机那条走明文 CONNECT，里面套的才是端到端那条 TLS ——
// **这台机器解不开它，也不该能解开**（见 hub.ts 文件头）。
import fs from 'node:fs'

import { createHub } from './hub.ts'

const arg = (name: string, dflt?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : (process.env[`EAS_TUNNEL_${name.toUpperCase()}`] ?? dflt)
}

const port = Number(arg('port', '8443'))
const certPath = arg('cert')
const keyPath = arg('key')
if (!certPath || !keyPath) {
  console.error('要 --cert 和 --key（电脑那条出站连接走 TLS，见文件头）')
  process.exit(1)
}

const hub = createHub({
  cert: fs.readFileSync(certPath, 'utf8'),
  key: fs.readFileSync(keyPath, 'utf8'),
  log: (m) => console.log(new Date().toISOString(), m)
})

// **绑 0.0.0.0 是有意的** —— 这台机器的全部职责就是被公网连上。
// 跟 app 里那个「绝不绑 0.0.0.0」的规矩不是一回事：那是别人的电脑，这是服务器
hub.server.listen(port, '0.0.0.0', () => {
  console.log(`隧道服务器起在 :${port}`)
})

// 每分钟一行运维指标。**只有数量，没有内容** ——
// 「某某用户昨天在干什么」这个问题不该有能力回答，而这不靠自律，是手里没有那些数据
setInterval(() => {
  const s = hub.stats()
  if (s.agents || s.streams) console.log(`在线 ${s.agents} 台，活动流 ${s.streams} 条`)
}, 60_000).unref()

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    hub.server.close(() => process.exit(0))
  })
