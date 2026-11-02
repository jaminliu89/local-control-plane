import Foundation

#if canImport(AppKit)
import AppKit
import WebKit
#endif

enum PanelHTML {
    static let document = """
    <!DOCTYPE html>
    <html lang="zh-CN"><head><meta charset="utf-8" />
    <title>本机控制面 · 助手</title>
    <style>
      body{margin:0;font:13px -apple-system,BlinkMacSystemFont,sans-serif;background:#12151a;color:#e8eaed}
      .shell{padding:14px}
      .hero{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.06)}
      .kicker{color:#9aa3af;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
      .title{font-size:16px;font-weight:600;margin:6px 0}
      .meta{color:#9aa3af;font-size:12px}
    </style></head>
    <body><div class="shell" id="root"><div class="hero"><div class="kicker">正在做</div><div class="title">等待第一步</div><div class="meta">菜单栏助手订阅同一条时间线</div></div></div>
    <script>
    async function tick(){
      try{
        const f=await fetch('/frame',{cache:'no-store'}).then(r=>r.json());
        document.getElementById('root').innerHTML='<div class="hero"><div class="kicker">正在做</div><div class="title">'+(f.currentStep||'')+'</div><div class="meta">'+(f.actor||'')+' · '+(f.entry||'')+'</div><div class="meta">'+(f.authLine||'')+'</div></div>';
      }catch(e){}
    }
    tick(); setInterval(tick,1000);
    </script></body></html>
    """
}

#if canImport(AppKit)
/// 不抢焦点的小窗口：NSPanel + nonactivating。
final class WitnessPanelController: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private var webView: WKWebView?
    private let panelURL: URL

    init(panelURL: URL) {
        self.panelURL = panelURL
    }

    func show() {
        if panel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 80, y: 80, width: 380, height: 520),
                styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.title = "本机控制面"
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.hidesOnDeactivate = false
            panel.becomesKeyOnlyIfNeeded = true
            panel.isReleasedWhenClosed = false
            let web = WKWebView(frame: panel.contentView?.bounds ?? .zero)
            web.autoresizingMask = [.width, .height]
            panel.contentView?.addSubview(web)
            web.load(URLRequest(url: panelURL))
            self.panel = panel
            self.webView = web
        }
        panel?.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }
}
#endif
