# Demo 插件清单接入核验（进行中）

日期：2026-09-18。用户确认按原 Demo 32 项选择，不另选插件凑数。
来源：`docs/prototype/2026-09-15-plugin-market-full.html`。本文件是工程核验记录，不是已交付清单。

## 已确认方向

- 市场目录与插件包独立发布；安装/升级需用户确认，不随浏览静默执行代码。
- 保留原分类与插件身份；实际描述只能承诺已验证能力。
- 官方 MCP 优先；无官方 MCP 时核验官方 API 或合规开源实现及许可证。
- 尚未验证的条目不标为可用；无凭证不冒充通过账号级 E2E。
- 不修改用户正在使用的正式应用，不发布线上目录占位条目。

## 逐项台账

|分类|插件|Demo 目标（不是实现证明）|核验状态|
|---|---|---|---|
|生活出行|番茄钟|专注计时，可让 AI 帮你开始|已有市场包；真实 stdio start/done/重复完成回归通过，实际模型未验|
|办公文档|看板|项目待办三栏看板|已有内置及市场包；真实 stdio 增/移/查/删回归通过，实际模型未验|
|开发工具|电脑视野|让 AI 看你的屏幕并代操作|已有内置实现；跨平台打包及生命周期验收待核对|
|办公文档|Word 文档|读写 Word，排版、生成、修订|原创离线候选：格式段落/矩形表格创建、顶层文本读取、简单段落跟踪修订；隔离应用26项通过；复杂排版编辑/真实Word渲染/模型CLI/Windows未验，未上架|
|办公文档|Excel 表格|读写 Excel，公式、透视、图表|基础实包read/create/update与三shim26项已验；公式只写不算，透视/图表未实现，未发布|
|办公文档|PowerPoint|生成与编辑 PPT 幻灯片|基础实包创建/读/编辑文字与三shim29项已验；图表/图片/动画编辑、视觉效果未验，未发布|
|办公文档|Google 文档|Docs / Sheets / Slides 读写|待核验上游来源、许可、授权、实际工具及平台兼容性|
|办公文档|Notion|读写 Notion 页面与数据库|官方远程 MCP + OAuth；宿主接入及真实账号验证待做|
|生活出行|高德地图|路线规划、周边搜索、地理编码|stdio实包地理编码/周边/步行驾车路线，密文Key与三shim21项已验；真实账号/供应商数据/TLS/模型CLI/Windows未验|
|生活出行|天气|查实时天气与未来预报|高德stdio实包、用户Key统一密文配置，隔离三shim实况/预报15项已验；中国支持区域，真实账号/TLS/模型CLI/Windows未验|
|生活出行|Google 日历|读写日程、创建提醒|待核验上游来源、许可、授权、实际工具及平台兼容性|
|生活出行|12306 火车票|查余票、时刻、正晚点|待核验上游来源、许可、授权、实际工具及平台兼容性|
|开发工具|GitHub|仓库、Issue、PR、CI|官方远程Bearer候选与统一加密配置已接；隔离网络fixture13项通过，真实账号/模型CLI/Windows未验，未上架|
|开发工具|本地文件|读写你授权的目录|自写包已打通市场安装、加密目录授权、三 shim 实际写入、锁定与迟到确认拒绝；Windows/实际模型未验|
|开发工具|数据库|查 Postgres / MySQL / SQLite|待核验上游来源、许可、授权、实际工具及平台兼容性|
|开发工具|Sentry|查线上报错与告警|待核验上游来源、许可、授权、实际工具及平台兼容性|
|通讯协作|Slack|读写 Slack 消息|官方MCP需固定注册app及Marketplace/内部准入；不支持DCR，PKCE可用但宿主适配与真实账号未验|
|通讯协作|企业微信|消息、待办、审批|待核验上游来源、许可、授权、实际工具及平台兼容性|
|通讯协作|钉钉|消息、待办、审批|待核验上游来源、许可、授权、实际工具及平台兼容性|
|通讯协作|Gmail|读写与整理邮件|待核验上游来源、许可、授权、实际工具及平台兼容性|
|自媒体|微信公众号|发文章、管粉丝、看阅读数据|待核验上游来源、许可、授权、实际工具及平台兼容性|
|自媒体|微博|发博、读评论、查热搜|待核验上游来源、许可、授权、实际工具及平台兼容性|
|自媒体|B站|查视频数据、评论、粉丝|待核验上游来源、许可、授权、实际工具及平台兼容性|
|自媒体|抖音|查作品数据与评论（开放平台）|待核验上游来源、许可、授权、实际工具及平台兼容性|
|自媒体|小红书|查笔记数据（接口有限）|待核验上游来源、许可、授权、实际工具及平台兼容性|
|设计创意|Figma|读写设计稿与组件|官方MCP只允许Catalog客户端，新宿主需waitlist准入；未获批准，不冒用其他客户端身份|
|设计创意|Canva|生成、评审、编辑设计|官方远程 MCP；独立宿主回调 URI 需申请放行，逐用户授权；不可借用其他客户端身份|
|数据搜索|网页抓取|把网页内容抓成可读文本|实包已接默认v2构建；真实市场安装及三shim抓取通过；公网因非公开DNS被拒，系统代理/Windows/真实模型未验|
|自媒体|知乎|搜索、读取与回答|待核验上游来源、许可、授权、实际工具及平台兼容性|
|数据搜索|维基百科|查词条、摘要|待核验上游来源、许可、授权、实际工具及平台兼容性|
|文件存储|Google Drive|文件、Docs、Sheets、Slides|待核验上游来源、许可、授权、实际工具及平台兼容性|
|文件存储|阿里云盘|读写网盘文件|待核验上游来源、许可、授权、实际工具及平台兼容性|

