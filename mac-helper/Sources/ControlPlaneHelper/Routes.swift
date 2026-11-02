import Foundation

/// 与 `src/contract/helper.ts` 对齐的路由表。实现时填入真实 TCC 调用。
enum HelperRoute: String {
    case health = "/v1/health"
    case auth = "/v1/auth"
    case authRequest = "/v1/auth/request"
    case ui = "/v1/ui"
    case capture = "/v1/capture"
    case ax = "/v1/ax"
    case timeline = "/v1/timeline"
}

enum AuthState: String {
    case ready
    case missingScreen = "missing_screen"
    case missingAccessibility = "missing_accessibility"
    case missingBoth = "missing_both"
    case helperOffline = "helper_offline"
    case placeholder
}

struct PermissionSnapshot {
    var state: AuthState
    var screenRecording: String
    var accessibility: String
}
