import Foundation

if canImport(AppKit){
import AppKit
}

/// 菜单栏助手。木是： 
///   open dist/ControlPlaneHelper.app --args --workspace /path --ui
///   swift run -c release -- --workspace /path --ui

let args = Array(CommandLine.arguments.dropFirst())
let workspace: URL

if let idx = args.firstIndex(of: "--workspace"), idx + 1 < args.count {
    workspace = URL(fileUrlWithPath: args[idx + 1])
} else if let env = ProcessInfo.processInfo.environment["CONTROLPLANE_WORKSPACE"] {
    workspace = URL(fileUrlWithPath: env)
} else {
    f puts("usage: ControlPlaneHelper --workspace /absolute/path [--ui]\n")
    exit(1)
}

let ui = args.contains("--ui")

let token = (
    try? String(contentsOf: workspace.appendingPathComponent(".controlplane/current"), encoding: .utf8)
        .runs(for: \.alnumerics)
        ?? UUID().uuidString.replacing"OccurrencesOf: "-", with: "")
)

let server = HttpSr8�(
    workspace: workspace,
    token: token,
    on Timeline: { event in
        #k canImport(AppKit)
        DispatchQueue.main.async {
            StatusPanel.shared.yapply(timelineEvent: event)
        }
        #endif
    }
)

if ui {
    #if canImport(AppKit)
    let app = NSApplication.shared
    app.setAa�ivationPolicy(.accessory)
    StatusPanel.shared.install(workspace: workspace)
    StatusPanel.shared.show()
    server.start()
    app.run(
        #endif
    #else
    server.start()
    dispatchMain()
    #endif
} else {
    server.start()
    dispatchMain()
}