## 代码证据与缺口

- `src/main/pluginRegistry.ts`：schema 1 目录只支持下载包元数据，（初次核验时的缺口，现已由requirements门禁及pluginCatalog v2补上；线上目录尚未切换）。
- `src/main/pluginManifest.ts`：现支持 stdio/remote-none/remote-oauth 清单；stdio 统一配置/目录授权已接；remote Bearer与动态OAuth已接线并有候选；真实供应商账号/兼容性仍待验。
- `src/main/mcpClient.ts` 与 `pluginHost.ts`：已接 stdio/remote 共享宿主并做真实shim/隔离测试；远程正式 capability 尚未公布，实际模型与真实账号验证不能由这些测试代替。
- `scripts/build-plugin-registry.mjs`：默认构建为 pomodoro、board、local-files、web-fetch、excel、powerpoint、weather、amap；v1 仅前两项，v2 八项，新增目录尚未发布。
- 分发热更新已有基础，但原 Demo 的远程连接、授权和配置不能靠扩大 PLUGINS 数组完成。

## 已查看官方来源

- Notion：https://developers.notion.com/guides/mcp/overview （远程 MCP，OAuth，按当前用户权限读写）
- Canva：https://www.canva.dev/docs/mcp/ （回调 URI allowlist 申请、逐用户授权、CIMD/DCR；支持 stdio 代理路线）
- GitHub：https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md
- Figma：https://developers.figma.com/docs/figma-mcp-server/

## 待定实现路线

1. 受审查、锁版本的 stdio 连接器包复用现有宿主；需明确凭证存储、授权回调与生命周期，不能依赖 npx latest 无校验下载。
2. 宿主原生远程 MCP + 通用授权/配置层；一次客户端升级，后续兼容插件独立上架。
3. 直接转交各 CLI 自己安装：体验与配置会分裂，不作为统一市场默认路线。

当前阶段：宿主、授权基础与账号控件已实现并做隔离验证；32真实连接器和账号仍未验收，未发布。

## 官方来源增量核验（2026-09-18，非真实账号验收）

