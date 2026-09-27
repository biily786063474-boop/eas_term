# 2026-09-27 · 审查并发版交接

## 已完成
- 业务审查P1/P2修复61e59617已推主线；验收脚本close/有限retry/错误聚合5b035c48已推主线。
- 0.4.112为未发布候选（tag6b5ccb0a，Windows tagCI清理EBUSY）；未移动/删除tag，改发0.4.113。
- 0.4.113 BUILD_SHA/tag=9cb85bb3002b872262d723e32094724e2d94a9dd，干净发布树 /private/tmp/eas-release-0.4.113，branch release/0.4.113。
- check3842pass18skip0fail，脚本9/9；Mac两架构签名公证/staple/Gatekeeper/DMG ZIP asar一致/真实隔离启动与资源UI通过。x64为Rosetta。
- Windows tagCI36312457524全通过，cleanup true。GitHub 2026-09-27T10:50:27Z公开Latest，五包digest/size匹配，五公开下载HEAD200。
- 安装包在 ~/Eas-Term-release/0.4.113；没替换/退出用户正式应用。

## 未完成且必须等用户授权
官网/自动更新latest仍0.4.111。服务器39.105（ssh server）仅1.56GB，新包1.10GB；未动线上文件/未删除/未重启。已问是否允许归档并清理0.4.100–102（不要把选项预选当授权）；截至此记录未收到回复。
只读核对本机15包与服务器hash一致，见 docs/verification/releases/0.4.113/old-package-inventory.json。发现100/101 GitHub缺8个Mac包，102完整；已更正授权问题，必须先补齐GitHub镜像核验+明确本地归档，然后才按精确15文件清理；103以后禁止随便动。

## 下一步
1. 读取服务器INDEX/单机档案，核对用户清理授权（没有就不删）。
2. fetch origin/main；若比9cb85bb3新增业务代码，依release skill重新构建，不能直接把旧113发成最新。仅本次发布记录提交除外，须diff源码确认相同。
3. 已备 /tmp/eas-release113-publish.py（尚未执行，初版严格main==BUILD，若有发布后记录应核对仅本记录差异后调整门禁，不可删除门禁），/tmp/eas-release113-build-sha。发布前先审脚本并补生成latest.json（新鲜时间/notes）。
4. 旧包归档/镜像/清理完成再保留至少1GiB空间；五包SCP逐文件stage/hash/转正，三页/latest备份后stage/hash，latest最后切。PM2/站点前后对比、服务器档案更新。
5. 完成官网后更新distribution/README/report和计划余下两项，不把GitHub公开当双渠道完成。

计划85b244ba-b50a-4648-ae34-6a0c55571552；前3步已报告完成。报告root工作树 docs/verification/releases/0.4.112/progress.html 复用原Frame节点；实际最终报告位于0.4.113/report.html。所有构建/上传进程完成后停止轮询，不留假后台。

## 保留边界
Electron37.10.3存量audit16告警未消除；真实16GB/OS压力/在线3CLI/实体Intel和Windows现场/Computer Use生命周期未完成。本地双重sandbox验证失败已记录，没有绕过沙箱。
