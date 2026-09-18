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