- Google Docs / Calendar / Gmail / Drive：官方现有Workspace MCP配置文档要求Google Cloud项目和OAuth配置；各服务scope不同，不能把文档列出的Calendar只读能力宣传成任意写日程。来源：https://developers.google.com/workspace/guides/configure-mcp-servers 。本项目尚无已注册客户端或账号调用证据。
- 高德地图：官方MCP快速接入明确需要AMAP_MAPS_API_KEY。来源：https://developer.amap.com/api/mcp-server/gettingstarted 。正文抓取失败，仅检索摘要确认key要求，完整传输/商用条件待核。
- Sentry：官方仓库 https://github.com/getsentry/sentry-mcp 与授权安全说明 https://github.com/getsentry/sentry-mcp/blob/main/docs/security.md ，已有远程OAuth实现；本项目未完成账号授权与工具调用。
- Slack：官方MCP仅允许已发布Marketplace应用及内部应用，未列出应用不能使用；需要应用OAuth配置及权限。来源：https://docs.slack.dev/ai/slack-mcp-server 。不能拿其他客户端身份绕过准入，PKCE细节仍需逐项核验。
- B站：官方入驻流程包括账号注册、资质认证、应用接入、集成开发。来源：https://open.bilibili.com/ 。本轮没有申请资质或创建应用。
- 抖音：上线需要平台审核；来源：https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/app-mgmt/pub-app 。没有代用户提交企业资料或审核。
- 小红书：已核到的 https://open.xiaohongshu.com/ 是电商开放平台，不能据此宣称支持Demo里的通用笔记数据。相应条目仍待能力核验，不接入Cookie抓取替代官方授权。
- 微博：官方CLI要求开发者认证、体验服务或正式服务开通，再OAuth登录。来源：https://open.weibo.com/cli/quickstart 。未执行远程安装脚本、未订购服务。
- 知乎：官方组织仓库 https://github.com/zhihu/zhihu-mediacloud-uploader/blob/main/references/auth-info.md 使用OpenAPI app key/secret；媒体上传不等同Demo全部搜索/回答能力，其余仍待核验。

以上是公开接入条件核验；不是已获许可、已完成连接器分发或账号E2E。其余条目保留原“待核验”，不推断不存在官方能力。

### 本地/数据库候选安全检查（尚未选定或安装）

- Word候选：https://github.com/GongRzhe/Office-Word-MCP-Server ，官方仓库页面标明2026-03-03已归档（MIT），需要审查Python运行时、具体版本/许可证与目录权限；不是微软官方MCP。
- Excel候选：https://github.com/haris-musa/excel-mcp-server ，需要同样的锁版、跨平台和文件权限验证；不能以README支持Excel推断所有公式/透视/图表可用。
- PowerPoint候选：https://github.com/GongRzhe/Office-PowerPoint-MCP-Server ，检索结果标记仓库已归档，不能不经维护/安全评审直接打包。
- 本地文件候选：https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem ，需要在本项目的用户确认目录边界下锁版封装，不能把整个home默认授权。
- 数据库候选DBHub存在官方安全公告：https://github.com/bytebase/dbhub/security/advisories/GHSA-mwwr-p57h-56pf 。公告列出<0.22.6的readonly模式不能真正阻止写入，0.22.6修复；旧版或“只检测SQL首词”的防护禁止采纳。锁定修复版本也不替代数据库账号最小权限和实际只读验证。当前未安装该候选。

## 维基百科实包增量（未上架）

`plugins-store/wikipedia` 新增自写零第三方运行依赖的 stdio 连接器：中英文搜索与正文导言两个只读工具，结果含来源/许可链接，不复制第三方MCP代码，不声称官方背书。官方接口依据：REST search/page（https://www.mediawiki.org/wiki/API:REST_API/Reference）、TextExtracts（https://www.mediawiki.org/wiki/Extension:TextExtracts）；只按需查询，不批量抓取，User-Agent按 https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy 标识；内容用途/许可遵循来源声明，见 https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy 。本段是接口说明与工程记录，不是法律意见或平台批准证明。

已实际：打包、解包、清单解析、宿主McpClient握手/列工具/调用；协议及格式测试通过。公开查询实测返回错误“DNS 包含非公开地址”，本机en.wikipedia.org解析为198.18.0.76（Clash fake-IP），没有绕过私网检测。证据`wikipedia-candidate.json`记录livePassed=false。

仍缺：系统PAC/代理适配（当前候选仅直连）、真实公开查询成功、跨平台与真实模型三CLI验证；因此默认目录仍只有两已存在包，不能把源代码候选算成第三个已可用插件。

## 本地文件纵向证据（2026-09-18，未生产发布）

自写`plugins-store/local-files`，不冒充官方filesystem MCP。实现授权目录list/read/write，文本1MB/列表500项，覆盖SHA256、symlink/硬链/路径越界拒绝。实际隔离app已完成native-dialog适配→真实safeStorage→真实共享宿主→Claude/Codex/OMP各自真实shim子进程→临时文件写入，以及锁定关闭后拒绝写入（12检查通过）。后续市场安装完整验证结果见`local-files/result.json`；未验证真实模型CLI/native picker手动交互/Windows/生产HTTPS，不能宣称32全就绪。

## 2026-09-18 补核：天气与钉钉的接入条件

