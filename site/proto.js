/**
 * Hero 原型演示的导览逻辑。
 *
 * 渐进增强：HTML 已经是一张完整可读的界面图，这个文件只加两件事 ——
 *   1. 自动导览：逐个高亮「终端 / 网页预览 / 代码 / Git」，每步换一句说明
 *   2. 鼠标接管：指到哪个模块就停自动播放、高亮那一个；移开后恢复
 *
 * 不跑的情况（都保持静态可读，不是坏掉）：
 *   · prefers-reduced-motion: reduce
 *   · ?static（视觉回归测试）
 *   · 滚出视口（不在看的时候不空转）
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-proto]');
  if (!root) return;

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isStatic = new URLSearchParams(location.search).has('static');

  var tipText = root.querySelector('[data-proto-tip]');
  var stepsBox = root.querySelector('[data-proto-steps]');
  // 导览顺序由 DOM 顺序决定，加模块不用改这里
  var targets = Array.prototype.slice.call(root.querySelectorAll('[data-tip]'));
  if (!targets.length || !tipText) return;

  // 进度条按目标数量生成
  if (stepsBox) {
    targets.forEach(function () { stepsBox.appendChild(document.createElement('i')); });
  }
  var pips = stepsBox ? Array.prototype.slice.call(stepsBox.children) : [];

  root.setAttribute('data-ready', '');

  var idx = -1;
  var timer = null;
  var hovering = false;
  var visible = true;
  var STEP = 3200;

  function show(i) {
    idx = i;
    targets.forEach(function (el, n) {
      if (n === i) el.setAttribute('data-on', '');
      else el.removeAttribute('data-on');
    });
    pips.forEach(function (p, n) {
      if (n === i) p.setAttribute('data-on', '');
      else p.removeAttribute('data-on');
    });
    root.setAttribute('data-guiding', '');
    tipText.innerHTML = targets[i].getAttribute('data-tip');
  }

  function clear() {
    targets.forEach(function (el) { el.removeAttribute('data-on'); });
    pips.forEach(function (p) { p.removeAttribute('data-on'); });
    root.removeAttribute('data-guiding');
  }

  function next() { show((idx + 1) % targets.length); }

  function play() {
    if (timer || hovering || !visible || reduce || isStatic) return;
    if (idx < 0) show(0);
    timer = setInterval(next, STEP);
  }
  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // 鼠标接管：指到哪个就停在哪个
  targets.forEach(function (el, n) {
    el.addEventListener('mouseenter', function () {
      hovering = true; pause(); show(n);
    });
    el.addEventListener('mouseleave', function () {
      hovering = false; play();
    });
  });

  // 滚出视口就停 —— 没人看的时候不该继续跑定时器
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) play(); else pause();
    }, { threshold: .25 }).observe(root);
  }

  if (reduce || isStatic) {
    // 静态态：高亮第一个并给出它的说明，不轮播
    show(0);
    root.removeAttribute('data-guiding');
    pause();
  } else {
    play();
  }
})();
