# 插件市场统一接入进行中
用户确认按原 Demo 32 项、独立热更新、统一补齐远程 MCP/授权/兼容性，并在设计书面确认后说“继续”。无需再反复询问是否开始。
工作区 .worktrees/release-0.4.102，现分支 feat/plugin-market-unified-20260918；主工作区不动。设计+台账已提交 5bd9c0d。
计划 docs/superpowers/plans/2026-09-18-plugin-compatibility.md 为阶段 A。已写 requirements 纯校验、目录保留字段、下载/commit 两道检查和包内一致性；相关21测试+typecheck通过（Node既有MODULE_TYPELESS警告）。尚未隔离应用眼验，不宣称完成。build/full tests日志 /tmp/eas-plugin-unified-{build,tests}.log。
余下：安装边界副作用测试、打包器保留 requirements、隔离应用验收；v2目录、远程传输、统一安全凭证/OAuth/配置、32项上游核验与真实接入、三CLI调用、独立发布演练。未发布、未修改正式app/用户凭证；remote/oauth能力没有提前宣称支持。
注意旧installCommit先删旧包再搬新包，现有更新不具备故障回退保证；后续按设计修，不能宣称已有原子回退。

本轮最终验证：npm run build 成功；npm test 3265项，3247通过/18跳过/0失败。全测试没有替代安装器副作用与隔离UI验收。功能改动尚未提交，只有先前设计提交。下一步先补安装器边界集成测试及打包器兼容要求传递，再做隔离验收与后续远程接入。

## 2026-09-18 03:00 后续
用户要求后台任务必须挂可见轮询汇报节点。已用 canvas_open_html 打开 docs/verification/plugin-marketplace/progress.html（所属 frame-9-pd0nj，node cnode-81-o6swz）；scripts/plugin-progress.py 包装命令，每5秒采样真实退出码/耗时/尾日志并原子重写HTML，运行页刷新、结束停止、采样过期告警；不是后台自主agent。后续每次长任务继续用此节点，不新开多个。
打包器新增requirements验证/透传和schema2显式开关，旧目录默认拒绝新要求包；新增IPC安装边界3测试通过，涵盖不兼容无下载、commit重验不动旧安装、legacy正常落盘。测试夹具首次缺process.env/URL导致失败，已补齐，仅修测试环境。完整npm run check正通过监测器运行；UI未验、远程/OAuth/32项仍待做。

本轮终态：npm run check 3269项，3251通过/18跳过/0失败。build通过，scripts/verify-plugin-compatibility.mjs隔离UI三项通过，截图已亲眼查看：完整市场显示版本999.0.0错误，没下载包。首次验收错走右键插入面板超时，改为更多→插件→完整市场后通过，没有修改产品逻辑。仅不兼容拒绝已UI验证，正常安装/commit副作用为隔离IPC测试，不混称全安装UI已验。监测节点已标本轮结束，当前无后台命令。

## 03:12 继续远程基础
新增endpointPolicy与remoteClient；官方SDK锁1.30.0（ignore-scripts安装）。本地真实HTTP测试握手、工具列表/调用、503不重复写、关闭后拒绝调用；并发connect红测后已合并。URL与DNS4测试通过。尚未生产接线，fetch必须注入，DNS策略本身不能防重绑定；未完成代理/DNS pinning/OAuth。npm audit报告18告警（critical为tar）；逐节点对照HEAD lock，所有告警节点及版本在本轮之前已存在，不代表安全或已修。未跑force升级。

03:12轮终态：npm run check 3274项，3256通过/18跳过/0失败，build通过。远程协议基础未接宿主，不构成真实供应商验证。进度节点明确后台检查已结束。下一步应继续生产安全网络适配（系统代理与DNS rebinding边界）、授权/凭证与生命周期，不重复清单/设计确认。

## 03:19 网络适配推进
新增networkPlan、pinnedFetch、httpsSender、pluginNetwork及测试。固定IP拨号+原域名SNI/Host；系统DIRECT/PROXY/HTTPS CONNECT，不支持SOCKS不回落直连；混合私网DNS拒绝；禁止自动跳转和Cookie/Proxy-Authorization/Host伪造；1MB请求/16MB响应流；真实TLS+CONNECT测试包含自签证书需显式测试CA、未信任证书拒绝、超大流拒绝。代理库精确锁7.0.6。
第一次typecheck仅测试类型报错（TLSSocket.servername含null，CONNECT socket为Duplex非Socket），已修测试类型。当前完整check/build在progress节点运行。
重要未完成边界：生产宿主未注册、OAuth/凭证未做；DNS/PAC解析阶段与代理CONNECT前的绝对超时还需补（现有60秒是socket idle，不可当总超时）；Clash fake-IP地址按保留地址拒绝，未实现安全的真实DNS解析替代，不能放宽私网绕过。三CLI真实服务未验。

本轮check/build最终通过：3281项，3263通过/18跳过/0失败；后台命令已结束。网络层仍有前述未完成边界，不是整体完成。

## 继续：DNS/PAC 等待边界
新增两项红测复现解析等待时取消挂起、无解析期限；实现默认15秒准备期限及立即取消，迟到结果不能触发send。专项5测试通过，typecheck通过。OS DNS/PAC底层API本身不可取消，只脱离等待，不能宣称底层任务已终止。CONNECT建立前绝对超时/套接字清理、OAuth回调仍待实现；本轮未触及正式宿主或凭证。
完整check/build使用同一个progress节点运行，不能在结果前宣称通过。
随后补CONNECT响应头期限：读锁定代理库源码确认opts.signal进入net/tls.connect；真实无响应代理红测复现挂起，添加默认60秒头部期限并把取消传到底层socket，测试验证连接实际关闭后转绿。收到响应头即撤销该期限，保留流空闲限制。专项2项和typecheck通过，包含原有TLS/SNI/固定IP/16MB回归。已重新启动完整check/build覆盖这次增量。OAuth本轮尚未开始，不宣称完成。
本轮最终npm run check与npm run build退出码0；网络准备/响应头超时增量仅本地网络测试，未做真实供应商及UI验收。后台回归已结束。

