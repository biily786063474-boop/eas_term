#!/usr/bin/env node
/**
 * 提交即复盘 —— Claude Code PostToolUse 钩子脚本
 *
 * 职责:当 Bash 跑了 git commit 后,扫描本次提交【新增的代码行】,
 *       命中专业名词词典(交互行为 / 动效 / UI视觉),把新名词沉淀进
 *       docs/knowledge-manual.html,并向用户输出一条简报。
 *
 * 特性:**这个脚本不调用任何模型,零 token**。扫描/匹配/渲染手册全是本地字符串活。
 *       任何异常都静默 exit 0,绝不打断用户的提交流程。
 *
 * 2026-08-31:「自动补全词条」那半拆掉了 —— 它在你没看的时候花钱,归类只能靠猜,
 *       还产不出 hover 要看的示意图,写出来的多是点开什么都没有的空壳。
 *       想加一条辞典改成主动调 skill,每一步停下来给你确认(见 docs/辞典改造方案.html)。
 *       ~/.eas/dict-pending.json 和 dict-sink.json 不再读写,已有文件留着不管 ——
 *       删掉它们等于动用户的数据,而留着没有任何代价。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 说明:不再弹窗/跳页。仅当有【新增】名词时,通过 additionalContext 让大模型在回复末尾
//       不起眼处顺带提一句 + 附手册链接(见 main 末尾)。没有新增则完全安静。

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function main() {
  const hook = safeJson(readStdin()) || {};
  const cmd = hook?.tool_input?.command || '';

  // 便宜的预筛:命令看起来得像 git commit(真正判据在下面的 HEAD 比对)
  if (!/\bgit\b[^\n]*\bcommit\b/.test(cmd)) process.exit(0);

  // 定位 git 仓库根
  const cwd = hook?.cwd || process.cwd();
  let root;
  try { root = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch { process.exit(0); }
  if (!root) process.exit(0);

  // 当前 HEAD
  let head;
  try { head = git(root, ['rev-parse', 'HEAD']).trim(); } catch { process.exit(0); }

  // 状态文件:记录上次处理到哪个提交 + 已沉淀的名词
  const docsDir = join(root, 'docs');
  const statePath = join(docsDir, 'knowledge-data.json');
  let state = { lastHash: '', documented: [] };
  if (existsSync(statePath)) state = safeJson(readFileSync(statePath, 'utf8')) || state;

  // 真正判据:HEAD 没变就什么都不做(regex 只是预筛,避免 echo "git commit" 之类误触发)
  if (state.lastHash === head) process.exit(0);

  // 取本次提交的新增行(--unified=0 只要变更行,--format= 去掉提交头)
  // 排除工具自身文件,否则手册/词典里的关键词会自我命中(如把手册 commit 进 docs/ 后再提交)
  const EXCLUDE = [
    ':(exclude)docs/knowledge-manual.html',
    ':(exclude)docs/knowledge-data.json',
    ':(glob,exclude)**/term-dictionary.json',
    ':(glob,exclude)**/seed-terms.json',
    ':(glob,exclude)**/research/*.json',
    ':(glob,exclude)**/scan-commit.mjs',
    ':(glob,exclude)**/build-dictionary.mjs',
    ':(glob,exclude)**/diagrams/*.svg',
  ];
  let diff = '';
  try {
    diff = git(root, ['show', head, '--no-color', '--unified=0', '--format=', '--', '.', ...EXCLUDE]);
  } catch { process.exit(0); }
  const addedRaw = diff.split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1))
    .join('\n');
  const added = addedRaw.toLowerCase();

  // 加载词典并匹配
  const dict = loadDict();
  if (!dict || !Array.isArray(dict.terms)) process.exit(0);

  const isWord = s => /^[a-z0-9]+$/.test(s);
  const hit = t => (t.keywords || []).some(kw => {
    const k = String(kw).toLowerCase();
    // 纯英文单词:连字符感知边界,裸词不命中 backdrop-filter 里的 filter
    if (isWord(k)) return new RegExp(`(?<![\\w-])${k}(?![\\w-])`).test(added);
    return added.includes(k);                                     // 含符号/中文的按子串
  });

  const matched = dict.terms.filter(hit);

  const seen = new Set(state.documented.map(d => d.id));
  const fresh = matched.filter(t => !seen.has(t.id));

  // 2026-08-31：自动沉淀那半拆掉了,这里只剩「本次用到了哪些已收录的概念」一件事。
  // 留着数组形态而不是收成一个字符串:输出协议是 additionalContext 一段文本,
  // 以后再加别的简报时不用重新改结构。
  const parts = [];

  if (fresh.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    for (const t of fresh) state.documented.push({ id: t.id, commit: head.slice(0, 8), firstSeen: today });
  }

  // 指针无论如何都要更新,否则下次提交会把这一版重扫一遍。
  // **必须排在 renderManual 前面**:建 docs/ 目录的是 persist,
  // 反过来的话在没有 docs/ 的仓库里 renderManual 会 ENOENT。
  state.lastHash = head;
  persist(docsDir, statePath, state);

  if (fresh.length > 0) {
    // 单独 try:手册渲染失败不该把下面的补全指令一起带走。
    // 这两件事只是碰巧同一个进程,没有任何依赖关系。
    try { renderManual(root, docsDir, dict, state); } catch { /* 手册没渲染出来,不影响其它 */ }
    const manualPath = join(docsDir, 'knowledge-manual.html');
    parts.push(
      `[知识手册·后台沉淀] 本次提交新收录 ${fresh.length} 个专业名词:${fresh.map(t => t.zh).join('、')}` +
      `(累计 ${state.documented.length})。请仅在你本条回复的最末尾、用一行极简短、不起眼的口吻顺带提一下,` +
      `并附手册链接 ${manualPath};不要展开、不要另开页面、不合适可略过。`
    );
  }

  // 没有新收录 → 完全安静:不弹窗、不发任何消息、不花任何 token。
  if (!parts.length) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: parts.join('\n') },
  }));
  process.exit(0);
}

