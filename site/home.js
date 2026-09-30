/* 首页的滚动驱动与演示逻辑（2026-09-30 改版）
   从 docs/prototype/2026-09-30-site-home/home-v9.html 抽出来的。
   ⚠️ 两个坑，改这里之前先读：
     ① 脚本里的顺序是「字数计 → 滚动引擎 → 任务轮播」。按「剪到任务轮播为止」下刀
        会把滚动引擎一起剪掉 —— 页面照常渲染、零报错、演示看着也在动（那是 CSS 过渡），
        只有 ?static 下 data-p 全是 undefined 才看得出来。
     ② 这段本来就是 (function(){…})()，别再包一层。包了之后往「最后一个 })();」前面
        加代码，会加到内层闭包外面，NM / tracks 这些全看不见。
   改完必须跑一遍 ?static。 */
/* 演示台。纪律照现网 proto.js：reduce / ?static / 滚出视口都不跑，
   且不跑时画面是完整可读的静态图。 */
(function(){
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isStatic = new URLSearchParams(location.search).has('static');
  var NM = reduce || isStatic;
  if (NM) document.documentElement.classList.add('no-motion');
  Dango.mountAll();

  function typeInto(el, text, delay, speed, done){
    el.textContent = ''; var i = 0;
    setTimeout(function tick(){
      if (!el.isConnected) return;
      el.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(tick, speed); else if (done) done();
    }, delay);
  }

  /* ── 大演示：完整链路 8 拍 ──────────────────────────────────
     照 DIRECTION.md 第 21 节 V16 对「执行清单」那条的修法：
     发送 →「正在处理…」→ 工具行 plan_create → 清单长在对话外侧原生位置
     → 逐项打勾 → 工具行 canvas_publish_report → 汇报页落进画布 → 收起。
     每拍换一句说明字（notes），团子跟着换 wait / run / done。 */
  var CHAIN = [
    { st:1, t:0,    note:'说一句要做什么',                        dango:'wait' },
    { st:2, t:2600, note:'<b>⌘ ↵</b> 发出去',                      dango:'wait' },
    { st:3, t:3300, note:'AI 开始处理',                            dango:'run'  },
    { st:4, t:4300, note:'先调 <b>plan_create</b>，把活拆成步骤',   dango:'run'  },
    { st:5, t:5300, note:'清单就挂在对话旁边，不用你去找',          dango:'run'  },
    { st:6, t:6100, note:'做完一步，自己打一个勾',                  dango:'run'  },
    { st:7, t:9000, note:'最后一步：<b>canvas_publish_report</b>',  dango:'run'  },
    { st:8, t:10000,note:'汇报页自己落进项目画布',                  dango:'done' }
  ];

  function playChain(scene, instant){
    var note = scene.querySelector('[data-note]');
    var guide = scene.querySelector('[data-guide]');
    var beats = scene.querySelector('[data-beats]');
    var steps = [].slice.call(scene.querySelectorAll('[data-step]'));
    var count = scene.querySelector('[data-plan-count]');
    var typed = scene.querySelector('[data-type]');
    if (beats && !beats.children.length) CHAIN.forEach(function(){ beats.appendChild(document.createElement('i')); });

    scene.className = scene.className.replace(/\s*st\d/g,'');
    (scene._timers||[]).forEach(clearTimeout); scene._timers = [];
    steps.forEach(function(s){ s.classList.remove('done','run'); });

    function at(i){
      var c = CHAIN[i];
      scene.className = scene.className.replace(/\s*st\d/g,'') + ' st' + c.st;
      if (note) note.innerHTML = c.note;
      if (guide) guide.setAttribute('data-dango', c.dango);
      if (beats) [].slice.call(beats.children).forEach(function(el,n){ el.classList.toggle('on', n<=i); });
    }

    if (instant){
      at(CHAIN.length-1);
      if (typed) typed.textContent = typed.dataset.type;
      steps[0].classList.add('done'); steps[1].classList.add('done'); steps[2].classList.add('done');
      if (count) count.textContent = '3 / 3';
      return;
    }
    if (typed) typeInto(typed, typed.dataset.type, 500, 62);
    if (count) count.textContent = '0 / 3';
    CHAIN.forEach(function(c,i){ scene._timers.push(setTimeout(function(){ at(i); }, c.t)); });
    // 打勾的时刻照 V16：第 1 勾 1.25s、第 2 勾 2.15s（相对清单出现）
    scene._timers.push(setTimeout(function(){ steps[0].classList.add('done'); if(count) count.textContent='1 / 3'; }, 6550));
    scene._timers.push(setTimeout(function(){ steps[1].classList.add('done'); if(count) count.textContent='2 / 3'; }, 7450));
    scene._timers.push(setTimeout(function(){ steps[2].classList.add('run'); }, 8200));
    scene._timers.push(setTimeout(function(){
      steps[2].classList.remove('run'); steps[2].classList.add('done'); if(count) count.textContent='3 / 3';
    }, 10400));
  }

  /* ── 代码雨：词条 fx-LetterGlitch 的效果本身 ── */
  function rain(cv){
    if (!cv || cv._on) return; cv._on = 1;
    var ctx = cv.getContext('2d'), CH = 'アイウカキ01{}<>/\\|=+*#$';
    var dpr = Math.min(2, devicePixelRatio||1), W, H, cols, y;
    function size(){
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W*dpr; cv.height = H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
      cols = Math.floor(W/9); y = []; for (var i=0;i<cols;i++) y[i] = Math.random()*-20;
    }
    size(); addEventListener('resize', size);
    ctx.font = '11px ui-monospace,monospace';
    function frame(){
      ctx.fillStyle = 'rgba(4,6,10,.22)'; ctx.fillRect(0,0,W,H);
      for (var i=0;i<cols;i++){
        var c = CH[(Math.random()*CH.length)|0];
        ctx.fillStyle = Math.random()>.94 ? '#dfe7f5' : 'rgba(162,185,224,.72)';
        ctx.fillText(c, i*9, y[i]*13);
        y[i] = (y[i]*13 > H && Math.random() > .972) ? 0 : y[i]+1;
      }
      cv._raf = requestAnimationFrame(frame);
    }
    if (!NM) frame(); else { ctx.fillStyle='rgba(162,185,224,.6)'; for(var i=0;i<cols;i++) for(var j=0;j<5;j++) ctx.fillText(CH[(i*j)%CH.length], i*9, j*13+11); }
  }

  function play(scene, instant){
    if (scene.hasAttribute('data-chain')) return playChain(scene, instant);
    scene.classList.remove('on'); void scene.offsetWidth; scene.classList.add('on');
    var t = scene.querySelector('[data-type]');
    if (t) { if (instant) t.textContent = t.dataset.type; else typeInto(t, t.dataset.type, 600, 62); }
    var cv = scene.querySelector('[data-rain]');
    if (cv) rain(cv);
  }

  var scenes = [].slice.call(document.querySelectorAll('[data-scene]'));
  if (NM) {
    scenes.forEach(function(s){ play(s, true); });
    [].slice.call(document.querySelectorAll('[data-fold]')).forEach(function(d){ d.open = true; });
  } else {
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (e.isIntersecting && !e.target.dataset.played){ e.target.dataset.played='1'; play(e.target); }
      });
    }, { threshold: .3 });
    scenes.forEach(function(s){ io.observe(s); });
    // 折叠展开时才播里面那段（收着的时候不空转）
    [].slice.call(document.querySelectorAll('[data-fold]')).forEach(function(d){
      d.addEventListener('toggle', function(){
        var s = d.querySelector('[data-scene]');
        if (d.open && s) { s.dataset.played='1'; play(s); }
      });
    });
    document.addEventListener('click', function(e){
      var b = e.target.closest('[data-replay]');
      if (b) play(b.closest('[data-scene]'));
    });
  }

  /* ── 演示绑定滚动 ─────────────────────────────────────────────
     不是「进视口自动播一遍」，是**滚到哪一步就停在哪一步**：
     往下走演示前进，往上翻演示倒回去，停下就定格。

     做法：每个演示屏是一条比视口高的轨道（.sc，高 = 100svh + steps×46svh），
     里面一层 sticky 钉住；滚动进度 p = 走过的距离 / 可走的距离，
     写成 --p（连续量，用于进度条、出纸这类）和 data-p（步号，CSS 按它分支）。

     ⚠️ 用 rAF 合并，不在 scroll 回调里直接读 getBoundingClientRect ——
        每帧对 20 多个元素强制同步布局，滚动会掉帧。 */
  var tracks = [].slice.call(document.querySelectorAll('.sc[data-steps]'));
  function syncTracks(){
    var vh = innerHeight;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i], r = t.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;          // 离得远的不算
      var span = t.offsetHeight - vh;
      var p = span > 0 ? (-r.top) / span : 0;
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      var steps = +t.dataset.steps || 1;
      // 头尾各留一点余量：刚进屏别就走完，走完了也停得住
      // 前 20% 收文字，24% 之后才开始走演示的步子 —— 两段不重叠，
      // 保证「文字和演示不同时占着画面中央」
      var tp = p / 0.20; tp = tp < 0 ? 0 : tp > 1 ? 1 : tp;
      t.style.setProperty('--tp', tp.toFixed(4));
      var q = (p - 0.24) / 0.66; q = q < 0 ? 0 : q > 1 ? 1 : q;
      t.style.setProperty('--p', q.toFixed(4));
      var step = Math.min(steps - 1, Math.floor(q * steps));
      if (t.dataset.p !== String(step)) t.dataset.p = step;
    }
  }
  var tRaf = 0;
  function onScroll(){ if (tRaf) return; tRaf = requestAnimationFrame(function(){ tRaf = 0; syncTracks(); }); }
  if (NM) {
    // 不跑动效：每台都钉在最后一步 —— 画面是完整的结果态，不是空壳
    tracks.forEach(function(t){ t.dataset.p = (+t.dataset.steps || 1) - 1;
      t.style.setProperty('--p','1'); t.style.setProperty('--tp','1'); });
  } else {
    addEventListener('scroll', onScroll, {passive:true});
    addEventListener('resize', onScroll);
    syncTracks();
  }



  /* 任务轮播：一次只露一件 */
  (function(){
    var box = document.querySelector('[data-jobs]'); if (!box) return;
    var items = [].slice.call(box.querySelectorAll('.jw'));
    var dots = box.querySelector('[data-jwdots]');
    items.forEach(function(){ dots.appendChild(document.createElement('i')); });
    var pips = [].slice.call(dots.children); pips[0].classList.add('on');
    var i = 0, timer = null;
    function go(n){ i = n % items.length;
      items.forEach(function(el,k){ el.classList.toggle('on', k===i); });
      pips.forEach(function(el,k){ el.classList.toggle('on', k===i); }); }
    function play(){ if (timer || NM) return; timer = setInterval(function(){ go(i+1); }, 2600); }
    function stop(){ clearInterval(timer); timer = null; }
    new IntersectionObserver(function(es){ es[0].isIntersecting ? play() : stop(); }, {threshold:.4}).observe(box);
    box.addEventListener('pointerenter', stop); box.addEventListener('pointerleave', play);
  })();

  /* 向下滚收起导航：见 home.css 里那段说明。
     ⚠️ 只在越过首屏之后才收 —— 刚进页面就藏，用户会以为站点没导航。 */
  if (!NM) (function(){
    var last = scrollY, ticking = false;
    function sync(){
      ticking = false;
      var y = scrollY;
      var d = y > last + 6 ? 'up' : y < last - 6 ? 'down' : null;
      if (y <= innerHeight * 0.9) document.body.dataset.nav = 'down';
      else if (d) document.body.dataset.nav = d;
      if (d) last = y;
    }
    addEventListener('scroll', function(){ if (!ticking) { ticking = true; requestAnimationFrame(sync); } }, {passive:true});
    sync();
  })();
})();
