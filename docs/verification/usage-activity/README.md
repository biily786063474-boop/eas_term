# 用量热力图与本地行为统计 · 2026-09-28

用户已确认：Token / 软件活跃可切换，默认Token。基于main92570390，独立工作树/private/tmp/eas-usage-activity-20260928。

## 已落地
- 用量总览下方近90本地日热力图：悬停/聚焦显示日期与值，未知、真实0、部分记录有区分；沿用现有设计变量，深浅模式及减少动态效果。
- Eas-Term层的活跃/当前连续/最长连续天数、AI会话与项目数量、常用功能及插件打开/AI工具调用排行。不是CLI Skill统计，不承诺统计所有鼠标事件或在线时长。
- 功能入口按触发计数，含取消/失败；内容/组件新增、本地AI请求启动和插件面板成功打开/宿主shim工具成功回执为真实采集入口。面板内部RPC不计数，防后台刷新伪活跃。
- 本地独立日账本，90天、每日128插件、4MB读取/写入上限、1秒合批和退出flush、原子写入。损坏文件保留并禁写，相应指标全未知；不扫描旧聊天，不上传个人活动或正文/命令/密钥。
- 原总览/趋势/项目展开/阶段/周月报/CSV未替换；复用原15秒前台刷新时钟，关闭/隐藏/失焦后停止轮询，没有新增持续计时器。

## 验证
- Node22.23.3、Electron42.11.8；`npm run check` 3951项：3932通过、19跳过、0失败；`npm run build`成功。
- 新增activity测试13项（含日期/DST/未知/连续、损坏/原子写入/失败、采集接线）；远端插件网关none/oauth/bearer三种真实本地fixture测试均过，断言统计6次成功AI工具调用，不计连接和发现。
- `node scripts/verify-usage-activity.mjs`及USAGE_FIXTURE=empty/corrupt成功；实际Electron renderer→preload→main，匿名遥测关闭仍记本地canvas动作，非法事件和渲染伪造chat被拒。
- USAGE_REUSE_PROFILE=<seeded-result.json.profile> USAGE_FIXTURE=restored再次启动实际应用，旧计数存在且新事件继续落盘。
- 已亲眼查看最终深浅热力图、行为列表、空数据和损坏账本截图。所有图中均为合成测试数据，不是用户用量。
- 原`verify-usage-project-expansion.mjs`真实UI回归通过：总览不变、两项目独立分页、时段重置、键盘、三行明细滚动、展开收起。仅临时夹具将前两条记录放到今天，保证凌晨时两项目均有今日数据；断言未放宽。截图另存original-project-regression，不覆盖旧证据。
- 独立代码审查最终无Critical/Important；新插件计数不包括面板自动刷新；禁用账本后的日格、轮数、会话数、项目数及空态全部未知。

## 失败尝试，未隐藏
- 首轮全量3失败：pluginRemoteHost的AST测试执行环境漏注入新capturePluginActivity函数。注入真实ActivityBook并增加计数断言后通过，不改变产品去迁就测试。
- 第二轮2失败：未修改的codexCapabilityLauncher测试5秒内夹具未写pid；定向6/6通过，随后同源码完整重跑3932/19/0。未放宽超时或改业务。
- 原项目UI脚本首次在凌晨因某项目今天无记录，旧脚本find项目返回undefined；仅修临时fixture让两项目今天都有记录。另一次旧Electron包装器退出与端口释放有竞态，9452绑定失败；改验证脚本直接启动拥有的Electron进程并用独立9591端口后通过。仅结束本次验证进程。
- 本轮最初使用TS参数属性触发Node22 strip-only不支持，改为显式字段赋值后通过。

## 边界/状态
不做Windows真机UI、长期90天真实积累或付费CLI调用验证。开发分支已验证，未提交/合并/发版，未安装替换正式app。根工作树原有脏改动未碰。截图副本放根docs/verification/usage-activity供Frame预览。
