// computer use 插件的原生助手。**一个二进制，按子命令分工**：
//
//   （无参数）/ windows   列出屏幕上的窗口：id / 边界（逻辑点）/ bundle id / 标题
//   displays             显示器列表：逻辑边界与缩放因子（坐标校验要用）
//   axcheck              辅助访问权限给了没有 ＋ 当前鼠标位置
//   click x y [button] [count]
//   move x y
//   scroll dx dy
//   type <文本>
//   key mod1,mod2,keyname
//
// ── 为什么要编译产物 ──────────────────────────────────────────────────────
// `CGWindowListCopyWindowInfo` 与 `CGEvent` 都是 C API：JXA 的 ObjC 桥调不到
// （2026-09-06 实测返回 function），系统 python3 没有 Quartz 模块，
// `osascript` 走 System Events 要辅助访问（错误 -1719）。
//
// ── 最要紧的一条实测（2026-09-06）────────────────────────────────────────
// **没有辅助访问权限时，`CGEvent.post` 不报任何错，事件被静默丢弃。**
// 实测：AXIsProcessTrusted()=false，post 成功返回，鼠标从 (533,419) 原地没动。
// 只靠「调用没抛错」判成功，等于让模型以为点成功了继续往下做 —— 那是最坏的失败方式。
//
// 所以每个写动作都有三道，**顺序不能换**：
//   ① 权限：AXIsProcessTrusted
//   ② 落点：目标必须落在某块显示器里（insideAnyDisplay）
//   ③ 动作后读回鼠标位置验证（verifyAt）
//
// ⚠️ **② 不能省，也不能指望 ③ 顶替它。** 这里原来只有 ①③，注释还写着
// 「读回验证」能兜住一切 —— 2026-09-06 实测推翻：`CGEvent(source:nil).location`
// 读的是**事件流里的坐标**，不是被系统夹回的真实光标。在一块 1147×745 的屏上
// 发 move(1300,900)，回读理直气壮地说光标就在 (1300,900)，verifyAt 照过。
// ③ 真正挡得住的只有一种情况：**用户的手碰了鼠标/触控板把光标带走了**
// （实测很容易发生，误判成「权限问题」会让人去查完全无关的地方）。
//
// 只读子命令（windows / displays）不需要辅助访问；写子命令一律需要。
import Foundation
import CoreGraphics
import AppKit
import ApplicationServices

func out(_ obj: Any) -> Never {
    let d = try! JSONSerialization.data(withJSONObject: obj, options: [])
    print(String(data: d, encoding: .utf8)!)
    exit(0)
}
func fail(_ msg: String) -> Never { out(["ok": false, "error": msg]) }

func cursor() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

/// 每个写动作的前置闸：权限没给就明确拒绝，绝不「发了再说」
func requireAX() {
    if !AXIsProcessTrusted() {
        // ⚠️ 别再写「勾完必须重启软件」—— 2026-09-06 实测：把已有那一行的开关
        // 拨关再拨开，**同一个 app 进程（pid 没变）立刻就生效了**。
        // 而且界面上勾着 ≠ 真的生效（换包后那条记录会失效，勾照样显示着），
        // 所以文案要引导「拨一下开关」，而不是「去勾上」。
        fail("没有「辅助功能」权限，鼠标键盘事件会被系统静默丢弃（发了也没反应）。"
            + "到 系统设置 → 隐私与安全性 → 辅助功能 找到 Eas-Term："
            + "没有就用 ＋ 加上；**已经勾着的话把开关拨关再拨开**（软件更新过之后那条授权会失效，但界面上仍显示勾着）。"
            + "一般拨完立刻生效，不生效再重启软件。")
    }
}

/// 动作后验证：鼠标真的到了目标位置吗
func verifyAt(_ p: CGPoint, tol: CGFloat = 3) -> Bool {
    let c = cursor()
    return abs(c.x - p.x) < tol && abs(c.y - p.y) < tol
}

