#!/bin/bash
# 把刚打好的包装到 /Applications。
#
# **必须在 Eas-Term 已经退出的情况下跑。** 热替换一个正在运行的 bundle 的后果：
# 运行中的进程 bundle 被移走、同名位置换成另一个 app，紧接着重建 LaunchServices 索引 ——
# 这期间窗口服务器对该 app 的追踪会短暂失效（表现是「窗口还在，哪里都点不动」），
# 而且换完之后进程还在读**新版**的资源，属于带病运行。2026-08-06 踩过。
#
# 用法：退出 Eas-Term，然后双击桌面的 .command，或者 bash scripts/install-local.sh
set -uo pipefail

APP=/Applications/Eas-Term.app
REL=~/Eas-Term-release
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
bad()  { printf "\033[31m✗\033[0m %s\n" "$*"; }
info() { printf "  %s\n" "$*"; }

# 本机架构对应哪个产物 —— 装错架构能跑但走 Rosetta，白白慢一截
case "$(uname -m)" in
  arm64) NEW="$REL/mac-arm64/Eas-Term.app" ;;
  x86_64) NEW="$REL/mac/Eas-Term.app" ;;
  *) bad "不认识的架构 $(uname -m)"; exit 1 ;;
esac

echo
echo "── Eas-Term 本机安装 ──"
echo

[ -d "$NEW" ] || { bad "找不到新包：$NEW"; info "先跑 EAS_NOTARIZE=1 npm run dist"; exit 1; }
VER=$(defaults read "$NEW/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null | tr -cd "0-9.")
[ -n "$VER" ] || { bad "新包读不到版本号"; exit 1; }

# 还开着就别装 —— 这是这个脚本存在的全部理由
# 判据三选一，**实测过才敢用**（2026-08-06 在这里栽过：随手选了唯一漏的那个，
# 闸门形同虚设，当场热装了正在运行的 bundle）：
#   pgrep -f "MacOS/Eas-Term"                 → 命中 ✓  用这个
#   ps -axo command | grep 全路径             → 命中 ✓
#   pgrep -x "Eas-Term"                       → **漏**（进程名不是纯 Eas-Term）
#   pgrep -f "Eas-Term.app/Contents/MacOS"    → **漏**（长模式匹配不到）
# 两条一起判，任一命中就拦 —— 这道闸门漏一次的代价，比多判一次大得多。
if pgrep -f "MacOS/Eas-Term" > /dev/null 2>&1 \
   || ps -axo command | grep -q "[E]as-Term.app/Contents/MacOS/Eas-Term"; then
  bad "Eas-Term 还开着，请先完全退出（⌘Q）再跑这个脚本"
  info "热替换正在运行的 bundle 会让窗口一段时间点不动，之后还是带病运行"
  exit 1
fi

codesign --verify --strict "$NEW" 2>/dev/null && ok "新包签名有效" || { bad "新包签名校验不过，中止"; exit 1; }
xcrun stapler validate "$NEW" >/dev/null 2>&1 && ok "公证票据已附着" || info "⚠ 没有公证票据（本机装可用，别人下载会被拦）"
info "待装 ${VER}（$(uname -m)）"

OLD=unknown
[ -d "$APP" ] && OLD=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null | tr -cd "0-9." || echo unknown)
if [ -d "$APP" ]; then
  BAK="$APP.old-$OLD"
  [ -e "$BAK" ] && rm -rf "$BAK"
  mv "$APP" "$BAK" || { bad "备份旧版失败"; exit 1; }
  ok "旧版 ${OLD} 已备份到 $(basename "$BAK")"
fi

if ! ditto "$NEW" "$APP"; then
  bad "复制失败，回滚"
  rm -rf "$APP"; [ -d "${BAK:-}" ] && mv "$BAK" "$APP"
  exit 1
fi

# 命令行装绕过了 LaunchServices 注册 → Dock「保留在程序坞」会失效，必须补
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

GOT=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null | tr -cd "0-9.")
if [ "$GOT" != "$VER" ]; then
  bad "装完版本对不上（期望 ${VER}，实际 ${GOT}），回滚"
  rm -rf "$APP"; [ -d "${BAK:-}" ] && mv "$BAK" "$APP"
  exit 1
fi
codesign --verify --strict "$APP" 2>/dev/null && ok "装完签名完好" || info "⚠ 装完签名校验不过"
ok "已装 ${GOT}"
[ -d "${BAK:-}" ] && info "退路留在 $(basename "${BAK:-}")，确认没问题后可以删"

echo
open -a "$APP" && ok "已重新打开" || info "自动打开失败，手动点一下"
echo
