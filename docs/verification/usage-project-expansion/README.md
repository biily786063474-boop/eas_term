# 项目用量原地展开验收 · 2026-09-21

源码工作树：`/private/tmp/eas-timeline-integrate`（main，基线 `6500b85`）。当前会话原目录的旧分支没有用量页，未向旧分支复制新版本文件。

## 复现与回归

1. `npm run build`
2. `node scripts/verify-usage-drawer.mjs`：独立临时 userData，235 轮合成账本，无真实账单或聊天数据。
3. `node scripts/verify-usage-project-expansion.mjs`：连接上述实例的 CDP 9452；测试重载页面后从右侧更多入口打开用量页。

修改前失败：点击项目 B，整体 Token 从 945.41 万变成 486.43 万、趋势被替换、总分页从 3 页变成 2 页。断言 `project expansion must not filter global metrics/trend/page` 失败。

修改后通过：
- 点击项目在项目卡片下方显示指标及会话/每轮明细；总览、整体趋势、总分页不变。
- 项目轮次 ID 与该项目独立查询一致，不混入其他项目。
- 项目分页独立，可同时展开多个项目。
- 切换今天时保持项目展开，详情页码回到第一页，记录按新时间范围查询。
- Enter 收起、再次点击展开；刷新不收起已有会话/轮次。
- 每轮详细字段正常显示，未知用量保留“未上报”，没有补零。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- 用量主进程、趋势与抽屉布局相关测试：24 通过、0 失败（Node 存在既有 MODULE_TYPELESS_PACKAGE_JSON 提示）。
- 上述交互回归脚本：通过。
- 已目视检查 `expanded.png`、`today.png`、`round.png`：右侧原位置展开，内容和分页正常显示。

未验证：Windows 真机；供应商线上账单。未安装或替换 `/Applications/Eas-Term.app`。

## 追加验收：会话和每轮两层均默认 3 条

用户于同日确认“两层都只显示 3 条”。新增两层独立滚动容器，隐藏的是超出视窗的区域，不删除本页记录；分页仍在外侧。回归先在旧构建失败于 `both levels have a dedicated scroll container`，再实现。

typecheck、build、24 项相关测试及扩展交互脚本均通过：检查项目和总览会话列表第三条完整可见、第四条位于视窗外；轮次列表相同；两层均能滚动至末条；展开单轮不增高轮次容器。目视证据 `three-rows.png`（会话内前三轮及外层前三会话）、`today.png`、`round.png`。

体验实例使用脱离工具会话的后台启动器，日志 `/tmp/eas-usage-experience.log`，CDP 9452，临时独立 userData。不要用全局 kill；关闭时只处理核对过的所属 Electron PID。

## 追加验收：明细弱于数据、独立分区

沿用主题变量给明细区增加中性底色、顶部分隔线与留白；标题取消粗体、正文采用次级文字，指标字号/字重保持不变。总览和项目明细同步应用，三条限高逻辑不变。新断言在修改前失败于 `detail heading must be subordinate to metrics`；修改后重新验证视觉层级及原有交互，并检查实际截图。

## 追加验收：整个明细区默认折叠

项目及总览的“会话 → 每轮明细”区域均改为原生 details，初次只有标题行，点击展开/收起，内层三条滚动保留。先复现测试失败 `both detail regions start collapsed`（旧节点为 DIV），实现后检查展开交互、列表滚动以及收起后内容不可见；目视证据 `collapsed.png`。