func listWindows() -> Never {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { out([]) }
    var res: [[String: Any]] = []
    for w in list {
        guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
        let width = b["Width"] ?? 0, height = b["Height"] ?? 0
        if width < 40 || height < 40 { continue }
        let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
        let bundle = pid > 0 ? (NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? "") : ""
        res.append([
            "id": w[kCGWindowNumber as String] as? Int ?? 0, "pid": pid, "bundleId": bundle,
            "owner": w[kCGWindowOwnerName as String] as? String ?? "",
            "title": w[kCGWindowName as String] as? String ?? "",
            "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "width": width, "height": height
        ])
    }
    out(res)
}

/// 所有显示器的边界，**CG 全局坐标系（原点在主屏左上角，y 向下）**。
///
/// ⚠️ 这里原来用 `NSScreen.frame` —— 那是 **AppKit 坐标系，原点在主屏左下角、y 向上**，
/// 跟 CGEvent / CGWindowList 用的那套反着。单显示器时两者恰好都是 (0,0) 起，看不出问题；
/// **一旦接第二块屏，副屏的 y 就会算反**（AppKit 说 +745，CG 说 −745），
/// 于是「这个点在不在屏幕里」会同时出现误拒和误放行。
/// 改用 `CGDisplayBounds`，它本来就是 CG 坐标系，不需要换算。
/// 缩放因子 CG 那边没有，按 displayID 回 NSScreen 里取。
func displayBounds() -> [(id: CGDirectDisplayID, rect: CGRect, scale: CGFloat, main: Bool)] {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    let byId: [CGDirectDisplayID: NSScreen] = Dictionary(
        uniqueKeysWithValues: NSScreen.screens.compactMap { sc -> (CGDirectDisplayID, NSScreen)? in
            guard let n = sc.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            return (CGDirectDisplayID(n.uint32Value), sc)
        })
    return ids.map { id in
        (id: id, rect: CGDisplayBounds(id),
         scale: byId[id]?.backingScaleFactor ?? 1,
         main: CGDisplayIsMain(id) != 0)
    }
}

/// 目标点在不在某块显示器里。**越界一律拒，不做钳制** ——
/// 钳到边缘会把「模型算错了坐标」变成「点到了屏幕角落的某个东西」，后者更难查也更危险。
func insideAnyDisplay(_ p: CGPoint) -> Bool {
    displayBounds().contains { $0.rect.contains(p) }
}

func listDisplays() -> Never {
    let res: [[String: Any]] = displayBounds().enumerated().map { (i, d) in
        [
            "id": i, "main": d.main,
            "x": d.rect.origin.x, "y": d.rect.origin.y,
            "width": d.rect.size.width, "height": d.rect.size.height,
            "scaleFactor": d.scale
        ]
    }
    out(["displays": res, "cursor": ["x": cursor().x, "y": cursor().y]])
}

/// AppKit 的 y 轴从左下角起，CGEvent 用左上角起 —— 全局统一用「左上角起」（和 CGWindowList 一致）
let args = Array(CommandLine.arguments.dropFirst())
let cmd = args.first ?? "windows"
func num(_ i: Int) -> CGFloat? { i < args.count ? CGFloat(Double(args[i]) ?? .nan) : nil }

