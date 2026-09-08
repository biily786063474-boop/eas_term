# 私发诊断接收端

独立 Python 3.6+ 服务，无第三方依赖，loopback:4187，由 eas.biily.top 精确 location 转发。不要改匿名 /e、官网文件、下载或更新清单。

## 验证

`cd deploy/diagnostics && python3 -m unittest -v`

部署前在目标 Python 跑同一套测试。服务账户 eas-diagnostics，代码 /opt/eas-diagnostics，数据 /var/lib/eas-diagnostics（0700），报告文件0600。报告14天清理、总量100MiB。运行失败由 systemd 重启。Nginx zone 必须在 http 层，location 仅 HTTPS server；先备份 vhost，nginx -t 成功再 reload，前后比对生产站点。

## 已部署（2026-09-08）

- systemd: eas-diagnostics.service；HTTPS: /diagnostics/v1/reports。
- 原 nginx vhost 备份：/opt/eas-diagnostics/eas-vhost.before-20260908.conf。
- 回滚：先核对当前 vhost 无后续他人改动；删除本功能的两个 zone 和精确 location（或无后续改动时恢复该备份），nginx -t 成功后 reload；systemctl disable --now eas-diagnostics。保留已收报告，不删除其它服务文件。
- 维护者通过现有 SSH 通道读取 `/var/lib/eas-diagnostics/<报告UUID>.json`。没有公开读取/list API。不将报告加入 Git 或上传看板。
- 所有上传均需要测试者逐次确认。客户端没有服务器管理凭证。无跟随重定向，未知回执使用同一报告ID手动重试。

## 边界

无原生 dump；Error.message / CLI stderr 不上传。栈仅允许 main/preload bundle 行列位置，不含原始路径或函数名。固定导出是 userData/diagnostic-report.json.gz，可解压为JSON人工查看；不要拿旧 agent-sessions.log 当新报告发送。
