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
# 线上只留最新一版。旧版本每发一次就删掉 —— 一个版本三个包近 500MB，
# 而这台机器只有 40G 且还跑着三个生产站。
# **代价要知道**：旧版本的下载链接会立刻 404，出问题时没法叫人「先退回上一版」。
# 想留一版兜底就改成 2。
KEEP=1
OTHER_SITES=(www.biily.top aurora.biily.top)   # 每次 reload 都要确认没碰坏的

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
SITE_ONLY=${1:-}

say() { printf "\033[1m%s\033[0m\n" "$*"; }

# ── 版本号回填 ──────────────────────────────────────────────────────
# 下载链接的版本号写死在 HTML 里，散在两个文件的 18 处。手改必然漏一两处，
# 而漏掉的那处会指向一个已经被 KEEP=5 清理掉的目录 —— 404 且没人发现。
# 以 package.json 为准，发布前统一回填，改动留在仓库里（git diff 看得见）。
say "▸ 版本号 → v$VERSION"
CHANGED=0
for f in site/index.html site/download.html; do
  before=$(shasum "$f" | cut -d' ' -f1)
  # 两种形态：标记注释 <!-- v0.1.0 --> 和链接里的 /download/v0.1.0/Eas-Term-0.1.0-
  sed -i '' -E "s#(<!-- v)[0-9]+\.[0-9]+\.[0-9]+( -->)#\1$VERSION\2#g; \
                s#/download/v[0-9]+\.[0-9]+\.[0-9]+/Eas-Term-[0-9]+\.[0-9]+\.[0-9]+-#/download/v$VERSION/Eas-Term-$VERSION-#g" "$f"
  [ "$before" = "$(shasum "$f" | cut -d' ' -f1)" ] || { echo "  ✓ $f 已更新"; CHANGED=1; }
done
[ "$CHANGED" = 1 ] || echo "  已是 v${VERSION}，无需改动"
# 回填完必须没有残留的旧版本号。只查**我们真正改写的那两种写法** ——
# 别在全文里搜 x.y.z：SVG 的 path 坐标长得一模一样（`3.7 0 1-.5 1.8-.5`），
# 会把每次发布都拦下来，然后人就学会了无视这个检查。
STALE=$(grep -ohE '<!-- v[0-9]+\.[0-9]+\.[0-9]+ -->|/download/v[0-9]+\.[0-9]+\.[0-9]+/[^"]*' \
          site/index.html site/download.html | grep -v "$VERSION" || true)
[ -z "$STALE" ] || { echo "  ✗ 还有对不上的版本号，正则没覆盖全："; echo "$STALE" | sort -u; exit 1; }

