/* 像素团子（Eas-Term 吉祥物）· 官网版
 *
 * 逐行移植自应用源码 src/renderer/src/ui/mascot/dangoGrid.ts（v17，用户逐轮定稿），
 * 形状规则一个格子都没改。移植的原因：那份是 TS + React，官网是零依赖静态站。
 * 设计稿：docs/design/mascot/2026-09-28-island-dango.html
 *
 * 规矩（照抄源文件的注释，别破坏）：
 *   · 单色 —— 只输出实心格，镂空处（眼睛、嘴）是真透明，fill=currentColor 跟着文字色走
 *   · size 取 24 的整数倍最锐利；**72px 及以下不画脚**（用户定）
 *   · **不许用 CSS 动画**：仓库有 scripts/check-animations.mjs 那条检查，
 *     起因是常驻的呼吸点把 GPU 烧到 23%。这里同样用低频定时器切帧，没有每帧循环。
 *   · 三道闸门：不可见停 / 页面隐藏停 / prefers-reduced-motion 只画第 0 帧
 */
(function (global) {
  'use strict';
  var CELL = 4, COLS = 24, FEET_MIN_PX = 73;

  function span(out, y, a, b) { for (var x = a; x <= b; x++) out.push([x, y]); }

  function bodyCells() {
    var c = [];
    span(c, 4, 4, 19); span(c, 5, 3, 20);
    for (var y = 6; y <= 15; y++) span(c, y, 2, 21);
    span(c, 16, 3, 20); span(c, 17, 4, 19);
    span(c, 2, 16, 17); span(c, 3, 15, 18);   // 右耳
    return c;
  }
  /** 左耳 = 块状光标，运行中会闪 */
  function earCells() { var c = []; span(c, 2, 6, 7); span(c, 3, 5, 8); return c; }
  function feetCells() { var c = []; span(c, 19, 4, 9); span(c, 19, 14, 19); return c; }

  function faceHoles(state, frame) {
    frame = frame || {};
    var h = [], dx = frame.eyeDx || 0, L = 7 + dx, R = 15 + dx, i, x0;
    function eye(x0, y0) { for (var y = y0; y < y0 + 4; y++) for (var x = x0; x < x0 + 2; x++) h.push([x, y]); }
    if (frame.closed || state === 'bg') {
      for (i = 0; i < 2; i++) { x0 = i ? R : L; span(h, 13, x0 - 1, x0 + 2); }
    } else if (state === 'done') {
      for (i = 0; i < 2; i++) { x0 = i ? R : L; h.push([x0 - 1, 13], [x0, 12], [x0 + 1, 12], [x0 + 2, 13]); }
    } else if (state === 'err') {
      var off = [[-1, 11], [2, 11], [0, 12], [1, 12], [0, 13], [1, 13], [-1, 14], [2, 14]];
      for (i = 0; i < 2; i++) { x0 = i ? R : L; for (var k = 0; k < off.length; k++) h.push([x0 + off[k][0], off[k][1]]); }
    } else if (state === 'wait') { eye(L, 10); eye(R, 10); }
    else { eye(L, 11); eye(R, 11); }
    if (state !== 'err') h.push([11, 15], [12, 15]);   // 嘴
    return h;
  }

  function dangoShape(state, size, frame) {
    frame = frame || {};
    var feet = size >= FEET_MIN_PX, on = {}, i;
    function add(cells) { for (i = 0; i < cells.length; i++) on[cells[i][0] + ',' + cells[i][1]] = 1; }
    add(bodyCells());
    if (frame.earOn !== false) add(earCells());
    if (feet) add(feetCells());
    var holes = faceHoles(state, frame);
    for (i = 0; i < holes.length; i++) delete on[holes[i][0] + ',' + holes[i][1]];
    var d = '';
    for (var y = 0; y < 20; y++) {
      var x = 0;
      while (x < COLS) {
        if (!on[x + ',' + y]) { x++; continue; }
        var end = x;
        while (end + 1 < COLS && on[end + 1 + ',' + y]) end++;
        var w = (end - x + 1) * CELL;
        d += 'M' + x * CELL + ' ' + y * CELL + 'h' + w + 'v' + CELL + 'h-' + w + 'z';
        x = end + 1;
      }
    }
    var top = 2 * CELL, vbH = (feet ? 20 : 18) * CELL - top;
    return { path: d, viewBox: '0 ' + top + ' ' + COLS * CELL + ' ' + vbH,
             width: size, height: Math.round(size * vbH / (COLS * CELL)) };
  }

  /** 每个状态的帧序列 [帧, 毫秒]。只有 idle / run 会动 */
  function dangoTimeline(state) {
    if (state === 'run') {
      var out = [], dxs = [0, -1, 0, 1];
      for (var i = 0; i < dxs.length; i++) {
        out.push([{ earOn: true, eyeDx: dxs[i] }, 530], [{ earOn: false, eyeDx: dxs[i] }, 530]);
      }
      return out;
    }
    if (state === 'idle') return [[{}, 3600], [{ closed: true }, 160]];
    return [[{}, 0]];
  }

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches ||
               new URLSearchParams(location.search).has('static');

  /** 把一个 <span data-dango="idle" data-size="48"> 变成会动的团子 */
  function mount(el) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'dango');
    el.appendChild(svg);

    var size = Number(el.getAttribute('data-size')) || 24;
    var timeline, step = 0, timer = null, onScreen = true;

    function draw() {
      var s = dangoShape(el.getAttribute('data-dango') || 'idle', size, timeline[step][0]);
      path.setAttribute('d', s.path);
      svg.setAttribute('viewBox', s.viewBox);
      svg.setAttribute('width', s.width);
      svg.setAttribute('height', s.height);
    }
    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    function tick() { step = (step + 1) % timeline.length; draw(); timer = setTimeout(tick, timeline[step][1]); }
    function start() {
      stop();
      if (reduce || timeline.length < 2 || !onScreen || document.hidden) return;
      timer = setTimeout(tick, timeline[step][1]);
    }
    /** 状态换了：重置到第 0 帧再跑（和应用里 useEffect 的行为一致） */
    function setState() { timeline = dangoTimeline(el.getAttribute('data-dango') || 'idle'); step = 0; draw(); start(); }

    setState();
    new MutationObserver(setState).observe(el, { attributes: true, attributeFilter: ['data-dango'] });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; onScreen ? start() : stop(); }).observe(el);
    }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  }

  global.Dango = { mount: mount, shape: dangoShape, timeline: dangoTimeline,
    mountAll: function () { [].slice.call(document.querySelectorAll('[data-dango]')).forEach(mount); } };
})(window);
