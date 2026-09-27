# 0.4.113 分发状态（2026-09-27）

## 已完成：GitHub
- 公开时间 2026-09-27T10:50:27Z；非draft、非prerelease，已设Latest。
- https://github.com/biily786063474-boop/eas_term/releases/tag/v0.4.113
- 五包上传齐全后逐个核对GitHub digest/size与本地artifacts.json一致，才公开。Mac双架构+Windows tag CI同构建提交9cb85bb3002b872262d723e32094724e2d94a9dd；公开前重新fetch确认origin/main与tag均相同。
- Windows run36312457524全流程success，6项内置能力UI检查+cleanup cleaned:true，未以112失败产物替代。

## 未完成：官网与自动更新
- 官网latest仍0.4.111；没有上传113到官网、没有改网页/latest、没有删服务器旧包或重启服务。
- 服务器空余约1.56GB，新版五包约1.10GB；为不把共用生产磁盘压至约0.45GB，等待旧版本归档清理授权，不擅自删旧版。
- 候选清理范围仅0.4.100–0.4.102，共15包；只读核对本机15/15均与服务器SHA256相同。
- **100/101的GitHub仅有Windows包，缺8个Mac镜像**；已更正原先“镜像保留”假设，补发授权问题。只有用户允许后，先补齐镜像并逐包验证digest/size，另做明确本地归档，再按精确文件名删服务器候选。102镜像齐全，103及之后不动。
- 恢复发布前必须重新fetch主线。若新增业务代码，不可直接发布旧113包，应重新按release skill定版；若仅本轮发布记录，核对源码树相同后继续。
- 官网后续：新包逐文件SCP临时名→大小/hash核验→转正；备份三页/latest，所有文件stage核验完再三页→latest最后切换；生产状态前后比对，无必要不reload。

## 不要混淆
112tag保留为未公开候选；113已在GitHub公开，但**双渠道发版尚未全部完成**。没有替换用户正式应用。存量安全告警与未验证边界见README/security-review。