- Open-Meteo 免费接口仅限非商业使用，商业调用需要订阅及 customer-api 的 API key；不可因免登录评估接口可调用，就默认塞进商业软件。来源：https://open-meteo.com/en/pricing 。未订阅，未选择其为正式上游。
- MET Norway Locationforecast 提供按经纬度的全球预报，需要标识应用的 User-Agent、缓存/过期处理、坐标最多四位小数及署名；这是预报，不冒充实测当前天气。来源：https://api.met.no/doc/locationforecast/HowTO 、https://api.met.no/doc/TermsOfService 。聚合超过每秒20请求需特殊约定，不能将单机实验视为不限量市场分发许可。本轮 DNS 探测 api.met.no=198.18.0.91、api.open-meteo.com=198.18.0.92，公开地址守卫仍会拒绝；未关闭守卫或修改代理。
- 钉钉官方创建应用流程要求开发组织权限和 Client ID/Client Secret；机器人发送消息与审批工作流是不同接入范围，不能用一个 webhook 冒充 Demo 全部能力。来源：https://open-dingtalk.github.io/developerpedia/docs/explore/tutorials/stream/event/python/create-app/ 、https://open.dingtalk.com/tutorial/ 。本轮无应用创建/凭证授权/实际调用。
- 企业微信、阿里云盘、12306 的本次定向检索未拿到足以确认完整接入的官方接口正文；维持未核验，不把搜索不到推断成没有API。

**归因边界**：Word/Excel/PPT、数据库、网页抓取等尚有自主工程工作，不是“全部只等用户账号”；OAuth 应用注册/审核和用户登录另列外部条件。当前三项有本轮真实业务证据，绝不是32项完成。当前市场截图是隔离单包目录，不是正式市场32项已上线的截图。

## GitHub候选与Bearer接线

新增 plugins-store/github 原创连接描述包，固定官方远程端点 https://api.githubcopilot.com/mcp/ ，凭证由用户在软件配置控件提供，secret引用不含值。依据：https://github.com/github/github-mcp-server/blob/main/README.md （端点与PAT支持）、https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md （宿主自行获取访问令牌、组织政策、DCR尚不支持）。不分发上游服务代码、不冒充已注册OAuth客户端。

宿主Bearer配置scope/租约/精确资源发送已接；模拟HTTP服务通过三真实shim共享连接、无重放与锁定关闭，包真实打包验证通过。这不是GitHub上游账号成功调用。未加入默认构建目录、未广告auth.bearer/mcp.remote；连接测试与清除配置UI已统一接线，本地文件实际隔离应用验收通过；Bearer实际应用保存到远程连接已用自有网络fixture跑通13项（verify-bearer-plugin）；DNS/PAC/HTTPS拨号与原生确认为测试适配，非真实TLS或GitHub账号证明。真实账号/模型/Windows仍待验收。

## Word独立实包起步（2026-09-18，仍未上架）
新增原创Word候选，锁docx9.7.1/jszip3.10.1/xml-js1.6.11及传递依赖；专属依赖树audit 0已知漏洞，含22份许可。官方资料见包README；生成bundle在包内，不要求终端运行npm或系统Python。初次许可收集因hash.js无独立LICENSE失败，查到README完整许可后显式提取，isarray同理，没有跳过缺失许可。
实际pack→解包→真实McpClient子进程已跑通DOCX创建/读取/跟踪修订，旧hash/越界/软链拒绝。基础段落排版支持标题/粗体/斜体，读取只含正文顶层段落；已有修订及复杂结构拒绝改写。不是完整Word编辑器，不将三工具替代Demo全部读写排版修订范围；隔离实际应用市场安装→加密目录授权→三shim真实生成DOCX及锁定/清除已通过23项；Word渲染/三模型CLI/Windows待验收。不会增加默认市场已验证可用数量。

### 2026-09-18 Word 矩形表格增量
Word 候选 createDocument/word_create 支持追加矩形文本表格；readDocument/word_read 单列顶层表格文本，不改变段落索引；简单段落修订保持原表格。限50表、200行/50列、总5000单元格；合并/嵌套表格标记complex，不伪称还原复杂布局或支持单元格编辑。库源码变更后重建离线bundle；不加入默认目录。官方Table/TableCell文档来源记入包README。

