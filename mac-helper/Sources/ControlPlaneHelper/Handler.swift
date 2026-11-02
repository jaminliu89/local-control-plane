import Foundation

final class HelperHandler {
    private let workspace: URL
    private var auth: PermissionSnapshot
    private var events: [[String: Any]] = []
    private let queue = DispatchQueue(label: "local.ide-control.helper.state")

    init(workspace: URL, auth: PermissionSnapshot) {
        self.workspace = workspace
        self.auth = auth
    }

    func setAuth(_ next: PermissionSnapshot) {
        queue.sync { auth = next }
    }

    func refreshAuthFromSystem() {
        queue.sync { auth = HelperAuth.snapshot() }
    }

    func handle(method: String, path: String, body: Data) -> HelperHTTPResponse {
        if method == "GET" && (path == "/" || path == "/index.html") {
            return HelperHTTPResponse(status: 200, html: PanelHTML.document)
        }
        if method == "GET" && path == "/frame" {
            return queue.sync {
                HelperHTTPResponse(status: 200, json: frameJSON())
            }
        }
        if method == "GET" && path == "/v1/health" {
            return HelperHTTPResponse(status: 200, json: [
                "ok": true,
                "mode": "mac",
                "protocol": SessionHintStore.protocolVersion,
            ])
        }
        if method == "GET" && path == "/v1/auth" {
            refreshAuthFromSystem()
            return queue.sync {
                HelperHTTPResponse(status: 200, json: [
                    "protocol": SessionHintStore.protocolVersion,
                    "auth": authJSON(auth),
                ])
            }
        }
        if method == "GET" && path == "/v1/ui" {
            refreshAuthFromSystem()
            return queue.sync {
                if auth.state != .ready && auth.state != .missingScreen {
                    return HelperHTTPResponse(status: 403, json: ["failure": "需要辅助功能授权"])
                }
                let outline = AccessibilityService.outline()
                return HelperHTTPResponse(status: 200, json: [
                    "outline": outline.outline,
                    "nodeCount": outline.nodeCount,
                    "mode": "mac",
                ])
            }
        }
        if method == "POST" && path == "/v1/capture" {
            refreshAuthFromSystem()
            return queue.sync {
                if auth.state != .ready && auth.state != .missingAccessibility {
                    return HelperHTTPResponse(status: 403, json: ["failure": "需要屏幕录制授权"])
                }
                do {
                    let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
                    let app = (object?["app"] as? String) == "cursor" ? "cursor" : "vscode"
                    let title = object?["windowTitleIncludes"] as? String
                    let result = try CaptureService.capture(app: app, titleIncludes: title, workspace: workspace)
                    return HelperHTTPResponse(status: 200, json: [
                        "protocol": SessionHintStore.protocolVersion,
                        "imagePath": result.path,
                        "retainedUntil": result.retainedUntil,
                        "app": app,
                        "mode": "mac",
                    ])
                } catch {
                    return HelperHTTPResponse(status: 400, json: ["failure": error.localizedDescription])
                }
            }
        }
        if method == "POST" && path == "/v1/ax" {
            refreshAuthFromSystem()
            return queue.sync {
                if auth.state != .ready && auth.state != .missingScreen {
                    return HelperHTTPResponse(status: 403, json: ["failure": "需要辅助功能授权"])
                }
                let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
                let action = object["action"] as? String ?? ""
                let target = object["target"] as? String ?? ""
                let value = object["value"] as? String
                do {
                    try AccessibilityService.perform(action: action, target: target, value: value)
                    return HelperHTTPResponse(status: 200, json: ["ok": true, "mode": "mac"])
                } catch {
                    return HelperHTTPResponse(status: 400, json: ["failure": error.localizedDescription, "ok": false])
                }
            }
        }
        if method == "POST" && path == "/v1/timeline" {
            let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
            guard object["protocol"] as? Int == SessionHintStore.protocolVersion else {
                return HelperHTTPResponse(status: 400, json: ["failure": "协议版本不对"])
            }
            let next = object["events"] as? [[String: Any]] ?? []
            return queue.sync {
                events = Array(next.suffix(300))
                return HelperHTTPResponse(status: 200, json: ["ok": true, "count": events.count])
            }
        }
        if method == "POST" && path == "/v1/auth/request" {
            let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
            guard object["protocol"] as? Int == SessionHintStore.protocolVersion else {
                return HelperHTTPResponse(status: 400, json: ["failure": "协议版本不对"])
            }
            let which = object["which"] as? String ?? "both"
            HelperAuth.openSettings(which: which)
            refreshAuthFromSystem()
            return queue.sync {
                var urls: [String] = []
                if which == "screen" || which == "both" {
                    urls.append(HelperAuth.screenSettingsURL.absoluteString)
                }
                if which == "accessibility" || which == "both" {
                    urls.append(HelperAuth.accessibilitySettingsURL.absoluteString)
                }
                return HelperHTTPResponse(status: 200, json: [
                    "protocol": SessionHintStore.protocolVersion,
                    "ok": true,
                    "which": which,
                    "auth": authJSON(auth),
                    "openUrls": urls,
                    "note": "请在系统设置里为本机控制面助手打开对应权限。授权后助手会刷新 /v1/auth。",
                    "mode": "mac",
                ])
            }
        }
        return HelperHTTPResponse(status: 404, json: ["failure": "没有这个助手路由"])
    }

    private func authJSON(_ auth: PermissionSnapshot) -> [String: String] {
        [
            "state": auth.state.rawValue,
            "screenRecording": auth.screenRecording,
            "accessibility": auth.accessibility,
        ]
    }

    private func frameJSON() -> [String: Any] {
        let latest = events.last
        let step = (latest?["step"] as? String) ?? "等待第一步"
        let actor = (latest?["actor"] as? String) ?? "—"
        let entry = (latest?["entry"] as? String) ?? "—"
        return [
            "sessionId": "helper",
            "host": "127.0.0.1",
            "port": 0,
            "actor": actor,
            "entry": entry,
            "currentStep": step,
            "statusLine": (latest?["summary"] as? String) ?? "还没有步骤",
            "authLine": "\(auth.state.rawValue)（屏幕录制 \(auth.screenRecording)，辅助功能 \(auth.accessibility)）",
            "auth": authJSON(auth),
            "tone": "idle",
            "recent": [] as [String],
            "recentItems": [] as [[String: Any]],
        ]
    }
}
