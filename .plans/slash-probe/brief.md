# 实测：headless 模式下哪些 slash 命令真的能用

本项目的 AI 对话窗口用这套参数跑 Claude（见 `src/main/agentChat/adapters/claude.ts`）：

```
claude -p --input-format stream-json --output-format stream-json --verbose \
       --strict-mcp-config --mcp-config <配置> --include-hook-events \
       --include-partial-messages --append-system-prompt <...>
```

## 已知事实（别重复验）

- `/help` → `/help isn't available in this environment.`
- **不存在的命令完全静默** —— 消息发出去了、轮次涨了，界面上一个字都没有
- 软件自己在用 `/compact`、`/model`、`/effort`，这三条是有效的
  （回执被 `src/main/agentChat/slashSilence.ts` 有意吞掉了，别被它迷惑）

## 要你做的

自己起子进程实测。stdin 的消息格式照抄 `src/main/agentChat/session.ts` 里写 stdin 那段
（`--input-format stream-json` 要求每行一个 JSON）。逐条试：

`/clear` `/compact` `/model` `/effort` `/cost` `/context` `/status` `/agents` `/mcp`
`/init` `/review` `/memory` `/config` `/doctor` `/resume` `/rewind` `/usage`
再加一个用户自定义 skill 名（`~/.claude/skills/` 下随便挑一个轻量的，比如 `/open-app-verify`）。

## 产出格式

一张表：`命令 | 能不能用 | 它回了什么 | 判据`。
「能用」要说清是**真的执行了**还是**只是没报错**。

## 边界

- **只读不改代码。**
- 每条命令试一次就够，别在长对话上烧 token。
- 试不出来的写「没测出来」，别猜。
