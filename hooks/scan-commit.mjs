#!/usr/bin/env node
/**
 * 提交即复盘 —— Claude Code PostToolUse 钩子脚本
 *
 * 职责:当 Bash 跑了 git commit 后,扫描本次提交【新增的代码行】,
 *       命中专业名词词典(交互行为 / 动效 / UI视觉),把新名词沉淀进
 *       docs/knowledge-manual.html,并向用户输出一条简报。
 *
 * 特性:纯脚本,不调用任何模型 —— 零 token 消耗。
 *       任何异常都静默 exit 0,绝不打断用户的提交流程。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 用户自建词库:这个脚本发现「用了但词典没收录」的术语时沉淀到这里,
// Eas-Term 的名词词典启动时把它和内置词库合并显示(带「自建」徽章)。
// 放 home 而不是项目里:词是跟人走的经验,换项目不该从零开始。
const USER_DICT = join(homedir(), '.eas', 'dict-user.json');
const USER_DICT_MAX = 500;   // 上限:再多就不是「随手查」而是负担了

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
  const candidates = detectCandidates(addedRaw, dict);   // 零 token 启发式:发现"用了但没收录"的疑似术语

  // 沉淀必须发生在下面那个早退之前。绝大多数提交都命不中【新】词典条目,
  // 要是放到早退之后,这些提交里发现的新术语就全丢了 —— 而那恰恰是最值得留下的东西。
  // (这也是"沉淀"这件事以前从未真正发生过的原因:候选词只被拼进一句提示文本,从不落盘)
  const sunk = sinkCandidates(candidates, root, head);

  const seen = new Set(state.documented.map(d => d.id));
  const fresh = matched.filter(t => !seen.has(t.id));

  // 没有【新】名词 → 完全安静:更新指针即退出,不弹窗、不发任何消息。
  if (fresh.length === 0) {
    state.lastHash = head;
    persist(docsDir, statePath, state);
    process.exit(0);
  }

  // 有新增:记录 + 更新指针 + 重渲染手册(仅写盘,不再自动打开页面)
  const today = new Date().toISOString().slice(0, 10);
  for (const t of fresh) state.documented.push({ id: t.id, commit: head.slice(0, 8), firstSeen: today });
  state.lastHash = head;
  persist(docsDir, statePath, state);
  renderManual(root, docsDir, dict, state);

  // 仅在【有新增】时发一条极简后台提示进模型上下文(additionalContext),
  // 让大模型在本条回复的最末尾、不起眼处顺带提一句 + 附手册链接。罕见触发,token 极小。
  const names = fresh.map(t => t.zh).join('、');
  const manualPath = join(docsDir, 'knowledge-manual.html');
  const cand = sunk.length ? `;另沉淀 ${sunk.length} 个新词到自建词库:${sunk.map(t => t.en).join('、')}` : '';
  const ctx =
    `[知识手册·后台沉淀] 本次提交新收录 ${fresh.length} 个专业名词:${names}${cand}(累计 ${state.documented.length})。` +
    `请仅在你本条回复的最末尾、用一行极简短、不起眼的口吻顺带提一下,并附手册链接 ${manualPath};` +
    `不要展开、不要另开页面、不合适可略过。`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ctx },
  }));
  process.exit(0);
}

// 超常见 CSS 属性:即使没收录也不当候选,避免刷屏
const COMMON_CSS = new Set([
  'background-color','background-image','background-size','background-position','background-repeat','background-clip',
  'border-radius','border-color','border-width','border-style','border-top','border-bottom','border-left','border-right',
  'font-size','font-weight','font-family','font-style','line-height','letter-spacing',
  'text-align','text-decoration','text-transform','text-overflow','text-shadow','white-space','box-sizing',
  'align-items','align-self','align-content','justify-content','justify-items','justify-self',
  'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
  'grid-template-columns','grid-template-rows','grid-template-areas','grid-auto-flow','grid-auto-rows','grid-column','grid-row',
  'column-gap','row-gap','max-width','min-width','max-height','min-height',
  'margin-top','margin-bottom','margin-left','margin-right','margin-block','margin-inline',
  'padding-top','padding-bottom','padding-left','padding-right','padding-block','padding-inline',
  'list-style','overflow-x','overflow-y','vertical-align','word-break','word-wrap','pointer-events','z-index',
]);

/**
 * 零 token 启发式候选探测:发现"代码里用了、词典却没收录、长得像专业术语"的 token。
 *  规则1:CSS 属性位的连字符词(scroll-snap-type: ...)—— 排除超常见属性与已收录。
 *  规则2:PascalCase 的 Web API(IntersectionObserver、startViewTransition)。
 * 只作提示,不写入手册。最多 5 个。
 */
