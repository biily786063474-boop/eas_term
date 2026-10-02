import AppKit
import WebKit

let frameLimit = 262144
func quit(_ code: Int32 = 0) -> Never { exit(code) }
func log(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }
final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
final class Assets: NSObject, WKURLSchemeHandler {
    let root: URL
    let allowed: Set<String>
    init(root: URL) throws {
        self.root = root.resolvingSymlinksInPath()
        let data = try Data(contentsOf: root.appendingPathComponent("island-assets.json"))
        self.allowed = Set(try JSONDecoder().decode([String].self, from: data))
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        do {
            guard let url = task.request.url, url.scheme == "eas-island", url.host == "local", task.request.httpMethod == "GET" else { throw NSError(domain:"assets",code:403) }
            let name = String(url.path.dropFirst())
            guard allowed.contains(name), !name.split(separator:"/").contains("..") else { throw NSError(domain:"assets",code:403) }
            let file = root.appendingPathComponent(name).resolvingSymlinksInPath()
            guard file.path.hasPrefix(root.path + "/") else { throw NSError(domain:"assets",code:403) }
            let data = try Data(contentsOf:file)
            let mime = ["html":"text/html","js":"text/javascript","css":"text/css","woff2":"font/woff2","svg":"image/svg+xml","png":"image/png"][file.pathExtension] ?? "application/octet-stream"
            task.didReceive(URLResponse(url:url,mimeType:mime,expectedContentLength:data.count,textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
            task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class Host: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let generation: String
    let panel: Panel
    let web: WKWebView
    let assets: Assets
    init(root: URL, generation: String) throws {
        self.generation = generation
        assets = try Assets(root:root)
        panel = Panel(contentRect:NSRect(x:0,y:0,width:190,height:30),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(assets,forURLScheme:"eas-island")
        let bridge = try String(contentsOf:Bundle.main.resourceURL!.appendingPathComponent("bridge.js"),encoding:.utf8)
        config.userContentController.addUserScript(WKUserScript(source:bridge,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        web = WKWebView(frame:NSRect(x:0,y:0,width:190,height:30),configuration:config)
        super.init()
        config.userContentController.add(self,name:"island")
        web.navigationDelegate = self
        web.setValue(false,forKey:"drawsBackground")
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.hidesOnDeactivate = false; panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary,.ignoresCycle]
        panel.contentView = web
        web.autoresizingMask = [.width,.height]
        web.load(URLRequest(url:URL(string:"eas-island://local/island.html")!))
    }
    func emit(_ fields: [String:Any]) {
        var value=fields; value["v"]=1; value["generation"]=generation
        guard let data=try? JSONSerialization.data(withJSONObject:value), data.count<=frameLimit else { quit(2) }
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "eas-island", message.frameInfo.request.url?.host == "local",
              let value=message.body as? [String:Any], let type=value["type"] as? String,
              ["ready","resize","hold","action"].contains(type) else { return }
        emit(value)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        let url=action.request.url
        decisionHandler(action.targetFrame?.isMainFrame == true && url?.absoluteString == "eas-island://local/island.html" ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { log("web content terminated"); quit(3) }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){log("navigation failed");quit(3)}
    func receive(_ m:[String:Any]) {
        guard m["v"] as? Int == 1, m["generation"] as? String == generation, let type=m["type"] as? String else { quit(2) }
        switch type {
        case "close": panel.orderOut(nil); quit()
        case "show": panel.orderFrontRegardless()
        case "ignoreMouse": guard let value=m["value"] as? Bool else {quit(2)}; panel.ignoresMouseEvents=value
        case "bounds":
            guard let x=m["x"] as? Double,let y=m["y"] as? Double,let w=m["width"] as? Double,let h=m["height"] as? Double,
                  [x,y,w,h].allSatisfy({$0.isFinite}),w>=18,w<=760,h>=16,h<=420 else {quit(2)}
            let top=NSScreen.screens.first?.frame.maxY ?? 0
            panel.setFrame(NSRect(x:x,y:top-y-h,width:w,height:h),display:true)
        case "state","enter","leave","collapse":
            let value=m["value"] ?? NSNull()
            guard let data=try? JSONSerialization.data(withJSONObject:[type,value],options:[.fragmentsAllowed]),let json=String(data:data,encoding:.utf8) else {quit(2)}
            web.evaluateJavaScript("window.__islandReceive(..." + json + ")",completionHandler:nil)
        default: quit(2)
        }
    }
}

guard CommandLine.arguments.count == 4, let parent=Int32(CommandLine.arguments[1]), parent>1, getppid()==parent else {quit(2)}
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
let host:Host
do { host=try Host(root:URL(fileURLWithPath:CommandLine.arguments[2]),generation:CommandLine.arguments[3]) } catch {log("host assets unavailable");quit(2)}
Timer.scheduledTimer(withTimeInterval:1,repeats:true){_ in if getppid() != parent {quit()} }
DispatchQueue.global().async {
    var buffer=Data()
    while true {
        let data=FileHandle.standardInput.availableData
        if data.isEmpty { DispatchQueue.main.async {quit(buffer.isEmpty ? 0 : 2)};return }
        for byte in data {
            if byte == 10 {
                guard let message=(try? JSONSerialization.jsonObject(with:buffer)) as? [String:Any] else {DispatchQueue.main.async {quit(2)};return}
                buffer.removeAll(keepingCapacity:true)
                DispatchQueue.main.async {host.receive(message)}
            } else { buffer.append(byte);if buffer.count>frameLimit {DispatchQueue.main.async {quit(2)};return} }
        }
    }
}
app.run()