## OAuth回调基础（继续）
新增oauthCallback.ts及3项本地HTTP集成测试：随机loopback端口/路径，state与S256 challenge生成，精确Host/GET/path、重复参数、state、iss校验；单次消费防重放；取消/180秒默认超时关闭所属socket。测试覆盖错误state不消费、issuer混淆/重复参数拒绝、成功返回绑定resource/issuer/redirect/verifier、重放拒绝、取消和超时后端口关闭。专项3项及typecheck通过，完整check/build使用原进度节点运行。
严格要求授权响应带iss；实际供应商兼容性尚未核验，不可用时不能静默移除此校验。本模块仅主进程内部原语，不打开浏览器、不换token、不落盘，不代表完成OAuth；还缺SDK provider、元数据/授权URL出站验证、密钥柜绑定、宿主会话代次/关闭接线、真实账号与UI验收。
自查新增第4项回归：调用者在授权期间修改options不能改换本次issuer/resource；红测复现后改为创建时复制不可变值，专项4项通过。首轮完整check/build通过后因该变更已重新跑最终完整回归，结果以最终命令为准。
后续接SDK注意：OAuthClientProvider.saveCodeVerifier由SDK产生verifier；当前回调原语自行产生challenge/verifier，正式整合必须统一为单一来源，不能混用两套PKCE（尚未接线所以当前不影响用户）。已核对本地1.30.0 auth.d.ts。secrets.ts的isUnlocked仍是私有，不能绕开锁定或拿PTY token冒充插件授权。
最终完整check/build通过：3288项，3270通过、18跳过、0失败，build通过。当前无后台命令；只有本地授权回调基础经过测试，生产OAuth/真实供应商/UI仍未验。

## SDK授权码编排继续
新增oauthAuthorization.ts：预审固定公开HTTPS端点的public client授权码流程，使用SDK startAuthorization/exchangeAuthorization。删除callback原语重复PKCE来源，SDK产出的verifier与authorize challenge/换token唯一一致。scope/resource/redirect/state精确绑定；拒绝未批准token地址；外部错误体不透传；POST无自动重试；取消/总期限即刻结束等待并传AbortSignal到网络，迟到token丢弃。
新增5项测试：PKCE一致/精确目标、错误目标无浏览器或网络副作用、token进行中取消且迟到不接收、503不重放不泄漏错误体、真实隔离HTTP token服务器的SDK交换。现有callback4项回归通过。
范围：只是主进程内部编排，fetch/openBrowser依赖必须由生产适配提供，尚无生产调用者。未实现SDK OAuthClientProvider自动发现/DCR/refresh、密钥柜持久化或真实账号/UI；固定clientId必须来自服务商合法注册，不能冒充别的客户端。默认仍严格要求iss。不宣称已能实际登录。
本轮最终check/build退出0：3293项，3275通过/18跳过/0失败；新增真实HTTP测试也被全量包含，随后typecheck再次通过。当前无后台命令。未真实账号/UI验收，未发布。

## 05:10用户要求持续自行推进到最终结果（不要每个小提交停下等继续）
持续工作中，尚未整体完成；没有发布生产目录/正式app。
已新增但尚未提交：credentialLease + secrets内部插件专属seal/open桥接（app-ready/系统加密/锁定/拒绝Linux basic_text，锁/重新解锁旧租约失效）、按plugin/issuer/resource/account绑定的加密文件store（0600/原子替换/拒绝损坏掉包及符号硬链接）、authorizationManager同账号单飞和迟到授权防复活。
credentialStore测试第一轮在mac /var -> /private/var 别名触发目录symlink保护，修正测试夹具使用真实路径，没放宽产品检查。manager额外红测修复同步authorize抛错后死pending、close后仍能login。
另补pluginReplace更新失败回退（先同卷备份旧树，不再先删旧包；不承诺断电恢复/活跃升级安全）、install确认后manifest摘要核验（防命令/权限改变），远程origin与目录一致并显示确认权限。
RemotePluginClient增加宿主通用request、通知、connectionClosed和tracked请求。超时/取消不落定completed；仅真实响应或本地连接关闭释放跟踪，明确不表示上游执行停止。pluginHost接入显式no-auth remote分支并区分stdio.exited/remote.connectionClosed；共享PluginInfo.remote和parser已同步，要求mcp.remote capability，但市场仍仅广告mcp.stdio。OAuth清单仍拒绝，没接真实授权UI。
实际pluginHost源码抽取+真实本地HTTP服务器测试通过：三个模拟shimId复用同一个remote连接并调用。不是三CLI真实进程/模型端到端，不能夸大。旧stdio准入测试同步stopped字段仍通过。
公开上游核验新增Google Workspace官方MCP、Slack应用限制、B站/抖音审核、高德key、小红书仅核到电商范围等，已落台账官方来源。没有账号级调用证据。
之前首次完整check/build通过（凭证初版）；后来又有manager/host/installer增量，需要重新跑最终完整检查与隔离app眼验。所有正式app/真实密钥未触碰。
后续继续：发现mcpBridge.easPluginMcpServer仅认plug.mcp会静默丢失remote，写红测后补remote条件。pluginRemoteHost测试现额外启动真实eas-plugin-shim.mjs三个独立子进程，经过测试HTTP网关→真实宿主函数→远程测试MCP服务；所有list/call通过。仍不是实际三CLI模型进程测试。
首轮最终check/build+隔离app市场验收通过（已亲眼看截图版本999门禁），随后又有bridge/目录增量需重新全量。
新增pluginCatalog.ts v2不可安装条目独立列表（无伪包链接）与校验；主进程loader/preload/types/完整市场同步原因、数量、缓存标识。旧parseRegistry仍拒schema2；默认URL仍v1，未部署切换。隔离UI脚本已增加schema2不可安装条目无安装按钮断言，待构建执行。
密钥路由索引仅阅读元数据：没有从gh/rclone/其他CLI复制任何token，索引里的其他服务凭证不等同插件OAuth客户端注册。没有要求用户贴key。
该批最终check/build+隔离UI通过：3313项，3295通过/18跳过/0失败；v2待接入原因无安装按钮已亲眼看截图，4项断言通过。最后命令15781/1635已结束，无后台运行。准备提交里程碑后继续，不是整体完成。当前默认在线目录仍v1，远程能力仍不对市场广告，oauth descriptor/UI/refresh未接宿主，32条目仍大部分未实施。

