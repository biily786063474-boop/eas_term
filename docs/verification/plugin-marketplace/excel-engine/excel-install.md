# Microsoft Excel 实机验收准备 · 2026-09-21

用户明确要求：本机没有Excel就下载并继续工作。仅安装官方Excel，不动Eas-Term正式应用，不购买订阅、不绕过许可。

官方来源：https://learn.microsoft.com/en-us/officeupdates/update-history-office-for-mac
独立安装器微软转发：https://go.microsoft.com/fwlink/?linkid=525135
本机实际HEAD返回302至：
https://res.public.onecdn.static.microsoft/mro1cdnstorage/C1297A47-86C4-4C1F-97FA-950631F94777/MacAutoupdate/Microsoft_Excel_16.113.26091740_Installer.pkg
HTTP200，Content-Length 1179079831。不是Updater包，也不是Office全套。

下载目录：~/Downloads/Eas-Term-Excel-verification/
下载中先使用.pkg.part；成功后改.pkg并运行pkgutil --check-signature及sha256。只有签名核实Microsoft后才能启动安装。
若需要系统管理员密码，用户在原生认证界面输入；激活由用户在Microsoft界面登录，不收集聊天凭证。
下载成功、安装成功、激活成功、图表/透视实际验收是四个独立状态，不得混同。
