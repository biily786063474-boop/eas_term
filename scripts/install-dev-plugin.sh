#!/usr/bin/env bash
# 把 plugins-dev/<name>/ 装到 ~/.eas/plugins/<name>/：逐个文件拷（不带测试），拷完逐个核对大小。
# 个人插件不进安装包；装完要**关掉再重开面板**，已在跑的插件进程不会换代码。
set -euo pipefail
name="${1:?用法: scripts/install-dev-plugin.sh <插件名>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/plugins-dev/$name"
dst="$HOME/.eas/plugins/$name"
[ -f "$src/plugin.json" ] || { echo "没有 $src/plugin.json" >&2; exit 1; }
mkdir -p "$dst"
cd "$src"
find . -type f ! -name '*.test.*' ! -name '.DS_Store' | sort | while read -r f; do
  mkdir -p "$dst/$(dirname "$f")"
  cp "$f" "$dst/$f"
  a=$(wc -c < "$f" | tr -d ' ')
  b=$(wc -c < "$dst/$f" | tr -d ' ')
  [ "$a" = "$b" ] || { echo "大小不一致: $f ($a vs $b)" >&2; exit 1; }
  echo "  $f  $a"
done
echo "已装到 $dst —— 关掉再重开画廊面板生效"