switch cmd {
case "windows", "": listWindows()
case "displays": listDisplays()
case "axcheck":
    out(["ok": true, "axTrusted": AXIsProcessTrusted(), "cursor": ["x": cursor().x, "y": cursor().y]])

case "move", "click":
    requireAX()
    guard let x = num(1), let y = num(2), x.isFinite, y.isFinite else { fail("需要 x y 两个数字") }
    let p = CGPoint(x: x, y: y)
    // **落点闸：目标必须在某块屏幕里。** verifyAt 兜不住这一条（见文件头），
    // 而屏幕外的点击是「看起来成功了、实际什么都没点」——最坏的那种失败。
    if !insideAnyDisplay(p) {
        let ds = displayBounds()
            .map { "\(Int($0.rect.origin.x)),\(Int($0.rect.origin.y)) \(Int($0.rect.width))×\(Int($0.rect.height))" }
            .joined(separator: "；")
        fail(ds.isEmpty
            ? "拿不到任何显示器（睡眠或锁屏？）。什么都没做。"
            : "(\(Int(x)), \(Int(y))) 不在任何显示器范围内。当前显示器：\(ds)。什么都没做。")
    }
    guard let src = CGEventSource(stateID: .hidSystemState) else { fail("建不出事件源") }
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(120_000)
    // **移动没成功就不点** —— 位置都没到，点下去等于随机点了别处。
    // 走到这里权限和落点都已经查过，所以最可能的原因是**真实鼠标把光标带走了**。
    // 报错要说这个，别再甩锅给权限 —— 会让人去查完全无关的地方（2026-09-06 实测踩过）。
    if !verifyAt(p) {
        let c = cursor()
        fail("鼠标没停在 (\(Int(x)), \(Int(y)))，现在在 (\(Int(c.x)), \(Int(c.y)))。"
            + "多半是这一瞬间有人碰了鼠标或触控板，把光标带走了。**什么都没点**，手离开再重试即可。")
    }
    if cmd == "move" { out(["ok": true, "cursor": ["x": cursor().x, "y": cursor().y]]) }

    let btn = args.count > 3 ? args[3] : "left"
    let count = args.count > 4 ? (Int(args[4]) ?? 1) : 1
    let (down, up, mb): (CGEventType, CGEventType, CGMouseButton) =
        btn == "right" ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
    for i in 1...max(1, min(count, 3)) {
        let d = CGEvent(mouseEventSource: src, mouseType: down, mouseCursorPosition: p, mouseButton: mb)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        d?.post(tap: .cghidEventTap)
        usleep(30_000)
        let u = CGEvent(mouseEventSource: src, mouseType: up, mouseCursorPosition: p, mouseButton: mb)
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        u?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
    out(["ok": true, "clicked": ["x": x, "y": y], "button": btn, "count": count])

case "scroll":
    requireAX()
    guard let dx = num(1), let dy = num(2) else { fail("需要 dx dy") }
    guard let src = CGEventSource(stateID: .hidSystemState) else { fail("建不出事件源") }
    CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0)?
        .post(tap: .cghidEventTap)
    out(["ok": true, "scrolled": ["dx": dx, "dy": dy]])

case "type":
    requireAX()
    guard args.count > 1 else { fail("需要文本") }
    let text = args[1]
    if text.count > 500 { fail("一次最多 500 个字符") }
    guard let src = CGEventSource(stateID: .hidSystemState) else { fail("建不出事件源") }
    // 用 unicode 串直接发，不走键位映射 —— 中文和符号都能打，也不受输入法布局影响
    for ch in text {
        let s = Array(String(ch).utf16)
        guard let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
              let u = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) else { continue }
        d.keyboardSetUnicodeString(stringLength: s.count, unicodeString: s)
        u.keyboardSetUnicodeString(stringLength: s.count, unicodeString: s)
        d.post(tap: .cghidEventTap); usleep(8_000)
        u.post(tap: .cghidEventTap); usleep(8_000)
    }
    out(["ok": true, "typed": text.count])

case "key":
    requireAX()
    guard args.count > 1 else { fail("需要按键，形如 cmd,s") }
    let parts = args[1].lowercased().split(separator: ",").map(String.init)
    let keymap: [String: CGKeyCode] = [
        "a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,
        "y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29,
        "o":31,"u":32,"i":34,"p":35,"l":37,"j":38,"k":40,"n":45,"m":46,
        "return":36,"enter":36,"tab":48,"space":49,"delete":51,"esc":53,"escape":53,
        "left":123,"right":124,"down":125,"up":126
    ]
    var flags: CGEventFlags = []
    var key: CGKeyCode? = nil
    for p in parts {
        switch p {
        case "cmd","command","meta": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt","option","opt": flags.insert(.maskAlternate)
        case "ctrl","control": flags.insert(.maskControl)
        default: key = keymap[p]
        }
    }
    guard let k = key else { fail("认不出主键：\(args[1])。支持 a-z 0-9 与 return/tab/space/delete/esc/方向键") }
    guard let src = CGEventSource(stateID: .hidSystemState) else { fail("建不出事件源") }
    let d = CGEvent(keyboardEventSource: src, virtualKey: k, keyDown: true)
    d?.flags = flags; d?.post(tap: .cghidEventTap); usleep(30_000)
    let u = CGEvent(keyboardEventSource: src, virtualKey: k, keyDown: false)
    u?.flags = flags; u?.post(tap: .cghidEventTap)
    out(["ok": true, "keys": args[1]])

default: fail("未知子命令：\(cmd)")
}
