/*
 * ⚠️ 此文件由 SPB 设计系统自动分发，**不要在这里改**。
 * 改动请到源头：~/Biily/独立站/design-system/ambient-grid.js
 * 改完跑：node scripts/sync-design-system.mjs
 *
 * 同步于 2026-08-04 · 源文件 sha256 b69c4a19394a0fc5
 */
/**
 * SPB 设计系统 · 背景氛围层（零依赖原生版）
 * ─────────────────────────────────────────────────────────────
 * 暗底点阵。鼠标靠近点会染上品牌色；快速划过时点被惯性推开、
 * 随后 elastic 回弹归位；点击产生一圈向外扩散的冲击波。
 *
 * 效果源自 ReactBits 的 DotGrid（MIT），但**不用 React 也不用 gsap**：
 * 五个站里有三个是纯静态 HTML，为一个背景引 React + InertiaPlugin
 * 要付约 55KB gzip，不值。惯性与 elastic 回弹在这里自己算，约 3KB。
 *
 * 配色不写死 —— activeColor 默认读 CSS 变量 `--brand`，
 * 所以同一份文件在各站会自动用各站自己的品牌色。
 *
 * 用法：
 *   <div class="spb-ambient" aria-hidden="true"></div>
 *   <script src="./vendor/spb-design/ambient-grid.js" defer></script>
 * 需要自定义时在引入前设置：
 *   window.SPB_AMBIENT = { gap: 30, proximity: 220 };
 * ─────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  var host = document.querySelector('.spb-ambient');
  if (!host) return;

  var cfg = Object.assign({
    dotSize: 3,
    gap: 24,
    baseColor: '#232323',
    activeColor: null,     // null = 读 CSS 变量 --brand
    proximity: 190,        // 染色感应半径
    speedTrigger: 110,     // 触发惯性推开的鼠标速度（px/s）
    shockRadius: 280,      // 点击冲击波半径
    shockStrength: 4,
    resistance: 820,       // 惯性阻力，越大停得越快
    returnDuration: 1350,  // elastic 回弹时长（ms）
  }, window.SPB_AMBIENT || {});

  // 品牌色从 CSS 变量取 —— 一份 JS，各站自动用各自的色
  if (!cfg.activeColor) {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    cfg.activeColor = v || '#ff4d00';
  }

  var canvas = document.createElement('canvas');
  host.appendChild(canvas);
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isStatic = new URLSearchParams(location.search).has('static');
  var interactive = !reduce && !isStatic;

  function hexToRgb(hex) {
    var m = String(hex).trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    return m
      ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
      : { r: 255, g: 255, b: 255 };
  }
  var baseRgb = hexToRgb(cfg.baseColor);
  var actRgb = hexToRgb(cfg.activeColor);

  /* gsap 的 elastic.out(1, .75)。自己实现是为了不引 gsap ——
     这条曲线决定了「弹回去」的手感，换成普通 ease 会明显变木。 */
  function elasticOut(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var p = 0.75;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  }

  var dots = [];
  var w = 0, h = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  // 指针放视口外：否则页面刚加载、鼠标还没动时左上角会挂一块色斑
  var pt = { x: -9999, y: -9999, px: -9999, py: -9999, speed: 0 };
  var running = false;
  var visible = true;

  function build() {
    var step = cfg.dotSize + cfg.gap;
    var cols = Math.floor(w / step), rows = Math.floor(h / step);
    var padX = (w - (step * cols - cfg.gap)) / 2;
    var padY = (h - (step * rows - cfg.gap)) / 2;
    dots = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        dots.push({
          ax: padX + c * step + step / 2,
          ay: padY + r * step + step / 2,
          ox: 0, oy: 0,          // 当前偏移
          vx: 0, vy: 0,          // 惯性速度
          sx: 0, sy: 0,          // 回弹起点偏移
          phase: 0,              // 0 静止 / 1 惯性 / 2 回弹
          t0: 0
        });
      }
    }
  }

  function resize() {
    w = innerWidth; h = innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    draw(performance.now());
  }

  function draw(now) {
    ctx.clearRect(0, 0, w, h);
    var proxSq = cfg.proximity * cfg.proximity;
    var rad = cfg.dotSize / 2;

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];

      if (d.phase === 1) {
        // 惯性：速度按阻力指数衰减
        var damp = Math.exp(-cfg.resistance / 12000);
        d.ox += d.vx * 0.016;
        d.oy += d.vy * 0.016;
        d.vx *= damp; d.vy *= damp;
        if (Math.abs(d.vx) + Math.abs(d.vy) < 4) {
          d.phase = 2; d.t0 = now; d.sx = d.ox; d.sy = d.oy;
        }
      } else if (d.phase === 2) {
        var t = (now - d.t0) / cfg.returnDuration;
        if (t >= 1) { d.ox = d.oy = 0; d.phase = 0; }
        else {
          var e = 1 - elasticOut(t);
          d.ox = d.sx * e; d.oy = d.sy * e;
        }
      }

      var dx = d.ax - pt.x, dy = d.ay - pt.y;
      var dsq = dx * dx + dy * dy;
      var fill;
      if (dsq <= proxSq) {
        var k = 1 - Math.sqrt(dsq) / cfg.proximity;
        fill = 'rgb(' +
          Math.round(baseRgb.r + (actRgb.r - baseRgb.r) * k) + ',' +
          Math.round(baseRgb.g + (actRgb.g - baseRgb.g) * k) + ',' +
          Math.round(baseRgb.b + (actRgb.b - baseRgb.b) * k) + ')';
      } else {
        fill = cfg.baseColor;
      }

      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.arc(d.ax + d.ox, d.ay + d.oy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(loop);
  }

  function wake() {
    if (running || !interactive || !visible) return;
    running = true;
    requestAnimationFrame(loop);
  }

  function push(cx, cy, radius, strength, vx, vy) {
    var rSq = radius * radius;
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var dx = d.ax - cx, dy = d.ay - cy;
      var dsq = dx * dx + dy * dy;
      if (dsq > rSq) continue;
      var dist = Math.sqrt(dsq) || 1;
      var falloff = 1 - dist / radius;
      d.vx = (dx / dist) * strength * falloff * 60 + (vx || 0) * 0.05;
      d.vy = (dy / dist) * strength * falloff * 60 + (vy || 0) * 0.05;
      d.phase = 1;
    }
    wake();
  }

  addEventListener('resize', resize, { passive: true });
  resize();

  if (interactive) {
    // 只有视口内才跑循环，滚出去就停 —— 背景不该在看不见的时候空转
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) wake(); else running = false;
      }).observe(host);
    }

    var lastT = 0;
    addEventListener('mousemove', function (e) {
      var now = performance.now();
      var dt = lastT ? now - lastT : 16;
      lastT = now;
      var vx = ((e.clientX - pt.px) / dt) * 1000;
      var vy = ((e.clientY - pt.py) / dt) * 1000;
      pt.speed = Math.min(Math.hypot(vx, vy), 5000);
      pt.px = e.clientX; pt.py = e.clientY;
      pt.x = e.clientX; pt.y = e.clientY;
      if (pt.speed > cfg.speedTrigger) {
        push(e.clientX, e.clientY, cfg.proximity, 0.35, vx, vy);
      }
      wake();
    }, { passive: true });

    addEventListener('click', function (e) {
      push(e.clientX, e.clientY, cfg.shockRadius, cfg.shockStrength, 0, 0);
    });

    wake();
  }
})();
