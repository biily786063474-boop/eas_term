# 原生内存与引擎对照交接 · 2026-09-27
用户原问“继续下一步”。固定53f2334a，/private/tmp/eas-first-claude-audit，test/memory-soak-20260926。没有生产src/依赖修改，未提交/合并/发版。

新增结果 docs/verification/native-engine/README.md / assessment.json / native-categories.json / memory-infra-summary.json / pressure-probe-infra-summary.json / engine-ab-summary.json；自包含progress.html已进Frame。原始native/infra*.local*仍在memory-attribution忽略目录，不公开复制。

A/B：同纯Electron样例40轮×3组×2版，交错A B B A A B。37.10.3 Widget2=13；缓存候选43.1.1 Widget2=21、WidgetHost6=10、WidgetHost7=12，共43。各120轮、均无崩溃和所属进程残留。候选SHA256官方校验通过，不是最新44.4.5，不支持为消错升级43.1.1。未验证整产品ABI兼容，候选解压目录清理，原缓存保留。

native混合10轮/12vmmap：main footprint84.3→92.4、GPU142.9→177.2、UI82.8→98.6→GC84.8MiB。GPU dirty增量owned unmapped graphics20.7、PartitionAlloc6.2、IOAccelerator4.34、IOSurface2.6。vmmap无法解析PartitionAlloc zone，非完整调用栈。

Chromium memory-infra两次失败保留：infra renderer ReportEvents超时；infra-browser未排除默认trace类别且累加字符串报Invalid string length。修诊断脚本为browser连接、-*,disabled-by-default-memory-infra、流式文件与64MiB cap，infra-filtered成功4dump/826events/4.4MiB。关键是依据GlobalMemoryDump begin时间窗配phase，不按重映射的periodic_interval id对CDP guid。

最后pressure-probe一轮/6dump模拟moderate/critical仅发测试实例，不填整机物理内存。moderate后GPU transfer cache15.39MiB→1872字节，Skia gpu_resources15.40→0.01，Dawn27.20→11.82；证明部分是可回收缓存。shared_images111.35（基线105.49）没降，UI活跃malloc41.25（基线38.61）仍高。分类有嵌套/共享不能相加；TracingService与缓冲使probe RSS不能作性能基准。未复开压力后组件，未验真实16GB/OS压力/Claude/Windows。

下一步若继续：对象级追踪残余shared_images/native对象；验证真实OS压力通知与恢复，而不是加定时GC、全局强杀或隐藏ERROR。此轮没有依据改生产回收代码。工具新增verify-engine-ab、analyze-native-maps.py、analyze-memory-infra.py、report-native-engine；复用扩展verify-memory-components与verify-widget-lifecycle，不覆盖旧失败证据。
