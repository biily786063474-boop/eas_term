# 2026-09-13 本机内存口径校对（未通过）

- 48 GiB / Darwin 25.5 / Apple Silicon，本轮只读系统读数，没有压力注入或关闭用户进程。
- 07:01:12 top PhysMem 43G used / 4421M unused；不能直接替换现有不计文件缓存的估计。
- 07:01:46 vm_stat 现有公式输出34.2256 GiB；同时存在 Pages tag-storage 98304页=1.5 GiB。
- Activity Monitor UI 读取35.50 GB、另次35.46 GB；截图分项App31.06 GB、wired3.00GB、compressed342.3MB，分项与总量亦存在未解释差额。非同步采样，不能把差额直接认定tag storage。
- 本地SDK mach/vm_statistics.h rev3表明tag storage还包括non-tag pageable/wired/free，不能未经核对直接把1.5 GiB整块相加，否则可能重复计数。
- 未修改公式，未将memoryAdmissionVerified翻为true。需要进一步核对系统计数关系和同步多样本误差，才能安全开启内存准入；这不是需要用户提供密码或确认的阻塞。
- Apple源码定位入口：https://github.com/apple-oss-distributions/top 与本机Xcode SDK mach/vm_statistics.h。

下一工程动作：采样输出补充原始分项与测量口径，使用同步区间对照系统读数；制定允许误差与保守上界。在此之前不以未经验证的百分比放行真实资源预算。当前生产80/50仍未启用。

## 07:05 续：有界连续采样
新增可复跑只读 collect.mjs，采5次、每次vm_stat最长1秒、每次间隔1秒，输出UTC采样前后时间、总字节、页大小及全部相关分项。不加负载、不purge、不停止任何用户进程。series.jsonl 实测估计范围34.3627–34.8995GiB。随后Activity Monitor显示已使用35.46GB、App30.91GB/wired3.12GB/compressed342.3MB；仍不是同一瞬间，不能宣布精确校准通过。
保留现有估计公式及未验证标记，未做任何经验常数补偿。内存准入和80/50生产调度仍未启用。

## 2026-09-13 · 真机控制器/模式验证与内存差额定位
隔离main97804实际设置读CPU13.4%、15核、内存36.3/48；控制器缓存链路运行。随后新构建main98860，普通80/节能50模式按钮实测切换成功，隔离runtime-state.json为eco，未触及真实用户数据。104定向+typecheck/build通过；跨整个app重启的模式回显尚未复验（停止名单此前已验）。
运行模式主进程IPC仅主窗口主frame可改；持久化成功才切manager，不清停止名单；坏文件不覆盖。UI明确“目标阈值，不代表限流已启用”。
内存新证据：sysctl hw.memsize=51539607552、hw.memsize_usable=50583420928，差额956186624字节。Apple XNU bsd/kern/kern_mib.c 974-984解释macOS实际物理内存与扣除carveouts的max_mem不同。旧公式只加VM匿名/锁定/压缩，遗漏物理保留容量。parseMacMemory新增usable校验并加total-usable（测量值不是经验常数，不盲加tag-storage全部区域）；reader读取固定sysctl键。新增红绿测试4/4，真实reader输出36.5998GiB，memoryAdmissionVerified仍false。该最新修正未构建/应用内复验，不宣布全面校准通过。
下一步：重建并校对修正后的读数，完成同一控制器的真实任务准入和队列UI；不要停在模式设置。Goal保持active，无需用户再喊继续。

### 压力值协议核实（2026-09-13）
只读 Apple XNU `bsd/kern/kern_memorystatus_notify.c` 的 `sysctl_memorystatus_vm_pressure_level`：返回的是 `convert_internal_pressure_level_to_dispatch_level` 转换值，不是 kern_memorystatus.h 的 kMemorystatusLevelNormal=0 那套枚举。转换到 NOTE_MEMORYSTATUS_PRESSURE_*；本机 SDK dispatch/source.h 255–257 定义 NORMAL=0x01、WARN=0x02、CRITICAL=0x04。故1/2/4分别正常/警告/严重，未知不能当正常。来源：https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus_notify.c 。源码暂存 /tmp/eas-memory-notify.c，本机读取无权限提升。

### 修正后同窗口读数（2026-09-13 14:45 UTC）
carveout-idle-series.jsonl五次35.729–36.335 GiB；同采样窗口Activity Monitor AX显示36.07 GB，压力正常、交换0。先前并行构建窗口carveout-series变动35.756–38.161，与编译负载同时发生，不能拿单个事后UI值要求精确相等。修正后数量级及系统总计已接近，但这不是全负载/全mac机型校准，更不是80/50硬上限证据。生产reader实际返回36.364GiB/normal，仍verified:false。
