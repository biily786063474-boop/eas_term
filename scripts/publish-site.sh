#!/bin/bash
# 发布 Eas-Term 到 eas.biily.top（网页 + 安装包），并按规则清理旧版本。
#
#   ./scripts/publish-site.sh              # 网页 + 当前版本的安装包
#   ./scripts/publish-site.sh --site-only  # 只更新网页（改文案/截图时用）
#
# 规则（来自 ~/.claude/servers/39.105.40.173-阿里云.md）：
#   · 逐个 scp，不用 -r、不用 rsync --delete
#   · 传完逐个核对（网页比大小、安装包比 SHA256）
#   · reload 前后比对现有生产站点状态码，不一致就是事故
#   · 安装包只保留最近 KEEP 个版本，更早的删掉
set -euo pipefail

HOST=server
WEB=/www/wwwroot/eas
DL=/www/wwwroot/eas-dl
KEEP=5                       # 保留最近几个版本
OTHER_SITES=(www.biily.top aurora.biily.top)   # 每次 reload 都要确认没碰坏的

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
SITE_ONLY=${1:-}

say() { printf "\033[1m%s\033[0m\n" "$*"; }

# ── 网页 ────────────────────────────────────────────────────────────
say "▸ 网页 → $WEB"
ssh $HOST "mkdir -p $WEB/assets"
for f in index.html download.html style.css; do
  scp -q "site/$f" "$HOST:$WEB/$f"
  L=$(stat -f%z "site/$f"); R=$(ssh $HOST "stat -c%s $WEB/$f")
  [ "$L" = "$R" ] || { echo "  ✗ $f 大小不符（本地 $L / 远端 $R）"; exit 1; }
  echo "  ✓ $f"
done
for f in site/assets/*; do
  n=$(basename "$f")
  scp -q "$f" "$HOST:$WEB/assets/$n"
  L=$(stat -f%z "$f"); R=$(ssh $HOST "stat -c%s $WEB/assets/$n")
  [ "$L" = "$R" ] || { echo "  ✗ assets/$n 大小不符"; exit 1; }
  echo "  ✓ assets/$n"
done

# ── 安装包 ──────────────────────────────────────────────────────────
if [ "$SITE_ONLY" != "--site-only" ]; then
  PKG_DIR="$HOME/Eas-Term-notarized"
  say "▸ 安装包 v$VERSION → $DL/v$VERSION"
  [ -d "$PKG_DIR" ] || { echo "  ✗ 找不到 $PKG_DIR，先跑 EAS_NOTARIZE=1 npm run dist"; exit 1; }

  # 传之前先看磁盘（红线：这台机器只有 40G）
  ssh $HOST "df -h / | tail -1 | sed 's/^/  磁盘: /'"

  ssh $HOST "mkdir -p $DL/v$VERSION"
  for f in "$PKG_DIR"/*.dmg "$PKG_DIR"/*.zip; do
    [ -e "$f" ] || continue
    n=$(basename "$f")
    echo "  传 $n（$(( $(stat -f%z "$f") / 1048576 )) MB）…"
    scp -q "$f" "$HOST:$DL/v$VERSION/$n"
    L=$(shasum -a 256 "$f" | cut -d' ' -f1)
    R=$(ssh $HOST "sha256sum $DL/v$VERSION/$n | cut -d' ' -f1")
    [ "$L" = "$R" ] || { echo "  ✗ $n SHA256 不符，远端已删"; ssh $HOST "rm -f $DL/v$VERSION/$n"; exit 1; }
    echo "    ✓ 校验通过"
  done

  # latest.json：给「最新版」链接和将来的自动更新用
  ssh $HOST "cat > $DL/latest.json <<JSON
{ \"version\": \"$VERSION\",
  \"mac\": \"/download/v$VERSION/Eas-Term-$VERSION-universal.dmg\",
  \"macZip\": \"/download/v$VERSION/Eas-Term-$VERSION-universal-mac.zip\",
  \"win\": \"/download/v$VERSION/Eas-Term-$VERSION-x64-setup.exe\",
  \"published\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" }
JSON"
  echo "  ✓ latest.json"

  # ── 清理：只留最近 KEEP 个版本 ──────────────────────────────────
  say "▸ 清理旧版本（保留最近 $KEEP 个）"
  # 必须用 sort -V（版本感知）：sort -t. -k1,1n 遇到 v1.0.0 会把它排到最前面
  # （"v1" 按数值解析成 0，和 "v0" 并列），于是新版本被当成最老的删掉——验过，是真会发生
  ssh $HOST "cd $DL && ls -d v*/ 2>/dev/null | sed 's#/##' | sort -V" > /tmp/eas-vers.txt || true
  TOTAL=$(wc -l < /tmp/eas-vers.txt | tr -d ' ')
  if [ "$TOTAL" -gt "$KEEP" ]; then
    head -n $((TOTAL - KEEP)) /tmp/eas-vers.txt | while read -r old; do
      [ -n "$old" ] || continue
      echo "  删除 $old"
      ssh $HOST "rm -rf $DL/$old"          # 只删版本子目录，绝不动 $DL 本身
    done
  else
    echo "  当前 $TOTAL 个版本，未超过 $KEEP，不删"
  fi
fi

# ── reload：前后比对现有站点 ────────────────────────────────────────
say "▸ nginx"
ssh $HOST "nginx -t" 2>&1 | tail -1
BEFORE=$(ssh $HOST "for h in ${OTHER_SITES[*]}; do curl -s -o /dev/null -w \"\$h=%{http_code} \" -H \"Host: \$h\" http://127.0.0.1/ --max-time 5; done")
ssh $HOST "nginx -s reload"; sleep 2
AFTER=$(ssh $HOST "for h in ${OTHER_SITES[*]}; do curl -s -o /dev/null -w \"\$h=%{http_code} \" -H \"Host: \$h\" http://127.0.0.1/ --max-time 5; done")
echo "  reload 前: $BEFORE"
echo "  reload 后: $AFTER"
[ "$BEFORE" = "$AFTER" ] || { echo "  ✗✗ 现有站点状态码变了，立刻查！"; exit 1; }
echo "  ✓ 现有生产站点未受影响"

say "▸ 线上自检"
for u in / /download.html /style.css; do
  printf "  %-16s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' "https://eas.biily.top$u" --max-time 10)"
done
[ "$SITE_ONLY" = "--site-only" ] || printf "  %-16s %s\n" "latest.json" "$(curl -s -o /dev/null -w '%{http_code}' https://eas.biily.top/download/latest.json --max-time 10)"

say "✓ 发布完成：https://eas.biily.top"
echo "  记得回去更新 ~/.claude/servers/39.105.40.173-阿里云.md 的变更记录"