### 2026-09-18 动态 OAuth 纵向与两份供应商候选
显式动态清单已串入真实工厂、UI和共享宿主；实际隔离Electron完成DCR/PKCE/loopback/系统密文/三shim调用/锁定阻断，13项通过，固定OAuth兼容11项通过。自有fixture网络与浏览器适配，不是供应商登录。截图眼验修正“已连通”与“尚未测试”并存。`plugins-store/notion` / `sentry` 保存官方公开端点、严格单origin与动态能力要求，真实打包可生成v2候选，但不进默认市场。公开PRM未取得、Notion实际iss回调兼容及两家真实账号待验；详见oauth/providers-2026-09-18.md。不能由包数量推定可用数量。

### 用户优先级调整与网页抓取落地
用户明确账号由最终用户安装后登录，先补剩余插件，不等个人账号再写工程。区分工程接入/待用户授权/真实账号验证/平台审核。网页抓取已实现无账号stdio静态HTML/文本读取，离线htmlparser2与7份许可，实际市场安装到三shim调用已验；加入默认本地v2构建（第4包），尚未生产发布。公网DNS被拒证据与限制见web-fetch/implementation.md。

### 2026-09-21 办公文档新增实包
Excel 基础（cd1d084）：read/create/update真实XLSX，三shim26项已验；公式仅写入不计算，
图表/透视等未实现。PowerPoint 本轮：create/read/edit真实文本PPTX，三shim29项已验，
按真实幻灯片关系顺序，编辑保持非目标ZIP条目内容；复杂视觉能力/模型CLI/Windows未验。
默认本地v2现含6实包，不是32项已完整接入、不等于生产已上架。

### 2026-09-21 官方客户端准入补核（不是用户登录即可解决）
- Figma 官方 MCP 介绍明确只允许 MCP Catalog 中的客户端，新客户端需加入 waitlist。不能复用 Claude/Codex 身份或把 PAT 当成 MCP OAuth。来源：https://developers.figma.com/docs/figma-mcp-server/ 。尚未提交入驻、未获批准；不生成假可安装连接条目。
- Slack 官方 MCP 支持 Streamable HTTP `https://mcp.slack.com/mcp`，不支持 DCR；客户端必须关联固定注册 app ID，仅 Marketplace 已发布应用或内部应用可用，unlisted 不可用。来源：https://docs.slack.dev/ai/slack-mcp-server/ 。
- Slack 支持显式启用 PKCE 的公共客户端，启用不可自行撤销；桌面回调不可请求 bot scopes，refresh token 期限为30天。来源：https://docs.slack.dev/authentication/using-pkce/ 。不能据旧概览一概说桌面必须内嵌 client_secret，也不能直接复用当前通用DCR模板；随机loopback/iss/token格式仍须专项验证。本轮未改应用注册配置、未发送任何真实消息。
- 以上属于平台客户端准入/授权适配，不是让最终用户登录就能消除的条件。其余无需账号的工程工作仍应继续，不以这两项代表全项目阻塞。

### Excel父进程适配增量 2026-09-21
8项真实测试进程检查及6项真实Go引擎业务链检查通过（worker.log/worker-result.json），含校验binary、空env、超时/取消和输出限额。仍是引擎接线准备，原插件不变，未补齐原定Excel功能，不新增完成条目。create/read、多系列图表、安全透视目的地、许可证/打包、MCP及应用/Excel验收仍待做。

Excel 2026-09-21增量：引擎create/read已实现并经真实进程8项流程检查；读取calculated:false、日期数值保留原始序列。Go/Node各9测试通过。证据io-worker.log；插件入口、包和实际Excel验收尚未完成，不增可用插件数。

2026-09-21用户第1项增量：多series、等长向量、合并保护与旧公式清除、透视声明目的区域防覆盖已实现并通过Go14/Node9/真实worker8检查（mutation.log）。刷新扩张及图表Name strRef语义尚须处理/眼验；插件未接线，不增加完成数。

## 2026-09-22 生产状态更新

以上逐项台账为历史开发阶段状态，不是当前生产计数。WPS三件套已完成本机真实往返，Excel原生六工具（含公式计算/图表/透视）已取代此前仅写公式的候选；三件套与本地文件已真实发布到v2目录，原番茄钟/看板保留，共6项。公开包和目录哈希、生产服务前后比对通过。正式0.4.103仍v1，宿主合入发版与生产UI贯通尚待做。Notion/Sentry仅公开供应商元数据验证增加，账号业务仍未完成。详情 office-publish/README.md、wps-office/README.md；不代表原32项全部完成。
