import Foundation

struct SynologyDownloadStationConfiguration {
    let host: URL
    let username: String
    let password: String
    let timeout: TimeInterval
    let allowInsecureCertificates: Bool
    let cacheSessions: Bool

    init(host: String, username: String, password: String, timeoutMilliseconds: Int = 10_000, allowInsecureCertificates: Bool, cacheSessions: Bool) throws {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !username.isEmpty else {
            throw SynologyDownloadStationError.configuration("Username cannot be empty.")
        }
        guard !password.isEmpty else {
            throw SynologyDownloadStationError.configuration("Password cannot be empty.")
        }
        guard !trimmedHost.isEmpty else {
            throw SynologyDownloadStationError.configuration("Host URL cannot be empty.")
        }
        guard let url = URL(string: trimmedHost), let scheme = url.scheme,
              scheme == "http" || scheme == "https" else {
            throw SynologyDownloadStationError.configuration("Host URL must start with http:// or https://.")
        }
        self.host = url
        self.username = username
        self.password = password
        self.timeout = TimeInterval(max(timeoutMilliseconds, 0)) / 1000.0
        self.allowInsecureCertificates = allowInsecureCertificates
        self.cacheSessions = cacheSessions
    }
}

enum SynologyDownloadStationError: Error, CustomStringConvertible {
    case configuration(String)
    case authentication(String)
    case api(code: Int, message: String)
    case invalidResponse(String)
    case network(Error)
    case unauthorized
    case sessionExpired

    var description: String {
        switch self {
        case .configuration(let message):
            return "Configuration error: \(message)"
        case .authentication(let message):
            return "Authentication failed: \(message)"
        case .api(let code, let message):
            return "Synology API error (\(code)): \(message)"
        case .invalidResponse(let message):
            return "Invalid response: \(message)"
        case .network(let error):
            return "Network error: \(error.localizedDescription)"
        case .unauthorized:
            return "Unauthorized: call authorize() before making API requests."
        case .sessionExpired:
            return "Session expired: re-run with a fresh login (provide --otp if two-step verification is enabled)."
        }
    }
}

final class SynologyDownloadStationClient {
    private let configuration: SynologyDownloadStationConfiguration
    private let session: URLSession
    private let sessionDelegate: URLSessionDelegate?
    private let decoder: JSONDecoder
    private var sid: String?
    private let apiPath = "webapi/entry.cgi"
    private let hostKey: String
    private let shouldCache: Bool

    init(configuration: SynologyDownloadStationConfiguration) {
        self.configuration = configuration
        self.hostKey = SessionStore.key(for: configuration.host.absoluteString)
        self.shouldCache = configuration.cacheSessions
        let urlConfig = URLSessionConfiguration.default
        urlConfig.timeoutIntervalForRequest = configuration.timeout
        urlConfig.timeoutIntervalForResource = configuration.timeout
        if configuration.allowInsecureCertificates {
            let delegate = InsecureURLSessionDelegate()
            self.sessionDelegate = delegate
            self.session = URLSession(configuration: urlConfig, delegate: delegate, delegateQueue: nil)
        } else {
            self.sessionDelegate = nil
            self.session = URLSession(configuration: urlConfig)
        }
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .secondsSince1970
        if configuration.cacheSessions, let cached = SessionStore.shared.load(hostKey: hostKey) {
            self.sid = cached.sid
        }
    }

    func authorize(otpCode: String? = nil) async throws {
        if otpCode == nil, shouldCache, let existingSid = sid, !existingSid.isEmpty {
            return
        }

        if otpCode != nil {
            clearCachedSid()
        }

        var params = [
            "api": "SYNO.API.Auth",
            "version": "7",
            "method": "login",
            "account": configuration.username,
            "passwd": configuration.password,
            "format": "sid"
        ]

        if let otp = otpCode, !otp.isEmpty {
            params["otp_code"] = otp
        }

        let response: SynologyResponse<AuthData> = try await postForm(params, includeSid: false)
        if response.success, let data = response.data {
            sid = data.sid
            if shouldCache {
                var cached = SessionStore.shared.load(hostKey: hostKey) ?? SessionStateStorage(username: configuration.username, password: configuration.password, destination: nil, sid: nil, expiresAt: nil)
                cached.sid = data.sid
                cached.username = configuration.username
                cached.password = configuration.password
                SessionStore.shared.save(hostKey: hostKey, state: cached)
            }
        } else if let error = response.error {
            throw SynologyDownloadStationError.api(code: error.code, message: "Authentication failed.")
        } else {
            throw SynologyDownloadStationError.authentication("Authentication succeeded but no session returned.")
        }
    }

