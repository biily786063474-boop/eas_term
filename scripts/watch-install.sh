#!/bin/bash
# 等 Eas-Term 退出 → 装新版 → 重新打开 → 卸载并删除自己。
#
# 为什么要这么绕：用户是**通过 Eas-Term 里的终端**在跟 agent 对话的，
# 退出应用等于把那个会话也关掉，没法「退出后再跟我说一声」。
# 而热替换正在运行的 bundle 又会让窗口一段时间点不动、之后带病运行（2026-08-06 踩过）。
# 所以让 launchd 起一个**独立于 Eas-Term 进程树**的守候进程：
# 用户只管 ⌘Q，剩下的它做完，应用自己回来。
#
# 由 ~/Library/LaunchAgents/top.biily.eas-term.installer.plist 拉起，不常驻：
# 装完（或等超时）就删掉 plist 并 bootout 自己。
set -uo pipefail

LABEL=top.biily.eas-term.installer
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/eas-term-install.log"
REPO="${EAS_REPO:-/Users/biily/Biily/Projects/vibe coding/terminal}"
WAIT_MIN="${EAS_WAIT_MIN:-40}"

exec >>"$LOG" 2>&1
echo
echo "════ $(date '+%F %T') 守候启动（最多等 ${WAIT_MIN} 分钟）════"

# 判据两条一起判，任一命中就算在跑 —— 和 install-local.sh 用同一套，
# 那里注释记着实测结果：pgrep -x 和 pgrep -f "Eas-Term.app/Contents/MacOS" 都会漏。
running() {
  pgrep -f "MacOS/Eas-Term" >/dev/null 2>&1 ||
    ps -axo command | grep -q "[E]as-Term.app/Contents/MacOS/Eas-Term"
}

# 收摊：先删 plist（下次登录不会再被拉起），再延迟 bootout 自己，
# 这样本脚本能正常走完最后几行日志再被结束
cleanup() {
  echo "──── $(date '+%F %T') 收摊，移除守候 ────"
  rm -f "$PLIST"
  ( sleep 2; launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 ) &
}

for _ in $(seq 1 $((WAIT_MIN * 12))); do
  running || break
  sleep 5
done

if running; then
  echo "等满 ${WAIT_MIN} 分钟，Eas-Term 仍开着 —— 放弃自动安装，不留后台常驻。"
  echo "包还在 ~/Eas-Term-release，随时可以退出应用后手动跑 scripts/install-local.sh"
  cleanup
  exit 0
fi

sleep 3 # 给它把文件句柄和资源释放干净
echo "Eas-Term 已退出，开始安装 ──────────────"
bash "$REPO/scripts/install-local.sh"
RC=$?
echo "────────── install-local.sh 退出码 $RC"
[ "$RC" -ne 0 ] && echo "⚠ 安装没成功。旧版已由脚本自动回滚，手动排查看上面的输出。"
cleanup
