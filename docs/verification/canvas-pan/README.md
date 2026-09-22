# 画布平移优化验证（2026-09-21）

## 变更
- 拖动8次等同一帧仅保留最后坐标；鼠标松开/失焦时不丢最后一次移动。
- 终端与AI对话内容 memo，默认浅比较；保留内部状态订阅，不拆卸进程或面板。
- 滚轮/缩放仍沿用现有同步语义；本阶段未做整层DOM直接平移、分批预热或长列表虚拟化。

## 当前证据
- frameLatest 先运行测试发现模块缺失（红），实现后3项测试通过；后续增加重入/逐帧测试。
- 类型检查、优化前后构建通过。
- 真实性能验收未完成：两个独立 profile 的 Electron 已启动，DevToolsActivePort 存在且端口监听，但 /json/list、/json/version 和 WebSocket 无响应；curl明确报2秒无字节超时。Computer Use读取同一Electron应用也报 timeoutReached。未得出性能提升百分比。
- 只关闭本次PID 26269/27286隔离应用及26266/26783测试脚本，未关闭用户原有应用或全局服务。
- scripts/verify-canvas-pan.mjs 保留固定12闲置对话/480移动事件/位置与实例检查脚本，已给发现阶段加请求超时，防止后台无期限等待。
- 未提交、未合并、未发布。不能将源码优化或单测通过当作实机卡顿已解决。

全量检查：3282通过、19跳过、0失败（当时含3项新增测试）；随后新增逐帧与重入测试，5项定向均通过，生产代码未再改动。

## 继续验收（2026-09-21）
调试连接间歇恢复，已运行优化前(main471456f原构建)与优化后隔离应用。首次截图发现首启引导遮挡，不作为有效性能对照；验收脚本关闭引导后重新跑两版。
- 固定场景：12个未启动AI会话的对话模块，60动画帧，每帧8次绝对鼠标移动，共480事件。
- before.json：479次实际坐标变化；after.json：60次，减少约87.5%。首个事件位移0，因此基线不是480次。
- 两版最终X均-479；12个面板DOM身份保持，AI会话/启动数均0。截图after.png已亲眼检查无引导遮挡。
- 两版p95帧间隔均约9.4ms，均无>50ms长帧；此轻负载样本没有证明帧率提高，不外推重历史/媒体/运行中终端。
- npm run check最终3284通过、19跳过、0失败（含5项新增纯测试）。
- 扩展生命周期脚本初次按400ms验证失焦收尾失败；源码既有blurGuard为500ms防抖，调整测试等待到650ms，生产防抖逻辑未改。另有Runtime.enable启动超时，保留日志，不算功能失败也不算验收通过。

最终扩展验收通过（after-lifecycle.json）：松手立即保留最后坐标、后续移动不继续拖动；失焦超过既有防抖窗口后停止；split/canvas切换面板身份不变。截图已亲眼检查。未覆盖运行中的真实模型/终端输出及重媒体场景。

## 长历史与活动对话回归
- 新增 EAS_PAN_HEAVY=1：12个模块各20段Markdown历史，每段12列表项及代码块；真实历史存储恢复。不是12个运行模型，也不是重媒体测试。
- heavy-before/after：实际坐标更新479→60，最终坐标与实例身份均保持；p95帧间隔10.5→10.6ms，无>50ms长帧。没有测得帧率提升，不引入更多生产优化补丁。
- 运行已有真实Codex+本地Responses模型夹具，经Electron验证两轮回复显示、普通resume、预算收尾、手动停止通过。此项证明memo后内部状态更新正常，未声称是运行输出和平移同时压测。见active-chat-ui-result.json与截图。
- 本轮只扩充验收脚本/记录，没有再修改生产代码。首次长历史启动遇CDP发现超时，重跑成功，保留失败日志于临时目录。未提交/合并/发布。

## 扩大到24模块×40段历史的耗时对照
同一脚本、480移动事件、独立profile，明确appRoot指定基线main构建和优化构建；见stress-before.json / stress-after.json。两者生命周期断言均通过，AI启动0。
- 视口更新479→60。
- 本次样本：ScriptDuration累计504.11→95.23ms；RecalcStyleDuration 279.16→116.73ms；LayoutDuration 7.28→7.57ms（未改善）；TaskDuration 1012.90→540.89ms。
- 60帧采样的p95帧间隔19.5→16.3ms，>50ms长帧1→0。说明该压力样本中减少JS与样式更新有效，不证明任意场景或机器都同幅提升；采样短且有其他系统负载，不作通用性能保证。
- 期间保留失败：CDP超时、Promise was collected、一次基线失焦最终坐标断言失败；没有修改生产逻辑或放宽坐标断言。重跑基线和优化最终均通过。另一次误用工作目录的基线尝试启动超时，未产生有效结果；之后添加EAS_VERIFY_APP_ROOT与结果appRoot字段明确来源。
- 没有引入第二阶段生产补丁；当前优化的收益证据已从单纯减少更新次数补到压力样本耗时。大图片/视频、持续终端输出、真实用户画布、Windows仍未覆盖。未提交合并发布。