function detectCandidates(addedRaw, dict) {
  const lower = addedRaw.toLowerCase();
  const covered = new Set();
  for (const t of dict.terms) {
    covered.add(String(t.id).toLowerCase());
    if (t.en) covered.add(String(t.en).toLowerCase());
    for (const kw of (t.keywords || [])) covered.add(String(kw).toLowerCase());
  }
  const found = new Map();  // lower -> 展示形态

  // 规则1:CSS 属性
  const propRe = /(?:^|[;{\s"'`])([a-z]{2,}(?:-[a-z]{2,}){1,3})\s*:/g;
  let m;
  while ((m = propRe.exec(lower)) !== null) {
    const p = m[1];
    if (COMMON_CSS.has(p) || covered.has(p)) continue;
    found.set(p, p);
  }

  // 规则2:Web API(在原始大小写文本上匹配)
  const apiRe = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g;
  const HINT = /(Observer|Animation|Transition|Timeline|Element|Api|Scheduler|Gesture|Snapshot)$/;
  while ((m = apiRe.exec(addedRaw)) !== null) {
    const id = m[1];
    const low = id.toLowerCase();
    if (covered.has(low)) continue;
    if (HINT.test(id) || id.startsWith('start') || id.startsWith('request')) found.set(low, id);
  }

  return [...found.values()].slice(0, 5);
}

/**
 * 词典从哪来：两种形态都认，找到哪个用哪个。
 *   · term-dictionary.json   —— 本项目的源词库，配图是 diagrams/ 下的独立 SVG 文件
 *   · dictionary-bundle.json —— 打包产物，SVG 已内联进每个词条
 *
 * 之所以两种都认：这个脚本会被原样复制进 Eas-Term 随包分发，
 * 那边只带 bundle（一个文件，不用再拖 968KB 的 diagrams 目录）。
 * 让同一份代码在两处都能跑，比维护两个分叉的版本安全得多
 * —— 分叉的下场是改了一边忘了另一边，过段时间就诈尸。
 */
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

/**
 * 把候选新词沉淀进 ~/.eas/dict-user.json。
 *
 * 只写 en/keywords —— zh 和 logic 留空,由用户(或他的 agent)按需补。
 * 让脚本去生成解释文本要花 token,而这个 hook 的立身之本就是零 token。
 *
 * 返回真正新增的词,没有则返回空数组。任何异常都吞掉:这是个后台增值动作,
 * 绝不能因为它让用户的 commit 流程出问题。
 */
function sinkCandidates(candidates, root, head) {
  if (!candidates.length) return [];
  try {
    const dir = dirname(USER_DICT);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cur = (existsSync(USER_DICT) && safeJson(readFileSync(USER_DICT, 'utf8'))) || {};
    const terms = Array.isArray(cur.terms) ? cur.terms : [];
    const have = new Set(terms.map(t => String(t.id).toLowerCase()));
    const project = root.split('/').filter(Boolean).pop() || '';
    const today = new Date().toISOString().slice(0, 10);

    const added = [];
    for (const c of candidates) {
      const id = String(c).toLowerCase();
      if (have.has(id)) continue;
      have.add(id);
      const t = {
        id,
        zh: '',                       // 留空 = 界面回落显示 en
        en: String(c),
        category: 'user',
        keywords: [String(c)],
        logic: '',                    // 留空 = 界面提示「还没写解释」
        svg: '',
        firstSeen: today,
        project,
        commit: String(head).slice(0, 8),
      };
      terms.push(t);
      added.push(t);
    }
    if (!added.length) return [];

    // 超上限时丢最老的,而不是拒绝新词——新发现的通常更相关
    const kept = terms.slice(-USER_DICT_MAX);
    writeFileSync(USER_DICT, JSON.stringify({ version: 1, terms: kept }, null, 2));
    return added;
  } catch {
    return [];   // 写不进去就当没这回事,不影响提交
  }
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
