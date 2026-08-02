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
# 线上保留几个版本。一个版本三个包近 500MB，而这台机器只有 40G 且还跑着三个生产站。
#
# 之所以是 2 而不是 1：新版发出去才发现有问题时，得能立刻叫人「先退回上一版」。
# KEEP=1 的时候旧版本在发布那一刻就被删了，下载链接当场 404，
# 唯一的退路是重新打包一个旧版本再发一次 —— 而那时候你多半正手忙脚乱。
# 多占的 500MB 买的是这个。
KEEP=2
OTHER_SITES=(www.biily.top aurora.biily.top)   # 每次 reload 都要确认没碰坏的

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
SITE_ONLY=${1:-}

say() { printf "\033[1m%s\033[0m\n" "$*"; }

# ── 版本号回填 ──────────────────────────────────────────────────────
# 下载链接的版本号写死在 HTML 里，散在两个文件的 18 处。手改必然漏一两处，
# 而漏掉的那处会指向一个已经被 KEEP 清理掉的目录 —— 404 且没人发现。
# 以 package.json 为准，发布前统一回填，改动留在仓库里（git diff 看得见）。
#
# **--site-only 时不回填**：那条路径不传安装包，回填等于把下载链接指到一个
# 服务器上根本不存在的版本目录 —— 改个文案就把下载页搞成 404。
# （原来是无条件回填的，只要 package.json 比线上包新就会踩到。）
if [ "$SITE_ONLY" = "--site-only" ]; then
  say "▸ 版本号保持不动（--site-only 不传包，下载链接仍指向线上已有的那一版）"
  # 但要确认它指向的那些版本**服务器上真的有** —— 否则这次发布会把下载页变成 404
  WANT=$(grep -ohE '/download/v[0-9]+\.[0-9]+\.[0-9]+/' site/index.html site/download.html \
           | sed -E 's#^/download/##; s#/$##' | sort -u)
  HAVE=$(ssh $HOST "ls $DL 2>/dev/null" || true)
  MISSING=$(comm -23 <(echo "$WANT") <(echo "$HAVE" | sort -u))
  if [ -n "$MISSING" ]; then
    echo "  ✗ HTML 里引用了这些版本，但服务器 $DL/ 下没有："
    echo "$MISSING" | sed 's/^/      /'
    echo "    发上去下载页就是 404。要么先发包（去掉 --site-only），要么把链接改回线上已有的版本。"
    exit 1
  fi
  echo "  ✓ 下载链接指向的版本服务器上都有：$(echo "$WANT" | tr '\n' ' ')"
else
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
fi

# ── 网页 ────────────────────────────────────────────────────────────
say "▸ 网页 → $WEB"
ssh $HOST "mkdir -p $WEB/assets"
for f in index.html download.html privacy.html style.css; do
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
  # 必须和 package.json 的 dist 脚本输出目录一致 —— 它写的是 $HOME/Eas-Term-release
  # （项目在外置卷上，asar 会损坏，所以输出定向到 home，见 README）。
  # 这里以前写的是 Eas-Term-notarized，和构建脚本对不上，每次发版都得先手动把包搬过去，
  # 忘了搬就报「没有 v0.2.x 的包」——而包明明刚打好，人会以为是打包失败。
  PKG_DIR="$HOME/Eas-Term-release"
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
  # mac 从 universal 拆成了 arm64 / x64 两个包（下载页让用户按芯片选，体积减半）。
  # 每个字段都**只在包真的在时才写** —— 同 win 字段的理由：
  # 写了但文件没传上去，下载页上就挂着一个 404。
  TMP_JSON=$(mktemp)
  {
    echo "{ \"version\": \"$VERSION\","
    for A in arm64 x64; do
      [ -e "$PKG_DIR/Eas-Term-$VERSION-$A.dmg" ] &&
        echo "  \"mac_$A\": \"/download/v$VERSION/Eas-Term-$VERSION-$A.dmg\","
      [ -e "$PKG_DIR/Eas-Term-$VERSION-$A.zip" ] &&
        echo "  \"macZip_$A\": \"/download/v$VERSION/Eas-Term-$VERSION-$A.zip\","
    done
    # 老字段留着：外部如果有脚本按 "mac" 取链接，别一声不响地断掉。
    # 指向 arm64 —— 现在的 Mac 绝大多数是 Apple Silicon。
    [ -e "$PKG_DIR/Eas-Term-$VERSION-arm64.dmg" ] &&
      echo "  \"mac\": \"/download/v$VERSION/Eas-Term-$VERSION-arm64.dmg\","
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
  # 必须用 sort -V（版本感知）。用 sort -t. -k1,1n 的话：第一个字段是 "v0"/"v1"/"v10"，
  # 开头是字母 → -n 全解析成 0 → 所有版本在排序键上并列，最终顺序完全取决于输入顺序。
  # ls 恰好给字典序，所以 v0.x/v1.x 之间"看起来没事"——那是运气；
  # 一旦出现 v10.0.0，字典序把它排在 v2.0.0 前面，于是最新版被当成最老的删掉。
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
for u in / /download.html /privacy.html /style.css; do
  printf "  %-16s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' "https://eas.biily.top$u" --max-time 10)"
done
[ "$SITE_ONLY" = "--site-only" ] || printf "  %-16s %s\n" "latest.json" "$(curl -s -o /dev/null -w '%{http_code}' https://eas.biily.top/download/latest.json --max-time 10)"

say "✓ 发布完成：https://eas.biily.top"
echo "  记得回去更新 ~/.claude/servers/39.105.40.173-阿里云.md 的变更记录"