## 集成授权与最终审查
上述未提交状态为各阶段历史记录。用户现已授权审查、提交并合入本地 main；最终审查无阻断项，提交前完整检查 3284 通过、19 跳过、0 失败。仅本次平移优化及相关证据纳入提交，不推送、不发布。

## 2026-09-21 第二轮扩展验收（未完成）
仅扩展验收脚本，未修改生产代码，未提交或再次合并。
- 新增真实 PTY 持续输出 + 平移模式 EAS_PAN_STREAM=1；一次成功样本 streaming-trace-2：平移期间接收494字节，480事件/60坐标更新，最终位置及生命周期通过，p95约9.3ms。截图已看，但终端在视口外，因此只证明后台输出并行，不算可见终端渲染压力验收。
- 先前 streaming-after-retry 出现坐标/松手/失焦稳定性失败，根因尚未确认；后续成功不能消除该失败。
- 已调整夹具将终端放到可见区，streaming-visible因CDP连接失败未取得结果。
- 大图片夹具：将既有截图用sips缩放为3840×2160，12个独立文件，不是AI生图。images-after首次面板数量等待超时，其余尝试CDP发现/连接超时，尚未验收图片加载和渲染，不计通过。
- 视频、AI在线流式输出、Windows尚未执行。不能据此启动无证据的第二阶段生产补丁。
- 失败记录和有限成功记录均保留；测试子应用由各脚本finally按自身PID关闭，没有操作用户应用或全局服务。

## 坐标异常定向调查
- 全局核对 CanvasStage、wheelPassthrough、setViewport、frameLatest 和 blurGuard；未修改生产代码。
- coordinates-3：完整记录视口写入堆栈、事件时间与isTrusted。该轮通过；64次写入均来自本次拖动及脚本恢复位置，未发现松手后拖动残留写入；没有trusted输入。
- coordinates-wheel：主动注入每帧deltaX=-7滚轮及松手后1次滚轮，保持原断言不变。捕获61次wheel事件及61次onWheel写入；releaseStable=false、releaseFinal=true、blurFinal=false。证明原“松手后视口必须完全不变”的测试会把独立滚轮操作也判成拖拽泄漏。
- 原始 streaming-after-retry 未记录事件或调用栈，故不能反推它一定是滚轮干扰；这只是已证实的同类失败机制，不是原始根因定论。也不能据此屏蔽正式用户的滚轮事件。
- 后续应对自然失败保留全链路trace，并区分拖动结束后自身回调残留与其他合法视口写入。当前不足以修改生产逻辑。
- 原main基线构建用同样受控滚轮输入（coordinates-wheel-baseline）复现完全相同的生命周期失败项。因此这一受控机制不是本次RAF优化独有的回归；注意基线worktree HEAD已合并，所运行的是此前保留的旧out构建，此项仅作机制对照，不作性能对照。

## 有限复测与连接对照（2026-09-21 21:42）
- 按约定仅运行3次 bounded-coordinate-1/2/3，全部在拖动开始前连接失败：1次CDP socket failed，2次HTTP发现超时；功能通过0，功能断言失败0，启动阻断3。未继续无限重跑。
- Node本地HTTP自环3/3通过（8/2/2ms），最小Electron隐藏窗口的CDP HTTP发现3/3通过（22/2/2ms）。
- 完整应用空白隔离profile：第一次CDP发现成功，随后2次超时；不依赖长历史或终端输出夹具即可出现。说明优先调查完整应用启动/调试响应，而非先归因为PTY输出或平移RAF。
- 抽样保存 /tmp/pan-cdp-app-sample.txt，日志 /tmp/pan-cdp-app.log；尚未解析到明确源代码阻塞点，不宣称根因已确认。采样后仅关闭本次诊断PID13859。
- 原坐标异常仍未确认，生产代码未改，未提交发布。

## 调试超时的原生阻塞点已定位
cdp-app-sample.txt 第86-97行显示：完整应用主线程全部863个采样均处于 SecKeychainAddGenericPassword → defaultKeychainUI → makeLoginAuthUI → AuthorizationCopyRights → xpc_connection_send_message_with_reply_sync。这是macOS钥匙串授权的同步等待，不是RAF计算或PTY输出占满CPU。最小Electron对照正常。
源码候选：src/main/secrets.ts:664 的 status() 同步调用 safeStorage.isEncryptionAvailable()；VaultGate等界面会请求secrets:status。但采样JS帧无符号，尚未证明就是该调用，也可能来自Chromium自身的钥匙串初始化。不得把候选调用当作已确认来源。
尝试添加仅方法名/调用栈的临时诊断入口时，被PreToolUse hook的Bad substitution语法错误阻断，入口未运行。未记录密钥或明文，未修改授权/加密逻辑，未提交。

