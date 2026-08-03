#!/bin/bash
# 在 39.105.40.173 上安装 eas.biily.top 的数据看板。
#
# 设计前提（照搬 Aurora 那套已验证的做法，坑都在服务器档案里记着）：
#   · 零常驻进程：采集靠 nginx 直接写日志，聚合靠 cron，看板是静态文件
#   · 只加不改：新建自己的目录和 location，不碰任何现有站点
#   · 幂等：重复跑不会把配置插两遍
#
# 用法：先 --check 看它打算做什么，确认无误再不带参数执行。
set -euo pipefail

DRY=0
[ "${1:-}" = "--check" ] && DRY=1

SITE_CONF=/www/server/panel/vhost/nginx/eas.biily.top.conf
DASH_DIR=/www/wwwroot/eas-dash/dashboard
AUTH_DIR=/www/server/eas-auth
NGINX=/www/server/nginx/sbin/nginx

say() { echo "  $*"; }
run() { if [ "$DRY" = "1" ]; then say "[将执行] $*"; else eval "$@"; fi }

echo "== 1. 目录 =="
run "mkdir -p $DASH_DIR $AUTH_DIR"
run "chown -R www:www /www/wwwroot/eas-dash $AUTH_DIR"
run "chmod 750 $AUTH_DIR"

echo "== 2. 鉴权口令 =="
# 密码文件必须放在 nginx worker(www) 读得到的地方。
# 宝塔的 vhost 目录是 drw-------，worker 进不去；nginx/conf 是 root 独占。
# 所以专门建 www:www 750 的目录 —— 这是 Aurora 那次踩出来的。
if [ -s "$AUTH_DIR/.eas-dash" ]; then
  say "已存在，跳过（要改密码就手动覆盖这个文件）"
else
  run "cp /tmp/eas-dash-hash.txt $AUTH_DIR/.eas-dash"
  run "chown www:www $AUTH_DIR/.eas-dash && chmod 640 $AUTH_DIR/.eas-dash"
fi

echo "== 3. nginx location =="
if grep -q "location = /e" "$SITE_CONF" 2>/dev/null; then
  say "已存在埋点 location，跳过"
else
  say "在 server 块末尾插入 /e 与 /dashboard/"
  # 用大括号配对找 server 块的结尾，不用字符串锚点 ——
  # 按关键字插很容易插进嵌套的 location 里（Aurora 那次就插错了块，被 nginx -t 挡下）
  if [ "$DRY" = "0" ]; then
    cp "$SITE_CONF" "$SITE_CONF.bak.$(date +%Y%m%d%H%M%S)"
    python3 - "$SITE_CONF" <<'PYEOF'
import sys
p = sys.argv[1]
src = open(p, encoding='utf-8').read()
block = '''
    # ── 站内统计埋点：只记一行日志，什么都不返回 ──
    location = /e {
        access_log /www/wwwlogs/eas-events.log events;
        add_header Cache-Control "no-store";
        return 204;
    }

    # ── 数据看板：服务端强制鉴权，stats.json 也在保护内 ──
    location /dashboard/ {
        auth_basic "Eas-Term Dashboard";
        auth_basic_user_file /www/server/eas-auth/.eas-dash;
        # 用 root 不用 alias：/dashboard/x → /www/wwwroot/eas-dash/dashboard/x。
        # alias 与 try_files 同用是 nginx 经典坑，会 500。
        root /www/wwwroot/eas-dash;
        index index.html;
        add_header Cache-Control "no-store";
    }
'''
import re
# **必须插进监听 443 的那个 server 块。**
# 这个站有两个 server：80 只做跳转、443 才是真正服务的。
# 取「第一个 server」会插进跳转块，HTTPS 请求根本走不到，表现为新端点全 404（实测踩过）。
target_end = None
for m in re.finditer(r'\bserver\s*\{', src):
    i0 = src.index('{', m.start())
    depth, j0 = 0, i0
    while j0 < len(src):
        if src[j0] == '{':
            depth += 1
        elif src[j0] == '}':
            depth -= 1
            if depth == 0:
                break
        j0 += 1
    if re.search(r'listen\s+443', src[m.start():j0]):
        target_end = j0
        break
if target_end is None:
    raise SystemExit('    ✗ 没找到监听 443 的 server 块，未做改动')
out = src[:target_end] + block + src[target_end:]
open(p, 'w', encoding='utf-8').write(out)
print('    已插入（备份见 .bak.*）')
PYEOF
  fi
fi

echo "== 4. 聚合脚本与 cron =="
run "chmod 755 /usr/local/bin/eas-stats.py"
if crontab -l 2>/dev/null | grep -q eas-stats; then
  say "cron 已存在，跳过"
else
  run "(crontab -l 2>/dev/null; echo '*/10 * * * * /usr/bin/python3 /usr/local/bin/eas-stats.py >> /var/log/eas-stats.log 2>&1') | crontab -"
fi

echo "== 5. 日志轮转（90 天）=="
if [ -f /etc/logrotate.d/eas ]; then
  say "已存在，跳过"
else
  if [ "$DRY" = "0" ]; then
    cat > /etc/logrotate.d/eas <<'LOGEOF'
/www/wwwlogs/eas-events.log {
    daily
    rotate 90
    compress
    missingok
    notifempty
    create 0644 www www
    sharedscripts
    postrotate
        [ -f /www/server/nginx/logs/nginx.pid ] && kill -USR1 $(cat /www/server/nginx/logs/nginx.pid)
    endscript
}
LOGEOF
    say "已写入 /etc/logrotate.d/eas"
  else
    say "[将执行] 写 /etc/logrotate.d/eas"
  fi
fi

echo "== 6. 语法检查 =="
if [ "$DRY" = "0" ]; then
  $NGINX -t
else
  say "[将执行] $NGINX -t"
fi

echo
echo "检查完毕。确认无误后不带 --check 再跑一次；reload 由外层脚本负责（要先后比对现有站点）。"
