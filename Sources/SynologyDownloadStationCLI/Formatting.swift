import Foundation

enum CLIFormatter {
    static func bytes(_ value: UInt64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useGB, .useMB, .useKB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(value))
    }

    static func progress(_ value: Double?) -> String {
        guard let value else { return "" }
        return String(format: "%.0f%%", value)
    }

    static func speed(_ value: UInt64?) -> String {
        guard let value else { return "" }
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useMB, .useKB]
        formatter.countStyle = .file
        let formatted = formatter.string(fromByteCount: Int64(value))
        return "(\(formatted)/s)"
    }

    static func timestamp(_ date: Date) -> String {
        iso8601Formatter.string(from: date)
    }

    static func optionalTimestamp(_ date: Date?) -> String {
        guard let date else { return "n/a" }
        return timestamp(date)
    }

    static func percentage(_ value: Double) -> String {
        String(format: "%.0f%%", value * 100.0)
    }

    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
