#!/usr/bin/env bash
# 把 dist/plugins/（build-plugin-registry.mjs 的产物）发布到官方目录静态托管。
#
#   · 逐个 scp，不用 -r —— 传完逐个核对字节大小 + SHA256（同 publish-site.sh 的纪律）
#   · **先传 zip，最后传 registry.json** —— 客户端先看 registry，先有包再有目录，
#     否则用户看到条目、点安装却 404
#   · 所有 ssh 都带 -n —— 循环用 `while read` 从管道拿 stdin，ssh 不加 -n 会把它吃掉
#     （publish-site.sh 曾因此只删一个旧版本，血泪教训）
#   · 只往 $WEB/plugins/ 加文件，不碰站点其它内容、不 reload nginx（静态文件，无需）
#
# 切阿里云 OSS/CDN 时：把上传目标换成 OSS 桶、BASE_URL 换成 CDN 域名，
# 并把该域名加进 src/main/pluginMarket.ts 的 ALLOWED_HOSTS。对客户端透明。
set -euo pipefail

HOST=server
WEB=/www/wwwroot/eas
PDIR=$WEB/plugins
SRC=dist/plugins
BASE_URL=https://eas.biily.top/plugins

[ -f "$SRC/registry.json" ] || { echo "先跑: node scripts/build-plugin-registry.mjs"; exit 1; }

echo "── 服务器磁盘 ──"
ssh -n $HOST "df -h / | tail -1 | sed 's/^/  /'"
ssh -n $HOST "mkdir -p $PDIR"

echo "── 传插件包 ──"
find "$SRC" -name '*.zip' | while read -r f; do
  rel=${f#"$SRC"/}                       # board/board-1.0.0.zip
  sub=$(dirname "$rel")
  [ "$sub" = "." ] || ssh -n $HOST "mkdir -p $PDIR/$sub"
  L=$(stat -f%z "$f")
  LSHA=$(shasum -a 256 "$f" | cut -d' ' -f1)
  scp -q "$f" "$HOST:$PDIR/$rel"
  R=$(ssh -n $HOST "stat -c%s $PDIR/$rel")
  RSHA=$(ssh -n $HOST "sha256sum $PDIR/$rel | cut -d' ' -f1")
  if [ "$L" != "$R" ] || [ "$LSHA" != "$RSHA" ]; then
    echo "  ✗ $rel 传输不一致，远端已删"; ssh -n $HOST "rm -f $PDIR/$rel"; exit 1
  fi
  echo "  OK ${rel}  ${L}B"
done

echo "── 传 registry.json（最后传）──"
scp -q "$SRC/registry.json" "$HOST:$PDIR/registry.json"
L=$(stat -f%z "$SRC/registry.json"); R=$(ssh -n $HOST "stat -c%s $PDIR/registry.json")
[ "$L" = "$R" ] || { echo "  ✗ registry.json 字节不一致"; exit 1; }
echo "  OK registry.json  ${L}B"

echo "── 线上自检 ──"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/registry.json")
echo "  registry.json → HTTP $code"
[ "$code" = 200 ] || { echo "  ✗ registry.json 线上取不到"; exit 1; }
# 逐条 url 取一次头，核对 HTTP 200 且 content-length == registry 声明的 size
node -e '
const https=require("https")
const reg=JSON.parse(require("fs").readFileSync("'"$SRC"'/registry.json","utf8"))
let bad=0, left=reg.plugins.length
if(!left){console.log("  (目录为空)");process.exit(0)}
for(const p of reg.plugins){
  https.request(p.url,{method:"HEAD"},r=>{
    const len=Number(r.headers["content-length"]||0)
    const ok=r.statusCode===200 && len===p.size
    console.log(`  ${p.name}@${p.version} → HTTP ${r.statusCode} len ${len}/${p.size} ${ok?"✓":"✗"}`)
    if(!ok)bad++
    if(--left===0)process.exit(bad?1:0)
  }).on("error",e=>{console.log(`  ${p.name} → ${e.message} ✗`);bad++;if(--left===0)process.exit(1)}).end()
}
'
echo "发布完成：$BASE_URL/registry.json"
