# 任务清单固定锚点
用户要求：拖动画板时任务列表跟随AI模块，固定模块右上角，相对不漂移。
工作树/private/tmp/eas-task-list-anchor-20260927，基线ebe1df4e，分支fix/task-list-anchor-20260927。只改PlanCard/planDockPlacement及测试和架构03/10。回归6通过，全量3841pass19skip0fail，build与最终隔离真实UI通过，证据docs/verification/task-list-anchor/README.md与result.json。
未提交/推送/合并/发版，未替换正式应用；用户要求提交时默认推送。根工作树旧脏改动未动，截图复制到根docs同目录用于Frame预览。

## 提交合并授权
用户已要求提交并合并；独立复审无阻断，补3条恢复场景UI回归。主线已前进efc1886d且升级Electron，提交推送后安全整合并使用主线锁文件独立依赖重验，不发版。上文未提交状态为历史。

## 提交与主线整合复验
88b46530已提交推送；安全整合efc1886d，文档保留双方追加。独立Electron42.11.8下check3913pass19skip0fail、build与真实UI通过，截图已检查。只修测试环境缺失二进制，不改正式应用；最终合并提交见git历史。本次不发版。
