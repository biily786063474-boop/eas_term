/* eas.biily.top 站内统计 —— 极简、匿名、无 Cookie。
 *
 * 它做什么：往 /e 发一个空请求（服务端 return 204），参数写进独立的 nginx 日志，
 * 每 10 分钟由 cron 聚合成看板数据。**服务端不跑任何常驻进程，也没有数据库。**
 *
 * 它不做什么（这几条是承诺，改代码时别破坏，隐私页里逐条写着）：
 *   · 不写 Cookie、不写 localStorage —— 会话 id 只存在 sessionStorage，关掉标签页即消失
 *   · 不生成任何持久 / 跨天的用户标识。UV 由服务端按「当日 IP+UA 哈希」算，隔天就对不上了
 *   · 不采集任何输入内容、不读剪贴板、不加载第三方脚本
 *   · 尊重 Do Not Track / 全局隐私控制，命中就整个不发
 *
 * 桌面软件本身依然是零采集的，这里只统计官网。两件事在隐私页里分开写。
 */
(function () {
  'use strict'

  // 尊重浏览器的「请勿追踪」与全局隐私控制。命中就彻底不工作——
  // 这类信号如果只是「少发几个字段」，那和不尊重没区别。
  var nav = navigator
  if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl) return

  var ENDPOINT = '/e'

  /** 会话 id：只活在 sessionStorage 里，关标签页就没了，不跨会话、不跨天。
   *  它唯一的用途是把「同一次访问里的几个页面」串起来算停留时长。 */
  function sid() {
    try {
      var k = 'eas_s'
      var v = sessionStorage.getItem(k)
      if (!v) {
        v = Math.random().toString(36).slice(2, 10)
        sessionStorage.setItem(k, v)
      }
      return v
    } catch (e) {
      // 隐私模式下 sessionStorage 可能抛异常，退化成一次性 id，不影响主流程
      return 'nostore'
    }
  }

  /** 粗粒度设备判断。只留操作系统大类，不做指纹——
   *  屏幕分辨率、字体、canvas 这些能拼出指纹的一律不采。 */
  function os() {
    var u = nav.userAgent
    if (/Windows/i.test(u)) return 'Windows'
    if (/Mac OS X|Macintosh/i.test(u)) return 'macOS'
    if (/Android/i.test(u)) return 'Android'
    if (/iPhone|iPad|iPod/i.test(u)) return 'iOS'
    if (/Linux/i.test(u)) return 'Linux'
    return 'Other'
  }

  /** 来源站点：只取域名，丢掉路径和查询串（那里面可能有别人的隐私参数） */
  function ref() {
    try {
      if (!document.referrer) return 'direct'
      var h = new URL(document.referrer).hostname
      return h === location.hostname ? 'internal' : h
    } catch (e) {
      return 'direct'
    }
  }

  var S = sid()
  var started = Date.now()
  var sent = false

  function send(params, beacon) {
    var q = []
    params.s = S
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
      }
    }
    var url = ENDPOINT + '?' + q.join('&')
    // 离开页面时必须用 sendBeacon：普通请求会被导航打断，停留时长就永远收不到
    if (beacon && nav.sendBeacon) {
      try {
        nav.sendBeacon(url)
        return
      } catch (e) {
        /* 落到下面的 Image 兜底 */
      }
    }
    // 用 Image 而不是 fetch：不需要 CORS、不需要等响应、老浏览器也认
    new Image().src = url
  }

  /** 页面浏览 */
  send({ t: 'pv', p: location.pathname, r: ref(), d: os() })

  /** 点击：只记带 data-track 标记的元素，不做全局监听。
   *  全局监听等于把用户点的每一处都上报，那超出了「知道下载按钮有没有人点」的需要。 */
  document.addEventListener(
    'click',
    function (e) {
      var el = e.target
      while (el && el !== document.body) {
        if (el.getAttribute && el.getAttribute('data-track')) {
          send({ t: 'click', k: el.getAttribute('data-track'), p: location.pathname })
          return
        }
        el = el.parentNode
      }
    },
    true
  )

  /** 停留时长：页面进入后台或关闭时上报一次，只报一次。
   *  用 visibilitychange 而不是 unload —— 移动端和 bfcache 下 unload 常常不触发。 */
  function bye() {
    if (sent) return
    sent = true
    var sec = Math.round((Date.now() - started) / 1000)
    if (sec > 0 && sec < 3600) send({ t: 'stay', sec: sec, p: location.pathname }, true)
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') bye()
  })
  window.addEventListener('pagehide', bye)
})()
