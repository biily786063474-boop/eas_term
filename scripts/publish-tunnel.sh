#!/usr/bin/env bash
# 把隧道服务器发到 39.105。**照 publish-site.sh 的纪律**：
# 打包成单文件 → scp 单个文件 → 核对大小和 SHA256 → 重启 → 前后比对五个生产站。
#
# 用法：bash scripts/publish-tunnel.sh
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=server
REMOTE=/opt/eas-tunnel/hub.mjs
LOCAL=deploy/tunnel/hub.mjs
SITES=(www.biily.top aurora.biily.top eas.biily.top rove.biily.top bzone.biily.top spb.biily.top)

echo "── 打包（服务器是 Node 20，不支持类型剥离，必须打成纯 JS）"
npx esbuild src/tunnel/main.ts --bundle --platform=node --format=esm \
  --target=node20 --outfile="$LOCAL" --legal-comments=none
node --check "$LOCAL"
echo "   $(wc -c < "$LOCAL" | tr -d ' ') 字节，语法通过"

echo "── 重启前：记录现有站点状态"
before=$(ssh $HOST "for h in ${SITES[*]}; do printf '%s=%s ' \$h \$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H \"Host: \$h\" http://127.0.0.1/); done")
echo "   $before"

echo "── 传（单个文件，不用 -r）"
scp "$LOCAL" "$HOST:$REMOTE"

echo "── 核对"
l=$(wc -c < "$LOCAL" | tr -d ' '); r=$(ssh $HOST "wc -c < $REMOTE" | tr -d ' ')
[ "$l" = "$r" ] || { echo "✗ 大小不一致 $l vs $r"; exit 1; }
lh=$(shasum -a 256 "$LOCAL" | awk '{print $1}'); rh=$(ssh $HOST "sha256sum $REMOTE" | awk '{print $1}')
[ "$lh" = "$rh" ] || { echo "✗ SHA256 不一致"; exit 1; }
echo "   大小和 SHA256 都一致"

echo "── 重启"
ssh $HOST "pm2 restart eas-tunnel --update-env >/dev/null && sleep 2 && pm2 jlist | python3 -c \"
import json,sys
p=[x for x in json.load(sys.stdin) if x['name']=='eas-tunnel'][0]
print('   状态', p['pm2_env']['status'], '重启', p['pm2_env']['restart_time'], '次')
assert p['pm2_env']['status']=='online', '隧道没起来'\""

echo "── 重启后：再比一次现有站点"
after=$(ssh $HOST "for h in ${SITES[*]}; do printf '%s=%s ' \$h \$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H \"Host: \$h\" http://127.0.0.1/); done")
echo "   $after"
[ "$before" = "$after" ] || { echo "✗ 现有站点状态变了！前:$before 后:$after"; exit 1; }
echo "   跟重启前一致"

echo "── 线上自检：握一次手"
node --input-type=module -e "
import crypto from 'node:crypto'; import tls from 'node:tls'
const k=crypto.randomBytes(32).toString('base64url')
const id=crypto.createHash('sha256').update(k).digest('hex').slice(0,32)
const s=tls.connect({host:'eas.biily.top',port:8443,servername:'eas.biily.top'},()=>s.write(\`EAS-TUNNEL/1 agent \${id} \${k}\n\`))
s.on('data',c=>{ const ok=String(c).startsWith('EAS-TUNNEL/1 ok'); console.log('   ' + (ok?'✓ 线上握手成功':'✗ 回应异常: '+c)); process.exit(ok?0:1) })
s.on('error',e=>{ console.log('   ✗ 连不上: '+(e.code||e.message)+'（8443 在阿里云安全组里放行了吗？）'); process.exit(1) })
setTimeout(()=>{ console.log('   ✗ 超时'); process.exit(1) },12000)
"
echo "✓ 发完了"
