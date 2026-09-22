# 外部来源公网链路验收 · 2026-09-22

结果：通过。产品基线51bcda9；使用已构建out与独立Electron应用包，隔离home/profile。没有网络mock、DNS override、请求重定向、证书绕过；没有改产品安全校验。本次不是主程序发版。

## DNS阻塞修复
原系统lookup(eas.biily.top)=198.18.0.152（Clash fake-IP），产品正确拒绝。
只对eas.biily.top添加fake-ip-filter和DOMAIN直连规则：当前profile merge/rules源文件及运行时clash-verge.yaml同时写入；原件旁有.eas-source-20260922.bak备份（0600），未入仓。
PUT /configs?force=true重新加载后，Clash DNS与系统lookup均为39.105.40.173。未全局清缓存、未关闭TUN、未降低TLS或公网地址保护。

## 真实应用操作
1. 添加来源：公网完整验收，https://eas.biily.top/plugins/verification/external-20260922-a/registry.json；原生信任确认后选中。
2. 从真实HTTPS下载market-live-check 1.0.0，界面展示版本/来源/权限后确认安装。磁盘manifest=1.0.0；保存宿主来源收据。
3. 仅原子切换该独立测试目录registry到1.1.0；应用不重启，点击检查更新，显示“已安装v1.0.0 · 有更新v1.1.0”。
4. 点击更新，界面显示原来源、权限未变化，确认后显示“已安装v1.1.0”（updated-1.1.0.png）。磁盘manifest=1.1.0，两版来源收据逐字相同。
5. 项目history-must-stay历史与timeline全局记录关闭授权配置SHA256不变。
6. 两个ZIP均经公网完整下载，与本地包逐字一致；服务端逐文件SCP后大小/SHA256核对。
7. 正式v1/v2目录hash与5个pm2的PID/status前后相同；没有生产服务重启。
8. 只退出本次验收应用，launcher退出0。正式应用与用户插件目录未更改。

## 范围
测试包由本项目自行生成、托管在用户已有官方域名的独立测试路径，通过“外部来源”代码路径而非官方目录安装。证明真实公网协议/安装/原源更新，不等于兼容任意第三方平台的插件格式，也不覆盖其他域名的代理环境。隔离包不请求画布权限，未测试具体第三方插件功能。
已发布测试路径保留供复验，不加入正式目录。setup.mjs仅复现实验启动，不能作正式发版脚本。