function loadDict() {
  for (const name of ['term-dictionary.json', 'dictionary-bundle.json']) {
    try {
      const d = safeJson(readFileSync(join(HERE, name), 'utf8'));
      if (d && Array.isArray(d.terms)) return d;
    } catch { /* 找下一个 */ }
  }
  return null;
}

function persist(docsDir, statePath, state) {
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderManual(root, docsDir, dict, state) {
  const byId = Object.fromEntries(dict.terms.map(t => [t.id, t]));
  const catZh = { interaction: '交互行为', motion: '动效', visual: 'UI视觉' };
  const items = state.documented.map(d => byId[d.id]).filter(Boolean);

  // 图解来源:bundle 里 SVG 已内联,直接用;否则优先 t.diagram 指定的文件,
  // 再按约定找 diagrams/<id>.svg(丢个同名文件即自动挂上)
  const svgOf = t => {
    if (t.svg) return t.svg;
    for (const name of [t.diagram, `${t.id}.svg`]) {
      if (!name) continue;
      try { return readFileSync(join(HERE, 'diagrams', name), 'utf8'); } catch { /* 找下一个 */ }
    }
    return '';
  };

  const counts = { interaction: 0, motion: 0, visual: 0 };
  items.forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });

  const cards = items.map(t => {
    const svg = svgOf(t);
    return `
    <article class="card${svg ? '' : ' no-diagram'}" data-cat="${t.category}">
      <header>
        <span class="cat cat-${t.category}">${catZh[t.category] || ''}</span>
        <h2>${esc(t.zh)} <em>${esc(t.en)}</em></h2>
      </header>
      ${svg ? `<div class="diagram">${svg}</div>` : ''}
      <p class="logic">${esc(t.logic)}</p>
    </article>`;
  }).join('\n');

  const updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>专业名词知识手册</title>
<style>${STYLE}</style>
</head><body>
<header class="top">
  <h1>专业名词知识手册</h1>
  <p class="sub">交互行为 · 动效 · UI 视觉 &nbsp;|&nbsp; 每次提交自动沉淀 &nbsp;|&nbsp; 更新于 ${updated}</p>
  <div class="filters">
    <button class="f active" data-f="all">全部 ${items.length}</button>
    <button class="f" data-f="interaction">交互行为 ${counts.interaction}</button>
    <button class="f" data-f="motion">动效 ${counts.motion}</button>
    <button class="f" data-f="visual">UI视觉 ${counts.visual}</button>
  </div>
</header>
<main class="grid">
${cards || '<p class="empty">还没有沉淀名词。提交一次包含专业名词的代码试试。</p>'}
</main>
<script>${SCRIPT}</script>
</body></html>`;

  writeFileSync(join(docsDir, 'knowledge-manual.html'), html);
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#16181c;color:#c8ccd2;font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:34px 20px 72px}
.top{max-width:1120px;margin:0 auto 26px}
h1{font-size:22px;font-weight:600;color:#eef1f5;letter-spacing:.4px}
.sub{color:#767b84;font-size:12.5px;margin-top:7px}
.filters{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
.f{background:#20232a;border:1px solid #2b2f37;color:#a4a9b2;padding:6px 15px;border-radius:20px;font-size:12.5px;cursor:pointer;transition:.15s}
.f:hover{border-color:#3a3f49;color:#d5d9df}
.f.active{background:#2f6bd8;border-color:#2f6bd8;color:#fff}
.grid{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:#1c1f25;border:1px solid #262a32;border-radius:14px;padding:18px;transition:.18s}
.card:hover{border-color:#333947;transform:translateY(-2px)}
.card header{display:flex;flex-direction:column;gap:9px;margin-bottom:12px}
.cat{align-self:flex-start;font-size:11px;padding:2px 9px;border-radius:6px;font-weight:500}
.cat-interaction{background:#1e3a5f;color:#7cb2ff}
.cat-motion{background:#4a2f14;color:#f0b070}
.cat-visual{background:#2f2450;color:#b79bf0}
.card h2{font-size:16px;font-weight:600;color:#eef1f5}
.card h2 em{font-style:normal;font-size:12.5px;color:#767b84;font-weight:400;margin-left:6px}
.diagram{background:#14161a;border:1px solid #23262d;border-radius:10px;padding:10px;margin-bottom:12px}
.diagram svg{width:100%;height:auto;display:block}
.logic{color:#a7adb6;font-size:13px}
.empty{color:#767b84;grid-column:1/-1;text-align:center;padding:48px}
`;

const SCRIPT = `
document.querySelectorAll('.f').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('.f').forEach(function(x){x.classList.remove('active')});
    b.classList.add('active');
    var f=b.dataset.f;
    document.querySelectorAll('.card').forEach(function(c){
      c.style.display=(f==='all'||c.dataset.cat===f)?'':'none';
    });
  };
});
`;

try { main(); } catch { process.exit(0); }
