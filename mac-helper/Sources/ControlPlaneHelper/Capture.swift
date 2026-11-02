import Foundation

#if canImport(AppKit)
import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
#endif

#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif

enum CaptureService {
    struct Frame {
        let path: String
        let width: Int
        let height: Int
    }

    static func captureFocusedWindow(workspace: URL) async throws -> Frame {
        #if canImport(ScreenCaptureKit)
        guard HelperAuth.screenRecordingTrusted() else {
            throw NSError(domain: "helper", code: 20, userInfo: [NSLocalizedDescriptionKey: "需要屏幕录制授权"])
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        // Prefer VS Code / Cursor; otherwise take frontmost non-desktop window.
        let preferred = content.windows.first { win in
            let app = win.owningApplication?.applicationName.lowercased() ?? ""
            return app.contains("code") || app.contains("cursor") || app.contains("visual studio")
        } ?? content.windows.first

        guard let window = preferred else {
            throw NSError(domain: "helper", code: 21, userInfo: [NSLocalizedDescriptionKey: "没有可截取的窗口"])
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = max(Int(window.frame.width), 100)
        config.height = max(Int(window.frame.height), 100)
        config.showsCursor = false
        config.capturesAudio = false

        let cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let framesDir = workspace.appendingPathComponent(".controlplane/frames", isDirectory: true)
        try FileManager.default.createDirectory(at: framesDir, withIntermediateDirectories: true)
        let name = "frame-\(Int(Date().timeIntervalSince1970 * 1000)).png"
        let url = framesDir.appendingPathComponent(name)
        try writePNG(cgImage, to: url)
        return Frame(path: url.path, width: cgImage.width, height: cgImage.height)
        #else
        throw NSError(domain: "helper", code: 22, userInfo: [NSLocalizedDescriptionKey: "非 macOS / 无 ScreenCaptureKit"])
        #endif
    }

    #if canImport(AppKit)
    private static func writePNG(_ image: CGImage, to url: URL) throws {
        let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        guard let dest else {
            throw NSError(domain: "helper", code: 23, userInfo: [NSLocalizedDescriptionKey: "无法写 PNG"])
        }
        CGImageDestinationAddImage(dest, image, nil)
        if !CGImageDestinationFinalize(dest) {
            throw NSError(domain: "helper", code: 24, userInfo: [NSLocalizedDescriptionKey: "PNG 写入失败"])
        }
    }
    #endif
}
