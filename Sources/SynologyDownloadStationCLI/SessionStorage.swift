import Foundation

struct SessionStateStorage: Codable {
    var username: String
    var password: String
    var destination: String?
    var sid: String?
    var expiresAt: Date?
}

final class SessionStore {
    private let fileURL: URL
    private var memoryCache: [String: SessionStateStorage] = [:]

    init() {
        let base = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".config", isDirectory: true)
            .appendingPathComponent("synology-ds", isDirectory: true)
        fileURL = base.appendingPathComponent("sessions.json")
        let fm = FileManager.default
        if !fm.fileExists(atPath: base.path) {
            try? fm.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: NSNumber(value: Int16(0o700))])
        }
        if let data = try? Data(contentsOf: fileURL) {
            memoryCache = (try? JSONDecoder().decode([String: SessionStateStorage].self, from: data)) ?? [:]
        }
    }

    func load(hostKey: String) -> SessionStateStorage? {
        memoryCache[hostKey]
    }

    func save(hostKey: String, state: SessionStateStorage) {
        memoryCache[hostKey] = state
        persist()
    }

    func delete(hostKey: String) {
        memoryCache.removeValue(forKey: hostKey)
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(memoryCache) else { return }
        try? data.write(to: fileURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: NSNumber(value: Int16(0o600))], ofItemAtPath: fileURL.path)
    }
}

extension SessionStore {
    static let shared = SessionStore()

    static func key(for host: String) -> String {
        host.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()
    }
}