持续目标已建立（用户明确要求自行做完所有直到最终结果），create_goal为active，不要仅因为某个commit完成就标目标complete。没有token预算。里程碑c0e258f已提交41文件719行，最终验证3313/3295pass/18skip+build+4UI断言，截图眼验。未push/发布。
最新尚未提交增量：credentialStore.savedAt+expires_in剩余时间（新增红测通过）；authorizationManager.refresh单飞，断开晚到refresh不落盘，显式login取消已有refresh；oauthAuthorization新增refreshPluginAuthorization锁定精确token endpoint、SDK刷新保留refresh token，取消/60秒总限不重放。专项15项及typecheck通过，将跑完整检查后提交。
下一块要做OAuth正式宿主/界面，但必须保持安全：现PluginInfo.remote.auth仅'none'；需要引入显式OAuth配置（issuer/auth/token端点、合法注册clientId、scope、auth.oauth要求），主进程固定配置不可renderer任意端点。新增runtime应从app-ready canonical userData插件目录构造store、用acquirePluginCredentialAccess租约；fetch附Bearer前核验精确remote URL，锁定信号取消请求/关闭所属连接；过期才manager.refresh，不在tools/call失败后重放。native确认后系统浏览器登录，renderer只拿状态；卸载/断开先取消连接再清本地凭证，不能全局杀服务。
仍缺：OAuth实际宿主/UI、发现/DCR/供应商适配、v2默认目录切换+发布链、32真实连接器与逐项上游许可、实际模型CLI验证、正常安装/更新/断开UI与独立更新演练。不要把已跑的真实shim子进程测试说成实际模型三CLI。保持原Demo清单，不换项凑数。读keys-vault只拿过索引元数据，没有借其他CLI token。
refresh/expiry批最终check/build退出0：3316项，3298通过/18跳过/0失败，build通过；监测命令34244已结束。持续目标仍active，下一自动续轮继续OAuth宿主/UI，不等待用户再说继续、不标完成。上游候选核验新增Word/PPT归档与DBHub<0.22.6 readonly漏洞，台账已记官方来源，未安装这些候选。

## 用户催促执行后的 OAuth 宿主增量
实际新增 authenticatedFetch + authorizationRuntime + pluginAuthorization 生产适配、OAuth descriptor、宿主接线。先红后绿：exact resource Bearer/拒绝注入/过期刷新/401不重放/锁定取消/refresh迟到不发包4测，runtime显式登录与断开清理2测，manifest公共客户端及origin/scope/secret拒绝1测，真实宿主shim测试扩到oauth/noauth两模式，Bearer真实HTTP收到且锁定后client关闭。
首轮typecheck测试类型失败（SDK FetchLike不接受Request、Promise缺void），已修声明，后续typecheck通过。没有调用真实账号或打开授权浏览器；没有UI入口、卸载历史配置凭证清理。尚未发版/广告能力。继续下一块应是guarded IPC + preload +现有市场授权状态/登录/测试/断开，native确认与隔离应用眼验，不能再把基础模块当全部完成。当前准备跑最终全量check/build，结果未出之前不称全量通过。
本批最终check/build退出0（3324项，3306通过/18跳过/0失败），日志 /tmp/eas-plugin-oauth-host-check.log。隔离应用市场回归4项通过，截图已眼验（只证明原市场入口/不可安装原因/兼容性拒绝，不能证明OAuth用户登录）。监测命令60855/13603已结束，无后台任务。目标继续active，下一轮直接接授权IPC/UI，不等待再催。

## 2026-09-18 账号UI与授权IPC继续
新增shared/pluginAuthorization契约、authorizationActions纯执行体、plugins.ts guarded plugins:authorization（status/login/disconnect）、preload、市场已装OAuth卡片PluginAccountControls。登录/断开原生确认，确认后重扫插件清单拒绝替换或禁用，renderer只传动作+ID，不能指定URL/路径/token。状态无轮询，只初次/显式刷新，保存token不标可用。保持现有市场视觉token。
专项3项先红后绿；最终npm run check/build/verify-plugin-compatibility全部退出0：3327项/3309通过/18跳过/0失败，隔离UI6项通过。动态临时builtin账号fixture在finally删除，实际IPC返回locked-or-unavailable且仅ok/status；截图account-controls.png已亲眼看到连接/刷新/断开按钮与锁定提示，并提交当前Frame。正式app和真实凭证未动，未发布。
此轮没有真实账号授权成功、浏览器跳转/原生确认点击的完整UI验收；没有测试连接按钮、卸载历史配置清理、v2发布、32真实连接器，不能视为全目标完成。监测命令13138已结束。下一轮优先补连接测试/取消状态和生命周期卸载清理，再推进32包与独立发布演练；持续目标active不等待用户再催。

## 继续：测试连接
已实现授权UI的测试连接按钮和credential-free结果，真正走共享宿主acquire+临时test ref，finally释放，工具列表探测不调用业务工具。实际HTTP宿主测试断言共享initialize次数仍1、业务call次数不增、refs回到原数；未授权无probe/不自动登录。额外红测复现probe期间授权失效仍报成功，现完成后重验status与安装清单拒绝迟到结果。专项通过，完整check/build/隔离应用正在原进度节点运行；未发布，卸载历史凭证清理与32真实接入仍缺。
测试连接批最终check/build/隔离应用全部退出0：3329项/3311通过/18跳过/0失败，UI7项通过，截图眼验四按钮与未授权明确拒绝已通过。监测31426已结束。没有真实账号连接成功证据；测试fixture成功仅说明共享宿主只读探测、引用释放和不额外initialize。下一步卸载/升级生命周期安全与v2独立构建发布链，仍不发布生产、不广告未验能力。

## 继续：包变更与凭证生命周期
已补installCommit/uninstall同步写前assertPluginPackageIdle：registry仍有宿主或startingPlugins仍在准入时拒绝替换/卸载；沿用用户运行中心停止与引用自然回收，不自动全局杀服务。写前invalidatePluginAuthorization关闭此插件pending授权/refresh，更新保留绑定密文、卸载清全部该插件配置/账号。
credentialStore未发布格式改为plugin前缀+scopehash，removePlugin无需解锁，固定目录、ID校验、目标文件类型全量预检，避免删其他插件。没有正式用户旧格式数据迁移；早期分支无前缀文件不能安全推定归属，不猜测删除。专项9项（store+实际install IPC）及真实宿主2项通过，完整check/build/UI回归正在进度节点运行。主worktree与正式app未改，未发布。
本批最终check/build/隔离市场回归退出0：3331项/3313通过/18skip/0失败；UI7项截图眼验通过（仍不包括真实安装更新/卸载交互，变更边界由实际IPC隔离文件测试证明）。监测34160已结束，无后台任务。后续优先双目录构建发布链：现build-plugin-registry仍只有2包schema1，publish脚本仍直接覆盖正式registry和zip，需要本地fake-transport演练不可变包/目录原子切换、v1/v2隔离，绝不直接跑生产publish脚本。再补32条目真实连接器与账号条件；不把待接入卡片当连接器。

