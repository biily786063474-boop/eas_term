# 时间线离线平滑迁移 · 2026-09-22

用户选择一次性离线迁移包，保留历史与授权、已有用户副本不覆盖。本次为实现与开发构建验收，尚未主程序发版。

## 实现
- package.json将timeline排除出运行时plugins，单独携带plugin-migrations/timeline。源码仍保留给独立发布与编译期共享模块。
- registerPluginHandlers启动时调用固定路径迁移函数，不调整whenReady顺序。
- 迁移包校验无软链/特殊文件、有效manifest、版本与固定timeline名字；复制到同文件系统暂存目录，附官方来源收据后rename晋升。
- 用户已有任何timeline目录不覆盖，不自动替它认领来源。完成标记放~/.eas而非插件目录，卸载后不自动重装。
- 不写项目历史、事件授权、开关或画布ID。不下载，不需要联网，不授予新权限。
- 迁移失败保留旧数据，日志报错，没有有效用户副本时使用显式标注的恢复副本；不会假装独立迁移成功。
- 并发锁采取保守拒绝策略。进程若在迁移中被强杀，残留固定锁需要核查所有权后清理；不会自动抢锁。此时有恢复副本，不属于正常完成迁移。

## 实证
- 新模块缺失RED，补实现后9专项PASS。首次开发时macOS /var为系统软链导致3专项失败，改成只规范化可信home与seed父路径，依旧拒绝其内部软链；补“完成后无需seed”回归后全部绿。
- 全量check：3514总数，3495通过，19跳过，0失败。build退出0。
- 真实Electron隔离实例：首次启动后home/.eas/plugins/timeline出现，收据id=official，完成标记schema1/complete=true。
- 插件管理显示“时间线 自家”（不再内置）；通过Frame右键插入真实面板，显示既有“迁移前的成果”记录，全局记录保持关闭。
- 退出0后不重新播种的同profile重启，原画布面板自动恢复，月历仍有1项里程碑，全局记录仍关闭。历史/事件授权/插件manifest三份SHA256全部不变。
- 两次验收实例均退出0；正式/Applications应用和真实home插件目录未动。
- 使用electron-builder实际FileMatcher.createFilter核验：timeline目录和timeline/plugin.json均false，board/plugin.json=true。首次辅助探针把第四参数错传成对象，TypeError；按依赖源码修正为数组后通过，非产品构建错误。

## 未覆盖
- 未执行本轮签名/公证/DMG/Windows安装包验收；合并发版时必须用真实打包产物复验迁移路径。
- 未在此轮用真实用户数据试装；所有实测在隔离home/profile/project中。
- 断电/强杀残锁仅保守降级，不宣称自动恢复独立迁移。
