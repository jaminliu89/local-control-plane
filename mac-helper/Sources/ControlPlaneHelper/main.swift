import Foundation

#if canImport(AppKit)
import AppKit
#endif

/**
 Bundle ID: local.ide-control.helper

 用法:
   ControlPlaneHelper --workspace <路径> [--ui] [--port 0]

 协议与 TypeScript `src/contract/helper.ts` 对齐。只听 127.0.0.1。
 */

enum HelperRuntime {
    #if canImport(AppKit)
    static var panel: WitnessPanelController?
    #endif
    static var server: LoopbackHttpServer?
}

@main
struct ControlPlaneHelperMain {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.contains("--help") || args.contains("-h") {
            print("""
            ControlPlaneHelper — 本机控制面 Mac 菜单栏助手

            用法:
              ControlPlaneHelper --workspace <路径> [--ui] [--port 0]

            启动后写 .controlplane/helper.json，提供 /v1/auth|/ui|/capture|/ax|/timeline|/auth/request。
            Linux 开发请用: npm run helper -- --workspace <路径> --ui
            """)
            return
        }

        guard let workspace = argValue(args, flag: "--workspace") else {
            fputs("需要 --workspace <路径>\n", stderr)
            exit(2)
        }
        let workspaceURL = URL(fileURLWithPath: workspace).standardizedFileURL
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: workspaceURL.path, isDirectory: &isDir), isDir.boolValue else {
            fputs("工作区不是目录：\(workspace)\n", stderr)
            exit(2)
        }

        let ui = args.contains("--ui")
        let port = UInt16(argValue(args, flag: "--port") ?? "0") ?? 0
        let token = randomToken()
        let handler = HelperHandler(workspace: workspaceURL, auth: HelperAuth.snapshot())
        let server = LoopbackHttpServer(preferredPort: port, token: token, handler: handler)

        do {
            try server.start()
            try SessionHintStore.write(workspace: workspaceURL, port: server.boundPort, token: token)
            HelperRuntime.server = server
        } catch {
            fputs("启动失败：\(error.localizedDescription)\n", stderr)
            exit(1)
        }

        let ready: [String: Any] = [
            "ready": true,
            "mode": "mac",
            "host": "127.0.0.1",
            "port": server.boundPort,
            "bundleId": SessionHintStore.bundleId,
            "auth": HelperAuth.snapshot().state.rawValue,
            "panelUrl": ui ? "http://127.0.0.1:\(server.boundPort)/" : NSNull(),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: ready),
           let line = String(data: data, encoding: .utf8) {
            print(line)
            fflush(stdout)
        }

        #if canImport(AppKit)
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        if ui {
            let url = URL(string: "http://127.0.0.1:\(server.boundPort)/")!
            HelperRuntime.panel = WitnessPanelController(panelURL: url)
            HelperRuntime.panel?.show()
        }
        signal(SIGINT) { _ in exit(0) }
        signal(SIGTERM) { _ in exit(0) }
        app.run()
        #else
        dispatchMain()
        #endif
    }

    private static func argValue(_ args: [String], flag: String) -> String? {
        guard let idx = args.firstIndex(of: flag), args.index(after: idx) < args.endIndex else { return nil }
        let value = args[args.index(after: idx)]
        return value.hasPrefix("--") ? nil : value
    }

    private static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