## 双目录构建增量
新增scripts/plugin-registry-build.mjs并实际接build-plugin-registry：staging内打包+parseManifest/parseCatalog校验、v1排除requirements包、v2保留、同版本archive变更拒绝覆盖、预检后复制不可变包、分别原子rename两个目录（非跨文件事务）。tests三项先红后绿，测试了legacy隔离/真实zip大小/不可安装字段拒绝/重复名/失败后旧目录与archive不变。当前仅两已有包，不是32包落地。全量check/build及真实CLI双次构建到/tmp新目录正在可见节点运行。未改在线默认URL，publish-plugins旧脚本仍不能安全发布新格式，本轮没有执行生产上传。
本批最终全量check/build退出0：3334项/3316通过/18skip/0失败。真实build-plugin-registry CLI在新/tmp目录连续两次构建成功，产物v1两包/v2两包，逐包重新计算SHA256和size与两目录一致。没有宿主重构或任何生产上传。监测54399已结束。下一步发布器原子切换/不可变包与独立更新演练，32包与实际账号仍未完成；不能把构建目录存在称线上已支持。

## 继续：双目录安全发布链
替换旧直接覆盖上传脚本为显式 --publish Node 入口和可演练生产 SSH/SCP 适配器：校验双目录/版本URL/本地hash并快照；owner目录锁；全部远端同版本包预检；逐文件SCP后大小/hash核对；所有暂存通过再硬链接独占晋升包；v2/v1备份后分别原子rename。保留旧包和release目录，断线不自动重试，不抢锁/不reload。两目录不是事务：第二目录失败允许v2新/v1旧，引用包仍完整。
8项专项通过（包含故障注入与实际POSIX临时文件系统操作），新增权限红测发现上传0600可能让静态托管不可读，已在晋升前设644并测试。Node既有MODULE_TYPELESS_PACKAGE_JSON警告仍在，不为消警告改项目module类型。未执行生产脚本、没有SSH服务器操作。全量check/build监测93755正在运行，结果待取；目标不完成，接下来需独立更新宿主端到端演练及32真实包/凭证配置/上游授权，不用占位冒充完成。
安全发布链最终全量check/build退出0（3342项：3324通过、18跳过、0失败）；监测93755已结束，无遗留运行命令。脚本本地真实POSIX验证通过但未在生产SSH/HTTP执行；本轮无宿主UI改动，未新增应用端到端证明。持续目标active，下一步应做同一隔离宿主不重构建的目录刷新/安装更新演练，再推进32连接器实包与配置授权。

## 继续：独立更新实际宿主与UI
先跑真实隔离app证明同PID经真实IPC刷新/更新/损坏包保留/缓存可行（11项），但发现完整市场缺显式刷新、版本与更新按钮，不能把内部调用当用户已能热更新。新增PluginInfo.version和pluginVersion/canUpdatePlugin，数字版本比较排除内置/其他CLI/未知/降级；完整市场增加刷新、当前/目标版本、更新按钮、确认更新，沿用两段安装与权限确认。
版本单元测试先红后绿14项。UI红测在实际构建应用报“市场提供显式刷新目录入口”后才补按钮。验收启动早期曾Promise was collected，后续若全局改HOME导致renderer CDP卡住，原compatibility verifier对照通过；最终隔离启动适配器只替换Node homedir与fixture包网络目的地，原生HOME保持，OS沙箱仍拒真实凭证目录，走相同out/main/index.js。不把该适配器当真实HTTPS/CDN证明。真实授权、业务MCP工具和32连接器仍未验证。
全量check/build + UI新增脚本监测1609运行中；结束前不能称整轮通过。旧基线UI截图本轮对照重新生成，无正式应用修改。下一步还需账号配置/32真实包/上游授权、真实CLI模型验证，不标目标完成。
第一批check/build/UI退出0：3344项（3326通过/18跳过）+同进程UI12项，截图看到新版1.1.0/损坏1.2.0错误与缓存提示。同时眼验抓到长描述撑开grid裁右列，新增真实DOM边界红测复现，改minmax(0,1fr)+min-width:0；最终check/build+热更新13项+旧授权兼容UI回归监测22531运行中。不要依据第一批截图说布局修复已验收。
最终22531已退出0：全量3344项/3326通过/18跳过/0失败，构建通过，热更新UI13项和账号/兼容UI7项通过。updated.png与failed-update.png已亲眼核对：1.1.0安装版本、1.2.0失败后保留1.1.0、离线缓存提示，双列卡片不再溢出；新截图提交当前Frame节点cnode-106-hn6rb（4/5槽）。旧失败保留layout-red.json作红测证据，无后台进程。未发布、未改正式软件、未验证生产HTTPS/CDN/插件业务工具/真实模型CLI。
下一轮重点回到32真实插件包与统一配置入口（API key/本地目录/数据库权限等）；先核对approved spec与demo audit，不要继续只扩基础设施。仍缺真实provider OAuth注册/发现、凭证配置UI、源站v2切换/缓存迁移、32项逐项上游资格/许可与可运行包。新发现待补：installStage目前核对name/requirements却没核对包内version与目录version一致；更新UI依赖真实安装版本，宜加实际IPC红测防目录撒谎。composerSources还未把remote识别为MCP。持续目标active。

## 继续：开始真实连接器包，不再只改基础设施
新增plugins-store/wikipedia候选（零第三方运行依赖，自写stdio两个工具search/summary、中英文、只读、来源和许可链接）；固定Wikipedia HTTPS、全DNS答案公共检查/固定IP+TLS原域、15s/1MB、禁redirect、不读key/token。地址策略从宿主endpointPolicy转译生成，脚本build-wikipedia-policy维护。官方API/UA/许可来源已落台账和包README、架构01/隐私开发文案，非法律或平台批准结论。
真实pack→extract→parseManifest→McpClient→stdio握手/list/call已运行：公开query失败，DNS“非公开地址”，en.wikipedia.org实际lookup=198.18.0.76（Clash fakeIP）。监测19631退出2，wikipedia-candidate.json livePassed=false。没有为了通过而放松私网规则，没有借CLI凭证或修改Clash；仅直连且系统PAC/代理仍缺，因此未加入默认目录、不能报第三项可用。
同时实际IPC红测发现目录1.1.0可接受包内1.0.0，现installStage比对man.info.version，失败删暂存。hot-update verifier增加真实UI点击1.3.0但archive1.2.0/哈希正确的拒绝检查。全量check/build/UI监测85554在跑；网络边界测试另补目标IP/SNI/UA/redirect/1MB，最终仍需再取结果。全目标active，无上线。
85554最终退出0：全量3349项/3331通过/18skip/0失败、构建成功、隔离热更新UI14项通过；版本谎报拒绝截图已眼验。全量期间新增最后一项Wikipedia网络边界测试，随后单独重跑Wikipedia5项全通过（不是声称全量已包含最后新增那项）。维基百科真实请求仍失败、未改DNS/代理；不把回归通过混为公开接口成功。下一步可推进统一配置UI/API key安全注入、本地目录授权和其余连接器；DNS问题需安全方案或有范围的Clash配置批准，不能关闭公共地址守卫。
补充待统一：批准spec写新目录`/plugins/v2/registry.json`，当前构建/上传实现是`/plugins/registry-v2.json`，未上线所以仍可安全对齐；不能略过编号交付物的路径审计。用户指定`~/.Codex/playbook/网络排障-代理卡死.md`本机此路径不存在，本轮未调整Clash，不能凭印象套命令。

