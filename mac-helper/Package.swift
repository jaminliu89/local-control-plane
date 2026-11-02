// swift-tools-version: 5.9
import PackageDescription

/// 签名菜单栏助手。在 macOS 上：
///   swift build -c release
///   ./scripts/build-app.sh
let package = Package(
    name: "ControlPlaneHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "ControlPlaneHelper", targets: ["ControlPlaneHelper"]),
    ],
    targets: [
        .executableTarget(
            name: "ControlPlaneHelper",
            path: "Sources/ControlPlaneHelper",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Network"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ImageIO"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("Security"),
            ]
        ),
    ]
)