    func listTasks() async throws -> Tasks {
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "list",
            "additional": #"["transfer","detail"]"#
        ]

        let response: SynologyResponse<Tasks> = try await postForm(params)
        return try parse(response, context: "Failed to list tasks.")
    }

    func taskInfo(ids: [String]) async throws -> TaskInfo {
        guard !ids.isEmpty else {
            throw SynologyDownloadStationError.configuration("Task IDs cannot be empty.")
        }
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "get",
            "id": ids.joined(separator: ","),
            "additional": #"["transfer","detail"]"#
        ]

        let response: SynologyResponse<TaskInfo> = try await postForm(params)
        return try parse(response, context: "Failed to fetch task info.")
    }

    func createTask(from url: String, destination: String?) async throws {
        guard !url.isEmpty else {
            throw SynologyDownloadStationError.configuration("URI cannot be empty.")
        }
        guard url.hasPrefix("http://") || url.hasPrefix("https://") || url.hasPrefix("magnet:") else {
            throw SynologyDownloadStationError.configuration("URI must start with http://, https://, or magnet:.")
        }

        var params: [String: String] = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "create",
            "type": "\"url\"",
            "url": url,
            "create_list": "false"
        ]

        if let destination, let trimmed = destination.nonEmptyTrimmed {
            params["destination"] = trimmed
        }

        let response: SynologyResponse<TaskCreated> = try await postForm(params)
        _ = try parse(response, context: "Failed to create task.")
    }

    func createTaskFromFile(data: Data, fileName: String, destination: String?) async throws {
        guard !data.isEmpty else {
            throw SynologyDownloadStationError.configuration("File data cannot be empty.")
        }
        guard !fileName.isEmpty else {
            throw SynologyDownloadStationError.configuration("File name cannot be empty.")
        }

        var fields: [String: String] = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "create",
            "type": "\"file\"",
            "file": "[\"torrent\"]",
            "create_list": "false"
        ]

        if let destination, let trimmed = destination.nonEmptyTrimmed {
            fields["destination"] = "\"\(trimmed)\""
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var payload = Data()

        for (name, value) in fields {
            payload.append(string: "--\(boundary)\r\n")
            payload.append(string: "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            payload.append(string: "\(value)\r\n")
        }

        guard let sid else {
            throw SynologyDownloadStationError.unauthorized
        }
        payload.append(string: "--\(boundary)\r\n")
        payload.append(string: "Content-Disposition: form-data; name=\"_sid\"\r\n\r\n")
        payload.append(string: "\(sid)\r\n")

        payload.append(string: "--\(boundary)\r\n")
        payload.append(
            string: "Content-Disposition: form-data; name=\"torrent\"; filename=\"\(fileName)\"\r\n"
        )
        payload.append(string: "Content-Type: application/x-bittorrent\r\n\r\n")
        payload.append(data)
        payload.append(string: "\r\n")
        payload.append(string: "--\(boundary)--\r\n")

        var request = URLRequest(url: endpointURL)
        request.httpMethod = "POST"
        request.httpBody = payload
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await session.data(for: request)
        } catch {
            throw SynologyDownloadStationError.network(error)
        }
        try validate(response: response, data: responseData)
        let responseModel = try decoder.decode(SynologyResponse<TaskCreated>.self, from: responseData)
        _ = try parse(responseModel, context: "Failed to create task from file.")
    }

    func pauseTask(id: String) async throws {
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "pause",
            "id": id
        ]
        let response: SynologyResponse<EmptyResponse> = try await postForm(params)
        try parseVoid(response, context: "Failed to pause task.")
    }

    func resumeTask(id: String) async throws -> TaskOperation {
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "resume",
            "id": id
        ]
        let response: SynologyResponse<TaskOperation> = try await postForm(params)
        return try parse(response, context: "Failed to resume task.")
    }

    func completeTask(id: String) async throws -> TaskCompleted {
        let params = [
            "api": "SYNO.DownloadStation2.Task.Complete",
            "version": "1",
            "method": "start",
            "id": id
        ]
        let response: SynologyResponse<TaskCompleted> = try await postForm(params)
        return try parse(response, context: "Failed to complete task.")
    }

    func deleteTask(id: String, force: Bool) async throws -> TaskOperation {
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "delete",
            "id": id,
            "force_complete": force ? "true" : "false"
        ]
        let response: SynologyResponse<TaskOperation> = try await postForm(params)
        return try parse(response, context: "Failed to delete task.")
    }

    func clearCompleted() async throws {
        let params = [
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "delete_condition",
            "status": String(TaskStatus.finished.rawCode)
        ]
        let response: SynologyResponse<EmptyResponse> = try await postForm(params)
        try parseVoid(response, context: "Failed to clear completed tasks.")
    }

    // MARK: - Private helpers

    private var endpointURL: URL {
        configuration.host.appendingPathComponent(apiPath)
    }

    private func postForm<D: Decodable>(_ params: [String: String], includeSid: Bool = true) async throws -> SynologyResponse<D> {
        var payload = params
        if includeSid {
            guard let sid else {
                throw SynologyDownloadStationError.unauthorized
            }
            payload["_sid"] = sid
        }
        var components = URLComponents()
        components.queryItems = payload.map { URLQueryItem(name: $0.key, value: $0.value) }
        let bodyString = components.percentEncodedQuery ?? ""

        var request = URLRequest(url: endpointURL)
        request.httpMethod = "POST"
        request.httpBody = Data(bodyString.utf8)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw SynologyDownloadStationError.network(error)
        }
        try validate(response: response, data: data)
        return try decoder.decode(SynologyResponse<D>.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw SynologyDownloadStationError.invalidResponse("Expected HTTP response.")
        }
        guard 200..<300 ~= http.statusCode else {
            if http.statusCode == 401 {
                invalidateSessionCache()
                throw SynologyDownloadStationError.sessionExpired
            }
            let body = String(data: data, encoding: .utf8) ?? "<unreadable>"
            throw SynologyDownloadStationError.api(code: http.statusCode, message: "HTTP error: \(body)")
        }
    }

    private func parse<D>(_ response: SynologyResponse<D>, context: String) throws -> D {
        if response.success, let data = response.data {
            return data
        }
        if let error = response.error {
            if error.code == 119 {
                invalidateSessionCache()
                throw SynologyDownloadStationError.sessionExpired
            }
            throw SynologyDownloadStationError.api(code: error.code, message: context)
        }
        throw SynologyDownloadStationError.invalidResponse("\(context) Missing response data.")
    }

    private func parseVoid(_ response: SynologyResponse<EmptyResponse>, context: String) throws {
        if response.success {
            return
        }
        if let error = response.error {
            if error.code == 119 {
                invalidateSessionCache()
                throw SynologyDownloadStationError.sessionExpired
            }
            throw SynologyDownloadStationError.api(code: error.code, message: context)
        }
        throw SynologyDownloadStationError.invalidResponse(context)
    }

    private func invalidateSessionCache() {
        sid = nil
        if shouldCache {
            if var cached = SessionStore.shared.load(hostKey: hostKey) {
                cached.sid = nil
                SessionStore.shared.save(hostKey: hostKey, state: cached)
            }
        }
    }

    private func clearCachedSid() {
        sid = nil
        if shouldCache {
            if var cached = SessionStore.shared.load(hostKey: hostKey) {
                cached.sid = nil
                SessionStore.shared.save(hostKey: hostKey, state: cached)
            }
        }
    }
}

private extension Data {
    mutating func append(string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}

private final class InsecureURLSessionDelegate: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
