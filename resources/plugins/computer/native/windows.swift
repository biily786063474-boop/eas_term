// 列出屏幕上的窗口：id / 边界（逻辑点）/ 所属 App 的 bundle id / 标题。
//
// 为什么要一个编译产物：`CGWindowListCopyWindowInfo` 是 C API，JXA 的 ObjC 桥调不到
// （2026-09-06 实测返回 function），系统 python3 也没有 Quartz 模块。而窗口边界是
// **打码的前提**（要知道 1Password 的窗口在哪才能涂黑），拿不到就只能退回「不截图」。
//
// 只读，不需要辅助访问权限。窗口**标题**在较新的 macOS 上需要「屏幕录制」权限，
// 没有权限时标题为空字符串 —— 那时靠 bundleId 匹配仍然有效（redact.ts 两条都认）。
//
// 用 scripts/build-computer-helper.mjs 编成通用二进制（arm64 + x86_64，约 150KB）。

import Foundation
import CoreGraphics
import AppKit

let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { print("[]"); exit(0) }
var out: [[String: Any]] = []
for w in list {
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let width = b["Width"] ?? 0, height = b["Height"] ?? 0
    if width < 40 || height < 40 { continue }
    let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
    let bundle = pid > 0 ? (NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? "") : ""
    out.append([
        "id": w[kCGWindowNumber as String] as? Int ?? 0,
        "pid": pid, "bundleId": bundle,
        "owner": w[kCGWindowOwnerName as String] as? String ?? "",
        "title": w[kCGWindowName as String] as? String ?? "",
        "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "width": width, "height": height
    ])
}
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)
