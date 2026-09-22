# PowerPoint 基础接入 · 2026-09-21

原 Demo 要求生成与编辑 PPT 幻灯片，本次新增真实可安装离线包，而非市场占位。
创建标题/正文幻灯片、按真实关系顺序提取文字、按文本run索引编辑；
编辑保留其他ZIP条目内容，不导入后整包重生成。创建图片/图表/动画、视觉排版校验尚缺，
不得把文本核心当完整PPT体验。

验证：
- 先测试模块缺失红，后5项专项通过：真实PPTX、Unicode/转义、顺序、非目标条目内容保持、
  stdio实际包、哈希与目录约束、宏/外部关系/XML实体/嵌套/压缩炸弹拒绝。
- 89980 实际build+隔离app市场安装验收通过；修正依赖后41153再跑29项通过。
- 实际市场确认下载/hash/解包、加密目录授权、同一宿主三shim创建/读/按哈希编辑真实PPTX、
  清除/重连/锁定、悬挂授权失效均已验。原生对话框返回值受控，其余真实。
- configured.png已亲眼检查，已提交本Frame cnode148，保留其他任务的内容节点。
- 无真实模型CLI、Windows或Microsoft PowerPoint视觉验收；未修改正式应用/发布。

依赖核验：
PptxGenJS4.0.1 / JSZip3.10.1 / Saxes5.0.1，独立锁文件与离线bundle，16份实际依赖许可证。
首次npm audit 2high，image-size <=2.0.2 解析器死循环及pptxgenjs聚合；
未用npm建议的pptxgenjs2.2.0降级。override image-size2.0.3后实际audit0，
原始/新审计JSON均保留。上游网页仍说patched none，不将audit0夸大为漏洞修复证明；
当前工具不提供图片输入，打包的PptxGenJS ESM入口只导入JSZip。
官方API与安全公告来源保存于包README。无根依赖改动。

98684全量check通过：3436项/3418通过/18skip/0fail；随后本地目录构建失败：
“同版本包内容已改变，请升级版本：excel@1.0.0”。追溯是上轮Excel归档之后才补README
和生成物空白规范化；未删老包或绕过校验。Excel清单/server升1.0.1，
35544专项11项+目录v1=2/v2=6+实际Excel26项复验通过。
审核再补活动内容关系检查：重命名宏/oleObject部件可绕过文件名检查，
新专项首先Missing expected rejection，改按关系Type及外部Target检查后6专项通过。
PowerPoint同步升1.0.1，不覆盖刚构建的1.0.0。66918最终check/构建/app复验待取终态。

66918退出0：最终全量3437项/3419通过/18skip/0fail，本地目录v1=2/v2=6，
最终PowerPoint1.0.1实际应用29项再次通过且截图眼验。无后台子任务遗留。
