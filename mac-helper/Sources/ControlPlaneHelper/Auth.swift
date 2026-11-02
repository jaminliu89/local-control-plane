import Foundation

#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif

/// TCC 探测与系统设置深链。
enum HelperAuth {
    static let screenSettingsURL =
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!
    static let accessibilitySettingsURL =
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!

    static func openSettings(which: String) {
        #if canImport(AppKit)
        var urls: [URL] = []
        if which == "screen" || which == "both" { urls.append(screenSettingsURL) }
        if which == "accessibility" || which == "both" { urls.append(accessibilitySettingsURL) }
        for url in urls {
            NSWorkspace.shared.open(url)
        }
        #endif
    }

    static func accessibilityTrusted() -> Bool {
        #if canImport(AppKit)
        return AXIsProcessTrusted()
        #else
        return false
        #endif
    }

    static func screenRecordingTrusted() -> Bool {
        #if canImport(ScreenCaptureKit)
        // macOS 用户态没有完美同步 API；用能否枚举窗口作近似。
        let sem = DispatchSemaphore(value: 0)
        final class Box: @unchecked Sendable { var ok = false }
        let box = Box()
        Task {
            do {
                _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                box.ok = true
            } catch {
                box.ok = false
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 2)
        return box.ok
        #else
        return false
        #endif
    }

    static func snapshot() -> PermissionSnapshot {
        let ax = accessibilityTrusted()
        let screen = screenRecordingTrusted()
        if ax && screen {
            return PermissionSnapshot(state: .ready, screenRecording: "granted", accessibility: "granted")
        }
        if !ax && !screen {
            return PermissionSnapshot(state: .missingBoth, screenRecording: "denied", accessibility: "denied")
        }
        if !screen {
            return PermissionSnapshot(state: .missingScreen, screenRecording: "denied", accessibility: "granted")
        }
        return PermissionSnapshot(state: .missingAccessibility, screenRecording: "granted", accessibility: "denied")
    }
}
