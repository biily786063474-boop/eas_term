# 原生分类与引擎 A/B · 2026-09-27

用户原问：继续下一步。固定产品源码53f2334a，隔离工作树 `/private/tmp/eas-first-claude-audit`，物理48GiB/macOS arm64。只增诊断脚本和证据；未改项目依赖/生产逻辑，未提交/合并/发版。

## 引擎对照：不支持为消除错误而升级到此候选

同一纯Electron本地HTML+WebGL双webview样例，40轮/组，交错顺序A B B A A B，避免只测一次。每组独立profile、无Eas-Term业务代码/插件/真实模型消息。

| 版本 | 三组Widget类ERROR | Widget2总数 | WidgetHost6总数 | WidgetHost7总数 |
|---|---|---:|---:|---:|
| 37.10.3 | 5 / 3 / 5 | 13 | 0 | 0 |
| 43.1.1 | 21 / 8 / 14 | 21 | 10 | 12 |

两边各120轮均完成，无render-process-gone崩溃，所属已记录进程全部退出。ERROR不是失败循环数，一轮可能多条，不能做独立事件统计。43.1.1未消除错误；不据此断言所有新版本更差。旧37的WidgetHost7未在本轮同版本复现，但**相同文本在43纯引擎样例出现12次**，不能把它再归为必须有插件才触发。

候选来自本机已有缓存，SHA256核对官方SHASUMS256后解压到专属临时目录，未安装到Applications、未改node_modules。43.1.1不是最新稳定版；官方当时最新为44.4.5。本轮仅诊断此缓存候选，**不代表完整产品升级兼容性验收**。校验记录见candidate.json；初次解析SHA文件未处理二进制标记`*`导致StopIteration，修正解析、校验匹配后才运行。

## 原生内存分类：从进程缩小到资源类别

独立混合10轮，baseline/首次加载/自然回收/诊断GC四阶段，3角色共12份vmmap。自然测量结束后才做诊断GC，不作为软件优化。

| 进程 | baseline physical footprint MiB | 自然回收后 | 诊断GC后 |
|---|---:|---:|---:|
| 主进程 | 84.3 | 92.4 | 91.7 |
| GPU | 142.9 | 177.2 | 177.2 |
| 主界面渲染 | 82.8 | 98.6 | 84.8 |

GPU脏页增量主要为 `owned unmapped (graphics)` +20.7MiB、PartitionAlloc +6.2、IOAccelerator graphics +4.34、IOSurface +2.6。UI的V8标签脏页16.8→28.1→14.1MiB，说明一部分是可回收的V8页面；PartitionAlloc53.9→57.9→58.1MiB。主进程PartitionAlloc+2.6MiB/V8+5.1MiB。

vmmap明确警告无法完整检查Chromium PartitionAlloc malloc zone，本轮只利用VM region分类，不把zone表当完整原生分配栈。`Memory Tag 253/255`对应同版本Chromium的PartitionAlloc/V8标签；虚拟地址保留量不是物理占用。vmmap总resident包含共享库驻留，不能与ps RSS直接比较或加总。此次RSS560.4→634.0MiB不能和上轮+88.5的变化当优化收益，因为没有改产品且诊断开销/时序不同。

## Chromium memory-infra：绕过系统zone解析限制

另起隔离实例，一轮真实混合组件，baseline/active/natural/GC四个detailed dump成功导出，4.4MiB/826事件。只读诊断，不附加调用栈，嵌套size/effective_size和共享所有权**不可相加**。

| GPU分类 size MiB | baseline | 打开后 | 关闭自然回收 | GC后 |
|---|---:|---:|---:|---:|
| gpu 总类 |112.83|253.59|154.21|154.21|
| gpu/shared_images |99.30|152.62|109.80|109.80|
| gpu/transfer_cache |0.01|15.39|15.39|15.39|
| gpu/dawn |11.83|78.36|27.20|27.20|
| skia/gpu_resources |0.02|56.92|15.40|15.40|

明确存在缓存/共享图形资源驻留，而不是仅凭RSS推测。主渲染malloc/allocated_objects 38.36→46.38→43.61→41.25MiB；自然阶段分配器还报告约5.4MiB decommittable页面，不能把全部resident都等同于活跃对象。

### 诊断失败原样保留

- `infra`：4次requestMemoryDump成功，但renderer连接ReportEvents导出 `Error: trace completion timeout`，**本轮失败**。
- `infra-browser`：改Browser ReturnAsStream后，未排除默认trace类别且聚合字符串，导出 `RangeError: Invalid string length`，**本轮失败**。
- `infra-filtered`：限定`-*,disabled-by-default-memory-infra`，流式写文件、64MiB上限，成功。不能把前两次快照请求成功说成完整采集成功。

