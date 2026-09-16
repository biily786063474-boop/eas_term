#!/bin/bash
# 把「按需下载」的第三方查看器（目前只有 @google/model-viewer）传到 eas.biily.top/deps/。
# app 不打包它，用户首次查看 3D 时按需下载 —— 所以**发 app 之前必须先跑这个**，否则点下载 404。
#
#   bash scripts/publish-deps.sh
#
# 从 npm 取指定版本的 umd.min，逐字节核对 sha256（与 src/shared/modelViewerDep.ts 里钉的一致），
# 再逐个 scp（不用 -r），传完核对服务器上的 sha256。
set -euo pipefail

HOST=server
DEPS=/www/wwwroot/eas/deps   # https://eas.biily.top/deps/

# 直接从源码抓常量（不引入构建）
VERSION=$(grep -oE "MODEL_VIEWER_VERSION = '[^']+'" src/shared/modelViewerDep.ts | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
WANT_SHA=$(grep -oE "MODEL_VIEWER_SHA256 = '[0-9a-f]+'" src/shared/modelViewerDep.ts | grep -oE "[0-9a-f]{64}")
REMOTE_NAME="model-viewer-${VERSION}-umd.min.js"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
say "▸ 取 @google/model-viewer@${VERSION}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && npm pack "@google/model-viewer@${VERSION}" >/dev/null 2>&1 && tar xzf ./*.tgz )
SRC="$TMP/package/dist/model-viewer-umd.min.js"
[ -f "$SRC" ] || { echo "  ✗ 没找到 dist/model-viewer-umd.min.js"; exit 1; }

GOT_SHA=$(shasum -a 256 "$SRC" | awk '{print $1}')
if [ "$GOT_SHA" != "$WANT_SHA" ]; then
  echo "  ✗ sha256 不符：npm 给的是 ${GOT_SHA}，源码里钉的是 ${WANT_SHA}"
  echo "    （版本对不上或上游重打过包；先核对 modelViewerDep.ts 再传）"
  exit 1
fi
say "  ✓ sha256 与源码一致（${GOT_SHA}）"

say "▸ 上传 → ${DEPS}/${REMOTE_NAME}"
ssh "$HOST" "mkdir -p $DEPS"
scp "$SRC" "$HOST:$DEPS/$REMOTE_NAME"
REMOTE_SHA=$(ssh "$HOST" "sha256sum $DEPS/$REMOTE_NAME 2>/dev/null | awk '{print \$1}'")
if [ "$REMOTE_SHA" != "$WANT_SHA" ]; then
  echo "  ✗ 服务器上的 sha256 对不上（${REMOTE_SHA}），传输可能被截断"
  exit 1
fi
say "  ✓ 服务器核对通过"
say "✓ 完成：https://eas.biily.top/deps/${REMOTE_NAME}"