# ── 网页 ────────────────────────────────────────────────────────────
say "▸ 网页 → $WEB"
ssh $HOST "mkdir -p $WEB/assets"
for f in index.html download.html style.css; do
  scp -q "site/$f" "$HOST:$WEB/$f"
  L=$(stat -f%z "site/$f"); R=$(ssh $HOST "stat -c%s $WEB/$f")
  [ "$L" = "$R" ] || { echo "  ✗ $f 大小不符（本地 $L / 远端 ${R}）"; exit 1; }
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
  [ -d "$PKG_DIR" ] || { echo "  ✗ 找不到 ${PKG_DIR}，先跑 EAS_NOTARIZE=1 npm run dist"; exit 1; }

  # 传之前先看磁盘（红线：这台机器只有 40G）
  ssh $HOST "df -h / | tail -1 | sed 's/^/  磁盘: /'"

  # 只传**当前版本**的包。以前是 `$PKG_DIR/*.dmg` 通配整个目录 ——
  # 那个目录会攒下历代产物，于是发 v0.2.2 时会把 v0.1.0、v0.2.1 的包
  # 一起塞进 v0.2.2/ 目录：下载页链接是对的，但目录里多出几百 MB 无人认领的旧包，
  # 而这台机器只剩 19G。文件名形如 Eas-Term-<版本>-universal.dmg，按版本号筛。
  ssh $HOST "mkdir -p $DL/v$VERSION"
  FOUND=0
  for f in "$PKG_DIR"/*-"$VERSION"-*.dmg "$PKG_DIR"/*-"$VERSION"-*.zip "$PKG_DIR"/*-"$VERSION"-*.exe; do
    [ -e "$f" ] || continue
    FOUND=$((FOUND + 1))
    n=$(basename "$f")
    echo "  传 ${n}（$(( $(stat -f%z "$f") / 1048576 )) MB）…"
    scp -q "$f" "$HOST:$DL/v$VERSION/$n"
    L=$(shasum -a 256 "$f" | cut -d' ' -f1)
    R=$(ssh $HOST "sha256sum $DL/v$VERSION/$n | cut -d' ' -f1")
    [ "$L" = "$R" ] || { echo "  ✗ $n SHA256 不符，远端已删"; ssh $HOST "rm -f $DL/v$VERSION/$n"; exit 1; }
    echo "    ✓ 校验通过"
  done
  [ "$FOUND" -gt 0 ] || { echo "  ✗ $PKG_DIR 里没有 v$VERSION 的包，先跑 EAS_NOTARIZE=1 npm run dist"; exit 1; }

  # latest.json 本地生成再传，不用远端 heredoc：
  # 那条路要穿过 ssh 的一层双引号，转义写出来的是带反斜杠的坏 JSON。
  # 顺带也跟网页一样走「传完核对大小」。
  # win 字段只在**包真的在**时才写 —— Windows 包是 CI 产物、得手动拉下来放进目录，
  # 忘了拉还照写的话，下载页上就挂着一个 404 链接。
  TMP_JSON=$(mktemp)
  {
    echo "{ \"version\": \"$VERSION\","
    echo "  \"mac\": \"/download/v$VERSION/Eas-Term-$VERSION-universal.dmg\","
    echo "  \"macZip\": \"/download/v$VERSION/Eas-Term-$VERSION-universal-mac.zip\","
    if [ -e "$PKG_DIR/Eas-Term-$VERSION-x64-setup.exe" ]; then
      echo "  \"win\": \"/download/v$VERSION/Eas-Term-$VERSION-x64-setup.exe\","
    else
      echo "  ⚠ 没有 Windows 包，latest.json 不写 win 字段" >&2
    fi
    echo "  \"published\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" }"
  } > "$TMP_JSON"
  node -e "JSON.parse(require('fs').readFileSync('$TMP_JSON','utf8'))" ||
    { echo "  ✗ latest.json 不是合法 JSON，没传"; rm -f "$TMP_JSON"; exit 1; }
  scp -q "$TMP_JSON" "$HOST:$DL/latest.json"
  L=$(stat -f%z "$TMP_JSON"); R=$(ssh $HOST "stat -c%s $DL/latest.json")
  rm -f "$TMP_JSON"
  [ "$L" = "$R" ] || { echo "  ✗ latest.json 大小不符"; exit 1; }
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
      # 绝不删刚传上去的这一版。KEEP=1 时这条不是多余的谨慎：
      # 万一补发一个比线上更老的版本（v0.2.2 而线上已有 v0.2.3），
      # sort -V 会把刚传的排在前面 → 上一秒传完、下一秒自己把它删了，
      # 而且 latest.json 已经指过去了，线上直接 404。
      [ "$old" = "v$VERSION" ] && { echo "  跳过 $old（本次刚发布的）"; continue; }
      echo "  删除 $old"
      ssh $HOST "rm -rf $DL/$old"          # 只删版本子目录，绝不动 $DL 本身
    done
    ssh $HOST "df -h / | tail -1 | sed 's/^/  清理后磁盘: /'"
  else
    echo "  当前 $TOTAL 个版本，未超过 ${KEEP}，不删"
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
