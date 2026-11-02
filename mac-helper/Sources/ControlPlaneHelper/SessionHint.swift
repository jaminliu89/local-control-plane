import Foundation

struct HelperSessionHint: Codable {
    let protocolVersion: Int
    let host: String
    let port: Int
    let token: String
    let bundleId: String

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case host, port, token, bundleId
    }
}

enum SessionHintStore {
    static let bundleId = "local.ide-control.helper"
    static let protocolVersion = 1

    static func write(workspace: URL, port: Int, token: String) throws {
        let dir = workspace.appendingPathComponent(".controlplane", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let hint = HelperSessionHint(
            protocolVersion: protocolVersion,
            host: "127.0.0.1",
            port: port,
            token: token,
            bundleId: bundleId
        )
        let data = try JSONEncoder().encode(hint)
        var payload = data
        payload.append(contentsOf: "\n".utf8)
        let file = dir.appendingPathComponent("helper.json")
        try payload.write(to: file, options: .atomic)
    }
}
