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
