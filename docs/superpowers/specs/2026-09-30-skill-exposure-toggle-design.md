# skill 默认暴露开关 · 设计稿（2026-09-30）

分支 `feat/skill-exposure-20260930`（基于 origin/main `02be79ad`）。

## 要解决什么

现在每个 skill 的 name + description 都会进模型上下文，由模型自己判断要不要读全文（渐进式检索）。
skill 装多了，这段清单本身就占一大块上下文，还会让模型在不相干的任务里误触发。

需求：skill 管理面板里加开关——

- **开（默认，= 现状）**：name + description 暴露给模型，模型可自主检索
- **关**：模型看不到这个 skill；只有用户在输入框里主动点名时才生效

## 实测：两家 CLI 都有原生手段（2026-09-30，本机探针）

探针：临时目录里放一个 `probe-skill`，问模型「清单里有没有 probe」，再显式点名看能否执行。
全程只用现有登录，不写 `~/.claude` / `~/.codex`。

### Claude Code 2.1.285 —— `skillOverrides` 设置

schema 原文：`"name-only"` lists the skill without its description; `"user-invocable-only"` hides it
from the model but keeps /name; `"off"` hides it from both. Absent = on.（键 = skill 名）

| 情况 | 清单里有 probe | 显式 `/probe-skill` |
|---|---|---|
| 无覆盖 | 有 | — |
| `--settings '{"skillOverrides":{"probe-skill":"user-invocable-only"}}'` | **无** | — |
| 项目 `.claude/settings.local.json` 写同样内容 | **无** | **PROBE-OK** |

结论：**按会话走 `--settings` 就生效，不用改用户的 settings.json。**

⚠️ adapters/claude.ts 已经在用一次 `--settings`（`opts.writeGuardSettings`，只读角色的写闸）。
**实测：两次 `--settings` 是后者整份替换前者**（隐藏在前 → 清单里仍有 probe；隐藏在后 → 无）—— **必须合并进同一份文件**，否则开了写闸的角色会静默丢掉 skill 开关（或反过来丢写闸）。

### Codex 0.159.0 —— 两条路，性质不同

| 手段 | 清单里有 probe | 显式 `$probe-skill` |
|---|---|---|
| 无覆盖 | 有 | — |
| `-c skills.config=[{name=…,enabled=false}]` | **无** | 输出 PROBE-OK，但 `--json` 显示是**模型自己 rg 搜到 SKILL.md 再 cat**，不是原生调用 |
| skill 目录里 `agents/openai.yaml` 写 `policy.allow_implicit_invocation: false` | **无** | **PROBE-OK，零工具调用（原生）** |

- `enabled=false` = 彻底关掉；原生 `$name` 失效，只能靠路径点名
- `openai.yaml` 才是原生的「隐藏但可点名」，但它**要往用户的 skill 目录里写文件**——违反 0.4.25 定下的「禁用只写清单不动文件」

## 关键发现：输入框的「主动暴露」已经存在，而且两家通用

`SlashPicker.tsx` 已有「技能」分类；选中后插入的是
`使用技能「name」（<path>/SKILL.md）`（`composerSources.ts:33`）——**给的是文件路径，模型直接读**。
这条路不依赖 CLI 的 skill 注册，所以 Claude 的 `user-invocable-only` 和 Codex 的 `enabled=false` 下都能用。

## 方案

### 数据

`<userData>/skills.json` 加两个字段（`saveConfig` 是 patch 语义，不冲掉别的）：

```jsonc
{
  "exposeByDefault": true,          // 全局开关，缺省 true = 现状
  "exposure": { "<skill 绝对路径>": "on" | "off" }   // 单个 skill 的例外，缺省跟随全局
}
```

id 仍用 `skill.path`（与分类、禁用一致）。

### 起会话时注入（只影响 Eas-Term 起的 AI 对话会话）

| | 注入 | 落点 |
|---|---|---|
| Claude | 被关的 skill → `skillOverrides[name] = "user-invocable-only"` | **并入** writeGuard 那份 `--settings` 文件（一份文件一个参数） |
| Codex | 被关的 skill → `{path=…,enabled=false}` | **并入** 角色绑定已有的 `codexSkillsConfigArg(skillsOff)`（同一个 `-c skills.config`，两个会互相覆盖） |
| omp | 第一期不做 | 界面标注「omp 暂不支持」 |

**永不隐藏**：Eas-Term 自己注入的 skill（`eas-term`、`team-research` 等能力指引）——关掉会让模型不知道自己有画布/生图能力。

### 界面（skill 管理面板）

- 面板头：「默认让 AI 自动发现 skill」开关 + 一句说明（关闭后只在你用 `/` 点名时生效）
- 每行：一个小开关，默认跟随全局，改过的显示「已单独设置」可复位
- 输入框 `/` 菜单：被关的 skill 照常出现（这正是唯一入口），加一个「需点名」的小标记

## 已知限制（要写进界面说明）

1. **只对 Eas-Term 起的 AI 对话生效**。用户在 Eas-Term 终端里手敲 `claude` / `codex`、或在别处用 CLI，不受影响（第二期可评估 PTY 注入）。
2. **Claude 按名字、Codex 按路径**。两个目录里同名的 skill，Claude 侧会被一起关掉。
3. **改了开关要新开会话才生效**（参数在起进程时定）；已开的会话在面板上提示。
4. Codex 关闭后原生 `$name` 不可用，只能走 `/` 菜单（路径点名）。
5. 插件 skill（`plugin:skill` 命名空间）的 `skillOverrides` 键格式未实测 —— 第一期只管面板扫描到的普通 skill 目录。

## 验收

- 单测：合并 `--settings` 文件（写闸 × skill 开关四种组合）、Codex `-c` 合并（角色 skillsOff × 用户关闭，去重）、豁免名单、配置缺省值
- 真机：面板关掉某 skill → 新开 Claude 与 Codex 对话各问一次清单（看不到）→ 用 `/` 菜单点名（能用）→ 打开开关再开会话（看得到）
- 回归：只读角色的写闸仍生效（开关关着时也要生效）