## 继续：已批准 v2 路径落地
构建/发布现统一 `v2/registry.json`，v1仍`registry.json`。红测先复现旧路径不产出已批准位置；两个目录同名不能沿用basename暂存，改用相对路径扁平名（v2-registry.json/registry.json）及区分备份。生产适配器首次创建v2目录755、拒绝父目录符号链接；本地v2 symlink重定向红测复现后拒绝。13专项全过，真实CLI在独立临时目录连续两次打包，并逐个比对两个目录的包size/hash通过，默认仍仅两包。
全量check/build监测43838退出0：3352项/3334通过/18跳过/0失败，已包含上一轮最后的Wikipedia网络边界项。未生产上传、未切客户端默认URL、未改Clash或正式app。隔离应用回归61207正在运行，需取结果并眼验截图；不把本轮路径修正称32插件完成。下一轮必须优先补统一配置/API key/受控目录的真实生产接线，或推进真实连接器，不再只做发布基础设施；已有OAuth store仅存OAuthTokens，未支持通用secret/config，批准spec3.2/5/7是依据。
61207回归退出0；随后将验收fixture目录URL也改为`/plugins/v2/registry.json`，重新开隔离应用监测40856退出0，14项全部通过。实际请求记录已对齐新路径，仍是localhost受控网络不是线上HTTPS。眼验失败截图：版本不一致拒绝、缓存提示、保留1.1.0；更新截图已复用Frame节点cnode-106-hn6rb。所有本轮监测已结束，无后台命令、未发布。全量结果仍是3352项，最后仅修改验收脚本URL并完整执行该脚本。

## 继续：统一配置声明与失败关闭（尚非配置功能完成）
从批准spec3.2/5/7推进：新增shared/pluginConfig类型+严格解析（1–32字段，string长度上限、enum独立选项、secret引用元数据、directory read/read-write），并接入真实pluginManifest/PluginInfo；禁止内嵌值/默认密钥/清单目录/未知字段/可执行校验/任意regex。要求config.fields能力，不提前广告。红测确认旧解析器会静默忽略config；另用真实宿主acquire+registry/调度器测试复现手动安装配置包仍启动，现临时失败关闭，待配置解析/授权/注入完整接线替换，不是永远禁用配置插件。
18项宿主+manifest测试、2项配置边界测试通过。typecheck暴露目录access推断string，修为map明确返回PluginConfigField；第二次暴露assert.throws三参undefined与Node类型签名不符，改Error判定。监测36209/76783均退出2，未粉饰；最后全量check/build/hotupdate监测8261运行中，需取结果。
下一步配置值储存及APIkey/目录原生选择UI、安全注入和租约清理仍完全缺失；当前只完成声明与拒绝静默降级，不是第三个真实连接器、不增加32完成数。不要继续调整发布器小项冒充接入进展。
8261最终退出0：全量3357项/3339通过/18跳过/0失败、构建通过、隔离热更新14项通过。已眼验更新截图的1.1.0与布局并刷新Frame原图节点。这是旧安装/更新回归，不是配置UI（尚不存在）的验收；配置声明/拒绝启动由manifest及实际acquire函数测试证明。所有本轮进程已终止，无后台任务，目标active，下一轮需要从本契约接配置存储/用户输入/主进程注入完整链路，不能把临时拒绝启动保留成最终功能。

## 继续：统一配置密文存储层
PluginCredentialStore增加saveConfiguration/loadConfiguration，OAuth原有version1和文件哈希保持不变；configuration独立哈希命名空间、version2/kind、同样scope绑定，不把API key伪装OAuth token。配置全部加密，固定目录/租约重验/0600原子写/64KB封装上限复用writePayload，最多32个string值且单值16KB，非法字段/类型拒绝。removePlugin既有前缀清理自然覆盖配置并保持其他插件不动。
新增红测先失败方法不存在，补实现后6项通过，再补跨账号/与OAuth密文互换拒绝测试。完整check/build/hotupdate监测43254运行中，需取结果。没有配置IPC/UI或主进程schema+endpoint scope factory，方法目前只由测试消费；不把存储层存在说成用户能配置。下一轮优先真正接main controller/IPC/UI/注入而不是另造未消费工具函数。配置字段声明宿主临时阻止启动仍保留，到真实解析/租约注入接通时替换。
43254最终退出0：3360项/3342通过/18跳过/0失败，build通过，隔离热更新14项通过并眼验1.1.0截图，已刷新Frame原图节点。这是存储回归和旧市场行为证明，不含配置UI/真实密钥/真实连接器。当前无运行命令，目标仍active。

