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
// 所以每个动作都做两件事：① 动作前查 AXIsProcessTrusted ②**动作后读回鼠标位置验证**。
// 只靠「调用没抛错」判成功，等于让模型以为点成功了继续往下做 —— 那是最坏的失败方式。
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
        fail("没有「辅助功能」权限，鼠标键盘事件会被系统静默丢弃（发了也没反应）。请到 系统设置 → 隐私与安全性 → 辅助功能 勾上 Eas-Term，然后重启软件。")
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

func listDisplays() -> Never {
    var res: [[String: Any]] = []
    for (i, s) in NSScreen.screens.enumerated() {
        let f = s.frame
        res.append([
            "id": i, "main": s == NSScreen.main,
            "x": f.origin.x, "y": f.origin.y, "width": f.size.width, "height": f.size.height,
            "scaleFactor": s.backingScaleFactor
        ])
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
    guard let src = CGEventSource(stateID: .hidSystemState) else { fail("建不出事件源") }
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(120_000)
    // **移动没成功就不点** —— 位置都没到，点下去等于随机点了别处
    if !verifyAt(p) { fail("鼠标没有移动到 (\(Int(x)), \(Int(y)))，事件被系统丢弃了（权限或屏幕状态问题）。什么都没点。") }
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
