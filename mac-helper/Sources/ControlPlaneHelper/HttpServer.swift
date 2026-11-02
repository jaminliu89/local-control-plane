import Foundation
import Network

/// 只听 127.0.0.1 的极简 HTTP。路由交给 Handler。
final class LoopbackHttpServer {
    private let port: NWEndpoint.Port
    private let token: String
    private let handler: HelperHandler
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "local.ide-control.helper.http")

    private(set) var boundPort: Int = 0

    init(preferredPort: UInt16 = 0, token: String, handler: HelperHandler) {
        self.port = preferredPort == 0 ? .any : NWEndpoint.Port(rawValue: preferredPort)!
        self.token = token
        self.handler = handler
    }

    func start() throws {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        let listener = try NWListener(using: parameters, on: port)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        let ready = DispatchSemaphore(value: 0)
        var startError: Error?
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let port = listener.port?.rawValue {
                    self.boundPort = Int(port)
                }
                ready.signal()
            case .failed(let error):
                startError = error
                ready.signal()
            default:
                break
            }
        }
        listener.start(queue: queue)
        ready.wait()
        if let startError { throw startError }
        guard boundPort > 0 else { throw NSError(domain: "helper", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有绑到端口"]) }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                connection.cancel()
                fputs("helper recv: \(error)\n", stderr)
                return
            }
            var next = buffer
            if let data { next.append(data) }
            if let range = next.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = next.subdata(in: next.startIndex..<range.lowerBound)
                let headerText = String(data: headerData, encoding: .utf8) ?? ""
                let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
                guard let requestLine = lines.first else {
                    connection.cancel()
                    return
                }
                let parts = requestLine.split(separator: " ")
                guard parts.count >= 2 else {
                    connection.cancel()
                    return
                }
                let method = String(parts[0])
                let path = String(parts[1])
                var headers: [String: String] = [:]
                for line in lines.dropFirst() {
                    if let idx = line.firstIndex(of: ":") {
                        let key = String(line[..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
                        let value = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
                        headers[key] = value
                    }
                }
                let contentLength = Int(headers["content-length"] ?? "0") ?? 0
                let bodyStart = range.upperBound
                let have = next.count - bodyStart
                if have < contentLength {
                    self.receive(on: connection, buffer: next)
                    return
                }
                let body = contentLength > 0 ? next.subdata(in: bodyStart..<(bodyStart + contentLength)) : Data()
                let auth = headers["authorization"] ?? ""
                let response: HelperHTTPResponse
                if auth != "Bearer \(self.token)" && path != "/" && path != "/index.html" && path != "/frame" {
                    response = HelperHTTPResponse(status: 401, json: ["failure": "token 不对"])
                } else {
                    response = self.handler.handle(method: method, path: path, body: body)
                }
                self.send(response, on: connection)
                return
            }
            if isComplete {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: next)
        }
    }

    private func send(_ response: HelperHTTPResponse, on connection: NWConnection) {
        let payload = response.body
        let header = "HTTP/1.1 \(response.status) OK\r\nContent-Type: \(response.contentType)\r\nContent-Length: \(payload.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var data = Data(header.utf8)
        data.append(payload)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

struct HelperHTTPResponse {
    let status: Int
    let contentType: String
    let body: Data

    init(status: Int, json: [String: Any]) {
        self.status = status
        self.contentType = "application/json; charset=utf-8"
        let data = (try? JSONSerialization.data(withJSONObject: json, options: [])) ?? Data("{}".utf8)
        self.body = data
    }

    init(status: Int, html: String) {
        self.status = status
        self.contentType = "text/html; charset=utf-8"
        self.body = Data(html.utf8)
    }
}