对应JSON和退出证据均保留；两次失败实例也正常清理。分析脚本用GlobalMemoryDump的开始时刻匹配四阶段，不能拿重映射后的periodic_interval id直接对CDP dumpGuid。原始vmmap/trace仅存在*.local*文件中，含本机路径/进程细节，不复制到用户报告或提交；汇总去PID/地址/路径。

## 复现

```sh
node scripts/verify-memory-components.mjs --kinds combined --cycles 10 --tag native --native-map
node scripts/verify-engine-ab.mjs --candidate /absolute/path/to/Electron.app/Contents/MacOS/Electron
python3 scripts/analyze-native-maps.py
node scripts/verify-memory-components.mjs --kinds combined --cycles 1 --tag infra-filtered --memory-dump
python3 scripts/analyze-memory-infra.py
```

固定标签会覆盖旧结果，后续先归档或修改tag/输出；A/B脚本需要先将校验过的43.1.1解压到专属测试路径，README不是自动安装授权。测试源码无产品修改，不需要重跑全产品构建来证明新生产行为。

资料：
- [Electron 43.1.1官方版本](https://releases.electronjs.org/release/v43.1.1)
- [Chromium 138 PageTag定义](https://github.com/chromium/chromium/blob/138.0.7204.251/base/allocator/partition_allocator/src/partition_alloc/page_allocator.h)
- [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)
- [CDP Memory](https://chromedevtools.github.io/devtools-protocol/tot/Memory/)

## 最后补验：模拟通知下的缓存回收（非整机压力）

`pressure-probe`另起实例，一轮混合组件、四阶段快照后，仅通过该实例Browser CDP发送moderate/critical内存压力通知，每阶段观察6秒再dump。不分配填充物理内存，不对正式实例发通知，不改变产品压力准入策略。

| GPU分类 size MiB | 自然阶段 | 主渲染GC后 | moderate后 | critical后 |
|---|---:|---:|---:|---:|
| gpu 总分类 |155.76|155.76|124.98|124.45|
| gpu/transfer_cache |15.39|15.39|约0.0018（1872字节）|该分类未再报告|
| skia/gpu_resources |15.40|15.40|0.01|0.01|
| gpu/dawn |27.20|27.20|11.82|11.82|
| gpu/shared_images |111.35|111.35|111.35|111.35|

主进程/UI共享discardable分类11.97→0.41MiB（是共享归属，不能算两份）。**本轮实证部分是能够响应引擎压力通知回收的缓存**，不是永久泄漏；但shared_images较该轮基线105.49仍多5.86MiB，UI活跃malloc对象41.25较基线38.61多2.64MiB，剩余归属未证明全部正常。

注意transfer_cache与Skia等有嵌套/所有权关系，不能相加成“节省30MiB物理内存”。Memory-infra启用后多出TracingService进程，并有trace缓冲与测量开销；该轮RSS601.5→780.9不能拿来宣称产品回退或优化率。分类probe用于归因，**不是性能基准**。本轮没有重新打开组件验证压力后的复杂交互，不据此改生产内存通知逻辑。

```sh
node scripts/verify-memory-components.mjs --kinds combined --cycles 1 --tag pressure-probe --memory-dump --pressure-probe
python3 scripts/analyze-memory-infra.py pressure-probe
```

## 决策与还未完成

- 不为消除此日志升级到43.1.1；保留最小复现，后续候选引擎可复用，而非重走业务排查。
- 不加定时GC、不强杀插件、不隐藏ERROR、不强制关闭GPU。缓存自然驻留本身不足以证明需要产品补丁。
- 可以确认引擎有响应模拟moderate通知的回收能力；尚未验证本软件在实体16GB、真实OS压力下的通知触发、恢复交互和持续性能。
- 仍需对象级追踪残余shared_images及少量native对象，尤其长时间持续增长的反例；没有“零泄漏”结论。
- 本轮最终所有隔离实例、已记录后代均退出，候选解压目录已删除，原缓存保留；2次失败采集保留。没有新产品代码可宣称修复。

精度复核：moderate后的transfer cache并非严格0，而是1872字节（约1.8KiB）；之前两位小数显示0.00。最终断言改为小于4KiB，保留近零但不宣称绝对零。critical阶段该节点未报告，不把缺项自动等同于实测0。
