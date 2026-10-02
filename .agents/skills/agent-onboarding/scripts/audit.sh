#!/usr/bin/env bash
# 把 Eas-Term 五个 agent 注入面在**这台机器上的当前实况**打出来。
#
# 为什么要有这个：代码里写的落点和盘上的现实脱节过。接新 agent 前先看一眼真实状态，
# 别凭 grep 源码推断。**全程只读，不写任何文件。**
set -uo pipefail
H="$HOME"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[90m·\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }

size(){ [ -f "$1" ] && wc -c < "$1" | tr -d ' ' || echo 0; }
has(){ [ -e "$1" ]; }

echo
echo "═══ 面 1 · 常驻规则（托管区）═══"
CODEX_AG="$H/.codex/AGENTS.md"
if has "$CODEX_AG"; then
  total=$(size "$CODEX_AG")
  region=$(awk '/<!-- eas-term:begin/,/<!-- eas-term:end -->/' "$CODEX_AG" | wc -c | tr -d ' ')
  pct=$(( total > 0 ? region * 100 / total : 0 ))
  ok "~/.codex/AGENTS.md  全文 ${total} 字符，我们的托管区 ${region} 字符（${pct}%）"
  # 只在托管区本身过大时才报警。文件里只有我们那一段时 pct 必然是 100%，那不是问题
  [ "$region" -gt 1500 ] && warn "托管区 ${region} 字符 > 1500 —— 多半是把正文塞进常驻区了，见纪律 2"
  [ "$pct" -gt 60 ] && [ "$total" -gt 2000 ] &&
    warn "用户自己也写了内容，而我们占了 ${pct}% —— 他在这个 CLI 里干任何事都要先付这份 token"
  awk '/<!-- eas-term:begin/,/<!-- eas-term:end -->/' "$CODEX_AG" | grep -c '^\*\*' | xargs -I{} echo "     触发条件 {} 条（各占一行才对，合并写会让模型漏掉能力）"
  has "$CODEX_AG.eas-backup" && ok "备份在：AGENTS.md.eas-backup" || warn "没有 .eas-backup —— 写之前应该备份的"
else
  no "~/.codex/AGENTS.md 不存在（Codex 没装，或还没同步过规则）"
fi
no "Claude Code 无常驻托管区（靠 skill 的 description 按需加载，这是对的）"

echo
echo "═══ 面 2 · 技能包正文 ═══"
CS="$H/.claude/skills/eas-term"
if has "$CS"; then
  ok "~/.claude/skills/eas-term/  $(ls -1 "$CS" | wc -l | tr -d ' ') 个文件"
  for f in "$CS"/*; do printf '     %-22s %s 字符\n' "$(basename "$f")" "$(size "$f")"; done
else
  no "~/.claude/skills/eas-term/ 不存在"
fi
EA="$H/.eas/agent"
if has "$EA"; then
  ok "~/.eas/agent/  $(ls -1 "$EA" | wc -l | tr -d ' ') 个文件（Codex 的按需读落点）"
  for f in "$EA"/*; do printf '     %-22s %s 字符\n' "$(basename "$f")" "$(size "$f")"; done
else
  no "~/.eas/agent/ 不存在"
fi
# 这两处装的应该是「同一批内容的两种形态」，不是同一个文件的两份拷贝
if has "$CS/SKILL.md" && has "$EA/canvas.md"; then
  a=$(size "$CS/SKILL.md"); b=$(size "$EA/canvas.md")
  [ "$a" = "$b" ] && warn "SKILL.md 与 canvas.md 大小相同（${a}）—— 整份 SKILL.md 被原样灌进了 Codex 侧，正是纪律 2 说的那个坑"
fi

echo
echo "═══ 面 3 · MCP 工具 ═══"
CJ="$H/.claude.json"
if has "$CJ"; then
  n=$(node -e "try{const c=require('$CJ');const m=c.mcpServers||{};const k=Object.keys(m).filter(x=>/eas-term|bizone/.test(x));console.log(k.join(' ')||'（无我们的条目）')}catch(e){console.log('解析失败: '+e.message)}" 2>/dev/null)
  ok "~/.claude.json  mcpServers 里我们的条目：$n"
  has "$CJ.eas-backup" && ok "备份在：.claude.json.eas-backup" || no "无 .eas-backup（还没改过就正常）"
else
  no "~/.claude.json 不存在"
fi
CT="$H/.codex/config.toml"
if has "$CT"; then
  ok "~/.codex/config.toml  我们的段：$(grep -cE '^\[mcp_servers\.(eas-term|bizone)' "$CT" 2>/dev/null || echo 0) 个"
  grep -n '^\[mcp_servers\.' "$CT" 2>/dev/null | sed 's/^/     /'
else
  no "~/.codex/config.toml 不存在"
fi

echo
echo "═══ 面 4 · 提交钩子（侵入性最高）═══"
CSJ="$H/.claude/settings.json"
if has "$CSJ"; then
  n=$(node -e "try{const c=require('$CSJ');const h=(c.hooks&&c.hooks.PostToolUse)||[];const s=JSON.stringify(h);console.log(/scan-commit/.test(s)?'已装':'未装')}catch(e){console.log('解析失败')}" 2>/dev/null)
  ok "~/.claude/settings.json  PostToolUse 里我们的钩子：$n"
else
  no "~/.claude/settings.json 不存在"
fi
has "$H/.codex/hooks.json" && ok "~/.codex/hooks.json 存在" || no "~/.codex/hooks.json 不存在"

echo
echo "═══ 面 5 · 库内说明书 ═══"
WJ="$H/Library/Application Support/Eas-Term/wiki.json"
if has "$WJ"; then
  # 字段名是 path，不是 root —— paths.ts:101 读的就是这个
  root=$(node -e "try{console.log(require('$WJ').path||'')}catch(e){}" 2>/dev/null)
  if [ -n "$root" ] && [ -d "$root" ]; then
    ok "当前知识库：$root"
    has "$root/.eas-wiki.json" && ok "自定义分类库（有 .eas-wiki.json）" || no "内置分类库（无 .eas-wiki.json，走写死的八目录）"
    for f in CLAUDE.md AGENTS.md index.md START-HERE.md 从这里开始.md log.md; do
      has "$root/$f" && printf '     %-18s %s 字符%s\n' "$f" "$(size "$root/$f")" \
        "$(grep -q 'eas-term:wiki-schema:begin' "$root/$f" 2>/dev/null && echo '  [有围栏]' || echo '')"
    done
  else
    no "wiki.json 在，但没绑定库（或路径已失效）"
  fi
else
  no "还没配过知识库"
fi

echo
echo "═══ CLI 探测 ═══"
for b in claude codex gemini cursor-agent opencode; do
  p=$(command -v "$b" 2>/dev/null) && ok "$b  →  $p" || no "$b 未装"
done
echo
# 这个脚本只覆盖面 1-5（它们都往用户的全局配置里写东西，盘上查得到状态）。
# 面 6「会话驱动」不写任何全局文件，没有盘上状态，得单独跑。
echo "面 6（会话驱动）不在本脚本范围内 —— 它不写全局配置、盘上没状态可查："
echo "  node .claude/skills/agent-onboarding/scripts/check-adapter.mjs"
echo
echo "接新 agent 前，把上面每一面都对着 SKILL.md 的「步骤」过一遍。"
echo