## 继续：配置主进程接口与软件表单真正接线
新增configurationActions校验保存补丁/枚举/长度/必填，省略保留已有secret、null清可选；只返回configured字段名。插件描述确认前后变化拒绝，保存前assertPluginPackageIdle。pluginConfiguration固定userData目录+系统密钥柜lease，scope由installed info的config/mcp/remote/root/permissions哈希构造，不收renderer路径。guarded plugins:configuration→preload→PluginConfigurationControls已连接，配置按钮/密码输入/刷新状态/原生保存确认；不回显secret。目录文本值拒绝，UI标“目录选择器待接入”，宿主注入临时拒绝仍在。
隔离实际UI红测已复现缺“配置插件”入口才实现组件。当前全量check/build/compatibility UI监测5414运行中；新增最后manifest变更确认测试另跑3项通过。样式修正为项目已有--fg/--glass-border-strong。不能把锁定状态UI验收说成真实safeStorage保存成功，尚缺解锁后保存流程/原生目录picker/运行时注入/真实32连接器。
5414退出0，3362项/3344通过/18skip；10项UI通过。23204重截图也退出0；眼验真实表单后发现锁定不能称未配置，现配置状态初值null/错误置null，显示“状态未知”，21307正在typecheck/build/UI重跑，结束后需眼验并提交。最后新确认变更测试单独3项全过不冒充全量计数已包含。整个功能仍缺真实解锁保存原生确认验收、目录选择、运行时注入（acquire阻止config插件仍在）。
21307最终退出0：类型检查、构建成功，11项隔离UI通过。最新完整表单截图已眼验“状态未知”“密钥柜已锁定”、密码输入与目录待接入，已复用Frame原账号截图节点。无后台命令；下一步应实际接原生目录picker与运行时配置注入、用隔离自有密钥柜做保存成功验收，不能宣称当前配置链路完整。

## 用户要求一次性完成后的推进策略与本地文件纵向结果
用户指出长期只做基础设施；改按真实插件完整链路交付，不再以小commit/测试数代替接入。本轮打通本地文件：原生picker+二次确认（默认取消）→inode/access绑定grant加密保存→stdio EAS_PLUGIN_CONFIG专属注入→长期租约锁定关闭实际子进程；remote+config仍不支持。新增自写local-files三个工具list/read/write，1MB限制、SHA256覆盖、路径/symlink/hardlink检查，无网络，不宣称OS沙箱。需要同用户恶意并发文件系统攻击隔离的场景不适用。
实际隔离app先手动解包12检查通过，然后改为真实市场安装13检查通过：真实safeStorage（设置隔离PIN）/真实安装IPC和hash解包/真实共享宿主/Claude,Codex,OMP三个真实shim子进程真实写临时目录/越界拒绝/锁定后写入拒绝。脚本verify-local-files-plugin；native picker与二次确认返回值为测试适配，未亲手验native窗口，也不是实际模型CLI。开始广告config.fields，默认构建新增local-files仅v2，实测v1=2/v2=3。生产没发布。
全量50182失败两项：codexModels timeout probe缺log.pid，codexCapabilityLauncher 5s夹具pid未出现；保留/tmp/eas-local-files-full-check-failed.log，未改超时或测试断言。随后48731单独重跑23项全通过。74817build+真实市场local-files13项+兼容UI11项全通过；已眼验本地文件市场安装和授权已保存截图并放Frame cnode-115-7jnie（5/5槽，后续复用已有图）。全量仍需再跑，不把专项复跑当全量通过。
维基百科本轮重查lookup/resolve4仍198.18.0.76，系统DNS114.114.114.114；未改Clash/绕过安全检查；指定网络排障指南文件仍不存在。32项仍未全接，完整目标active。
5215完整复跑check退出0：3367项/3349通过/18skip/0失败；此前两项失败不删除记录，不能断言已解决所有负载时序问题。真实看板（add/move/list/remove）、番茄钟（start/done/重复done不重记）子进程业务回归也成功，结果existing-business.json，不冒充本轮市场UI/实际模型验证。所有监测已结束。
下一段应继续真实插件逐项闭环，目标不完成。仍需配置存储对话期间锁定/重新解锁的代次审计、secret字段注入的日志脱敏（McpClient当前直记stderr，local-files不输出配置但通用第三方secret尚需防泄漏）、本地文件真实模型CLI/native picker交互/Windows验收；远程+config仍拒绝，Bearer未接；Wiki fakeIP外部阻碍；其余29项上游资格/授权/包/工具验收缺口仍大量存在。不要再回到单个小基础函数后汇报“全部快好了”。

## 继续：先关闭已复现的配置凭证漏洞
本轮两个红测复现后修复：1）原生保存/目录确认弹窗期间锁定再解锁，旧输入仍能写；configurationActions 必填 acquire 租约，await 前获取、确认后 assertActive、finally dispose，plugins.ts 接真实 acquirePluginCredentialAccess。2）McpClient 直接记录配置插件 stderr，secret 可跨块泄漏；host 对 configured stdio 开 suppressStderr（消费但不记录），并隐藏握手失败原始日志。非配置插件日志不变；不声称恶意插件工具结果能完全防泄漏。
真实隔离app验收增加两条 pending native dialog →实际锁定/解锁→旧确认拒绝→原密文字节不变。1299 build + local-files 17检查 + compatibility 11检查退出0；已眼验配置卡片和已保存状态。原生窗口返回仍为适配，不是亲自点击，也不是实际模型CLI。82443完整check退出0：3369项/3351通过/18skip/0失败。无生产发布、无用户真实凭证修改；活动目标继续，不得因安全修复增加可用插件计数。
新增天气/钉钉官方来源条件已存 demo audit；Open-Meteo 商用非免费，MET需标识/缓存/总量条件。天气域名仍fakeIP；未改Clash。其余工程工作没有消失，不能说全都只等账号。正式v2 URL/缓存迁移、remote Bearer、远程配置测试入口、真实连接器包均仍待做。下一段应选一个完整连接器交付里程碑，不再只做单函数提交。

## 继续：远程Bearer真正接入共享宿主与GitHub候选包
用户最新指令“完成了再汇报，继续”：不再发阶段性口头总结，保持可见轮询和目标active。
前轮1762ae3为progress，不是阻塞；本轮 revalidate worktree只有旧ui/failure.json未跟踪。新增remote auth=bearer清单严格引用唯一必填secret，声明mcp.remote/auth.bearer/config.fields，拒绝内嵌值、混OAuth、optional或非secret。pluginConfiguration.connectPluginBearer从原加密configuration scope和长期lease读token，bearerConfiguration校验格式、复用authenticatedFetch精确资源/无401重放/锁定取消，pluginHost实际remote分支消费；非bearer remote+config继续拒绝。
红测覆盖清单拒绝旧实现、Bearer host被旧闸拦；随后实际三shim/真实HTTP共用连接测试新增bearer情形通过。新增GitHub候选包，官方端点/PAT文档重核并落README/audit；真实打包通过，不进入默认目录、不提前广告remote/bearer能力、不借用户CLI token。不能增加已验业务插件数。
57194 typecheck失败（空对象case数组推断token?:undefined），原错误已读，改测试数组显式Record类型；86801 typecheck/build/隔离兼容UI11项退出0，账号控件截图已眼验；它只是既有UI回归，不是Bearer配置/真实账号E2E。99301完整check退出0：3374项/3356通过/18skip/0失败。所有命令已结束；无生产发布/实际GitHub账号出站。
下一完整里程碑：给配置插件（包括Bearer）接软件“测试连接/断开清除”动作并做真实隔离app密文保存→remote shared host→三shim→锁定验收。现PluginConfigurationControls只有status/save/directory；OAuth专属测试不适用于Bearer。候选GitHub仍需真实用户提供令牌（软件控件而非聊天）和上游调用，实际模型/Windows仍缺。其余清单自主工程仍未完成，不能笼统归因只等账号。保持active，不向用户再发未完成阶段性汇报。