## 系统HOME恢复后的验收
诊断wrapper捕获ENTER isEncryptionAvailable→status$1→IPC而无EXIT，与sample钥匙串授权等待一致。源码对应secrets.ts status()；SecretsPanel挂载refresh会主动查询。仅测试脚本改为保留系统HOME，ZDOTDIR/CODEX_HOME/CLAUDE_CONFIG_DIR和应用profile仍隔离，未改加密和生产代码。
- system-home-stream通过：终端可见，平移期间494字节，480事件60更新，p95约10.1ms，最终坐标和全部生命周期断言通过，截图已查看且无钥匙串弹窗。
- system-home-images初次仍因错误.pane选择器超时；诊断DOM证明12张3840×2160已加载。改用.civ-img后确认平移期12图片身份保持、60更新、最终X=-479、p95=9.5ms、无>50ms帧（image-identity-final-timing）。
- 图片完整脚本仍报告retained=false，其余release/blur均true；这是切split/canvas后的身份断言，App.tsx:446按viewMode条件挂卸CanvasStage，不能套用持久终端身份约定。保留失败不计整套通过；图片切换后恢复待补准确断言。截图已查看。
- 视频尚未执行；生产代码未修改，未提交/发版。

## 图片恢复与视频夹具验收
- images-restored通过：切split再回canvas，12个图片src集合一致、均complete且宽>=3840；终端仍坚持DOM身份保持，未放宽坐标断言。截图已查看。
- video-pan通过：1个1920×1080/30fps/8秒H.264视频+3闲置对话，合成中键拖动期间currentTime增加0.537572秒且paused=false，480事件60视口更新，p95约9.5ms、无>50ms帧，位置及松手/失焦断言通过。
- 视频由已有截图编码成静态画面夹具，不是AI生成；只验证播放时钟与拖动并行，不代表动态高码率/4K多视频压力。测试以DOM MouseEvent驱动，未验证原生pointerdown序列；useIdleVideoPause既有“点击节点外暂停”策略未改。切视图会卸载视频，最终截图播放回到0属既有行为，不宣称跨视图续播。
- 本轮未改生产代码，node --check及git diff --check通过；未重新构建生产代码，沿用已验收6500b85构建。未提交发布。原始偶发坐标异常仍未定因，Windows/真实用户画布仍未验收。

## 扩展验收收尾复核
video-pause-policy通过：视频本身纳入平移DOM身份检查；播放进度+0.531725秒，合成外部pointerdown后outsidePointerPauses=true，既有暂停策略保留。截图已查看。未声称原生设备输入全覆盖。
脚本错误采集保留最初failedExpression，避免诊断截图覆盖原错误位置。node --check、git diff --check通过；最终npm run check：3303总计、3284通过、19跳过、0失败，日志/tmp/pan-extended-final-check.log。
生产代码没有变化；脚本与本轮证据尚未提交。剩余边界：原始偶发坐标异常未定因；高码率动态多视频、Windows、真实大型用户画布、原生设备输入尚未覆盖。当前没有证据要求继续叠第二阶段性能补丁。

## 重跑本轮夹具
先在对应代码版本执行 npm run build。系统HOME保持不变，CLI配置和应用数据仍由脚本创建临时目录；不要把HOME指向不存在钥匙串的空目录。

```sh
EAS_PAN_STREAM=1 EAS_PAN_HEAVY=1 node scripts/verify-canvas-pan.mjs stream
sips -z 2160 3840 docs/verification/canvas-pan/stress-after.png --out /tmp/pan-large-fixture.png
EAS_PAN_IMAGE=/tmp/pan-large-fixture.png node scripts/verify-canvas-pan.mjs images
ffmpeg -hide_banner -loglevel error -loop 1 -i /tmp/pan-large-fixture.png -t 8 -vf scale=1920:1080 -r 30 -c:v libx264 -pix_fmt yuv420p /tmp/pan-existing-screenshot-video.mp4
EAS_PAN_VIDEO=/tmp/pan-existing-screenshot-video.mp4 EAS_PAN_NODES=4 node scripts/verify-canvas-pan.mjs video
```

这些是短时合成事件验收，不代表真实用户整机压力；不要同时启用图片和视频模式。调试trace会增加开销，不用新增带trace样本声称优化前后提升比例。图像夹具来自已存在截图，无AI生成或外部网络素材。

## 提交前独立审查
审查发现并修正两个防误通过问题：恢复启动精确节点数量校验、增加最终paneCount校验；视频currentTime起点移到同一拖动evaluate内mousedown之前，排除调试请求间隙。
修正后gate-stream(13实例)、gate-images(12图片)、reviewed-video(4实例)实机脚本全部通过；视频拖动期间进度+0.506235秒。node --check与git diff --check通过。此前全量check3284/19/0覆盖生产代码，之后仅修验收断言，未宣称再次跑全量。原始未定因事项与平台边界不变。