## 继续：配置测试与清除真实应用闭环
统一配置入口已加 test/clear，复用共享宿主工具列表，不跑业务工具；clear 原生确认后写当前 scope 空密文并撤销插件级租约，阻止旧 shim 与待确认保存，不影响其他插件/业务文件/新授权。ConfigurationLeases 和 controller 红绿测试已通过。原生确认期间锁定重开保护不变。
89636 最终退出0：实际隔离应用 local-files 23项与兼容 UI 11项通过；截图已眼验并复用 Frame cnode-115-7jnie。首次重授权读取失败“插件进程不在（先 initialize）”，修正验收脚本在重授权后重新 initialize，没有放松生产宿主协议。此前 UI 红测“配置卡片提供真实测试连接入口”失败也已复现。原生 picker/确认返回值仍为测试适配，不是实际模型CLI。
22015完整check退出1：3377项/3358通过/18跳过/1失败，capabilityPtyLauncher真实POSIX Ctrl-C夹具在3秒等待内报 RuntimeError: native CLI not ready；原日志 /tmp/eas-plugin-config-clear-check.log。未改测试超时/断言，63564正在隔离重跑原测试再完整check，取结果后才能下结论。构建和实际UI已于前一执行批次通过，本次生产代码未再变化。
Bearer隔离UI脚本生成被PreToolUse shell解析器阻止（Bad substitution: JSON.stringify），文件未生成、未执行；不能称该验收完成。下一步用apply_patch创建脚本，保留真实safeStorage/host/三shim，只有自有fixture网络和native确认适配，不动公共地址检查，不用真实凭证。目标仍active，其余32插件工程缺口没消失。

63564最终退出0：原PTY专项12项通过，完整check复跑3377项/3359通过/18skip/0失败。保留前次超时事实，不宣称根除时序抖动。所有本批监测结束；local-files实际应用23项与旧兼容UI11项已通过且截图已眼验。下一步Bearer真实隔离app纵向验收尚未执行，目标不完成。

## 继续：Bearer真实隔离应用纵向验收
前一用户询问停顿后的纯回复是no-progress，本轮真正继续：新增verify-bearer-plugin.mjs，隔离Electron配置表单输入自有测试令牌→真实safeStorage密文→生产共享宿主→Claude/Codex/OMP三真实shim调用自有HTTP服务→清除阻断旧连接→重新配置建立新连接→锁定拒绝继续调用。25975初版11项和37049扩展13项均退出0，connected.png已亲眼查看。没有生产代码改动、没有新的上游账号能力，也不是实际模型CLI。
只在验收bootstrap里适配精确fixture域名的DNS/PAC/HTTPS拨号到自有loopback HTTP与原生确认返回；生产公开地址验证/pinned fetch/精确Bearer资源匹配都仍执行。不能把此证据说成真实TLS/上游GitHub验收。fixtures自动清理，没有读取CLI授权缓存/真实凭证。没有提前广告remote/bearer能力或把GitHub加入默认市场。
本批无全量重跑：生产代码未动，前批3377项回归结果仍是前批证据。目标active，仍缺真实32连接器、正式v2 URL迁移、更新权限/目标差异UI、实际模型CLI和Windows验收；不以fixture增加可用插件数。下一段优先处理32连接器自主工程，不要继续围着fixture扩测试打转。

## 用户再次指出停止后：推进真正的Word连接器
不再只扩Bearerfixture，本轮新增plugins-store/word候选：自有stdio三个工具create/read/revise，目录授权、二进制8MB守卫、hash覆盖、生成标题/粗斜体、顶层正文读取、简单段落带作者跟踪修订（复杂结构/已有修订拒绝）。TDD先module missing红，后3项通过，含真实pack/extract/child生成读取修订和越界/软链拒绝。没有把三工具说成完整Word范围；默认builder未包含候选。
脚本源scripts/word-connector/document.mjs，独立package-lock固定docx9.7.1/jszip3.10.1/xml-js1.6.11，npm ignore-scripts安装，audit0已知漏洞。用esbuild生成离线CJS并带22份许可证，root测试不依赖未安装的开发子目录node_modules。第一次build许可证收集报Missing license notice: hash.js；查证其/isarray README含完整MIT后显式收集，构建成功。不改root依赖或用户正式app。
28113完整check正在可见节点运行，需同handle取结果。Word实际app/UI/Word渲染/Windows和真实CLI未验；也还没有实现表格等全部Demo范围，不可称已完成。上一批Bearer f47e450已提交，所有前批进程终止。当前新Word文件未提交；下一步需要安全边界更多测试和应用纵向验收/独立渲染，再推进剩余真实包。

28113全量退出0：3380项/3362通过/18skip。随后补ZIP实际解压流量限制，初用for-await失败stream is not async iterable（JSZip旧readable-stream），改data/end/error计数并保留destroy上限；重新build bundle，4专项全通过（含8MB展开/DOCTYPE拒绝）。69867build+实际Word应用23项通过；流量限制最终版9543实际应用再次23项通过并眼验截图。原生picker/确认适配，不是人工操作/Word渲染/实际模型。最终完整check 7518当前在运行，取同handle结果后再提交；无正式发布，其他32范围仍未完成。

7518最终完整check退出0：3381项/3363通过/18skip/0fail，包含最后ZIP限流测试。所有本轮进程终止，候选尚无真实Word渲染/完整排版/Windows/实际模型证明。已将Word实际应用截图放当前Frame（关闭自己旧account-controls截图腾位，未碰用户模块），进度节点仍保留。

## 用户截图指出UI问题，批准独立面板及全量落地
最新用户“OK继续优化，并且之前的修改要全量落地”。先执行UI修正，不把此话推断成生产发版许可。已明确告诉用户回归既有安装更新授权三路链路，保留未验项目。
截图问题真实红测43879失败“配置在独立对话面板中打开，而非撑高列表卡片”。新增PluginSettingsDialog原生top layer，配置/OAuth都只在卡片留入口，配置表单和危险操作分区；目录文案/无用保存按钮修正。96274 typecheck/build + 本地文件25项/兼容11项通过。眼验发现dialog初始焦点的全框橙outline，改仅dialog容器outline:none，按钮keyboard焦点规则保持；surface用s-2，明暗主题沿用项目token。
68594正在全量check/build + local-files/compatibility/Bearer/Word/hot-update实际隔离应用串行回归。check已输出3381项/3363通过/18skip，整个handle还需取最终结果。local-files新增明暗截图/Esc只关设置/焦点恢复/同排卡片高度/目录文案检查；程序click前显式focus模拟真实点击。末尾OAuth危险分区和保存hover对比修正发生在build前，需核对构建最终证据。
目前这些UI修改未提交，正式应用未替换，无真实上游账号调用。之前Word/Bearer等实包提交仍保留在feat/plugin-market-unified-20260918，不将本轮UI完善称32完成。

68594退出1，真实UI发现“关闭后焦点回到配置入口”失败：原生showModal时入口因status请求被disabled，不能只依赖native默认回焦点。已由显式trigger ref+卸载microtask恢复，不移除按钮焦点环；6748本地文件28/兼容11/Bearer13/Word23全通过，最后热更新等待首卡超时。保留原failure.json；加失败诊断requests/UI（不改timeout），96517原热更新14项复跑通过，尚不能断言消除启动偶发超时。最后卡片icon/check已改顶对齐。33796正在最终全量check+五组app回归，需同handle取最终结果。

## 2026-09-18 插件设置面板最终验收

- 最终轮询任务 33796 退出 0：npm run check 共 3381 项，3363 通过、18 跳过、0 失败。真实隔离应用回归：本地文件 28、兼容与授权界面 11、Bearer 13、Word 23、热更新 14 项全部通过。
- 已亲眼查看最终紧凑市场、独立设置面板暗色与亮色截图：卡片图标/标题顶对齐，不再因配置表单拉伸同排卡片；Esc 仅关设置并将焦点还原到入口，保留键盘焦点环。
- 中途热更新首次卡片等待超时已保留失败证据；增加诊断后连续两次完整热更新通过，不能据此宣称瞬态原因已根治。
- 此批为开发工作树落地与隔离应用验证，未替换正式 app、未上传发布；32 项全量供应商接入、真实三 CLI 模型调用、Windows 及正式目录迁移仍不计完成。

## 2026-09-18 右侧悬停入口（用户最新确认按推荐）
用户先选仅齿轮，随后明确“按你推荐的来”：本轮采用图标＋具体文字（授权目录/连接账号/连接设置），右侧独立区域，hover 或键盘 focus 显示用途提示，触屏常显。47848 预期红灯定位旧入口；94979 编辑脚本编码失败未落代码，旧 UI 测试继续红灯。改用 apply_patch 后 63457 构建、类型检查、本地文件29及兼容11通过。68592 正在追加真实鼠标移入/移出、尺寸不变及 Bearer/Word/热更新回归，按同句柄跟踪。未发布或替换正式应用。

2026-09-18 hover rail: 68592 exited 0. Local-files 32, compatibility 11, Bearer 13, Word 23, hot-update 14 checks passed. Actual pointer hide/reveal, purpose tooltip, unchanged geometry and keyboard focus restoration verified. Built isolated app screenshot inspected and refreshed in current Frame. No formal app replacement or release. Full 32-provider goal remains incomplete.

## 2026-09-18 根据 094239 参考图修正布局
前版只隐藏按钮、始终占94px，与用户图不符。全局搜索确认相关样式只有 canvas.css 一处后直接替换该段：默认不留配置空位；hover/focus 才显示通高右侧操作面、入口居中、右圆角，简介此时让位，整体卡片尺寸不变。71248 红灯证实旧布局不满足通高；90053 构建/类型/真实本地文件与兼容UI通过，已看图。68209 最终默认/hover宽度与截图、兼容与热更新复验中。没有替换正式 app。

2026-09-18 full-height hover panel: 68209 build passed but immediate tooltip assertion failed (pointer hover reveals purpose tooltip). Verifier now waits for actual browser tooltip visibility, not a fixed sleep. 6563 exited 0: local-files 34, compatibility 11, hot-update 14. Idle/hover screenshots inspected: default full content width, hover end-cap full height/right corners, centered entry, unchanged card bounds. Current Frame screenshot refreshed. No formal app replacement/release.

## 2026-09-18 新客户端 v2 目录与来源缓存
按已批准方案补实际入口：pluginCatalogSource 默认 v2，按 URL SHA-256 隔离缓存。旧来源不明缓存保留但不导入，首次升级离线需先联网一次；不修改既有安装或凭证。四专项先 module missing 红，再全过。47714 全量失败6项，均为 pluginMarketBoundary 的 VM import 白名单未接新增模块；已接真实模块并增加实际 IPC 默认 URL/缓存落盘断言（未绕过生产校验）。49895 正在重跑全量/构建/真实热更新，需同handle跟踪。实际应用新增 source-cache 落盘、离线不读取旧无来源cache、旧cache不被更改三项。未部署服务端、未替换正式app。

2026-09-18 v2 source acceptance: 49895 exited 0; full check 3386 total / 3368 pass / 18 skip / 0 fail. Built actual isolated app hot-update 17 checks passed, including source-bound cache persistence, offline rejection of unbound legacy cache, old cache preserved. Screenshot of offline market inspected. Production catalog endpoint not deployed or verified; no app replacement/release. Initial 6 VM import failures fixed by loading actual source helper into test harness.

## 2026-09-18 更新前权限差异
用户要求接入完成前自行按计划做，不再每小步询问继续。新增画布权限/远程目标集合差异，stage校验新旧manifest后返回；旧版清单无效明确未知。新增纯函数2项红绿、实际IPC旧权限移除及未知manifest测试，已通过。28221类型/构建/原热更新通过；59700正在全量与增强真实UI（1.0 snapshot->1.1 open_file 的新增/移除确认截图）验证。未发布。
59700 全量3388/3370pass/18skip/0fail，UI等待安装确认超时：测试fixture使用了不支持的canvas_snapshot，被现有权限交集/目录一致性规则拒绝，非生产放宽。将fixture改为白名单内canvas_open_url->canvas_open_file后88626实际UI全部18项通过，新增/移除确认截图亲眼验证。额外旧manifest移除/未知两项在独立IPC测试9项中通过（晚于全量启动，不冒称该全量已含它们）。
