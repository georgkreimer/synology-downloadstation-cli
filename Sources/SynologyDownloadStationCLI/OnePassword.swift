import Foundation

struct OnePasswordCredentials: Decodable {
    let username: String
    let password: String
    let totp: String?
}

struct OnePasswordProvider {
    private struct Item: Decodable {
        struct Field: Decodable {
            let id: String?
            let label: String?
            let purpose: String?
            let value: String?
        }

        let fields: [Field]
        let otp: String?
        let sectionList: [Section]?

        struct Section: Decodable {
            struct SectionField: Decodable {
                let id: String?
                let label: String?
                let value: String?
            }
            let fields: [SectionField]?
        }

        enum CodingKeys: String, CodingKey {
            case fields
            case otp = "totp"
            case sectionList = "sections"
        }
    }

    func fetch(item: String, vault: String?) throws -> OnePasswordCredentials {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var arguments = ["op", "item", "get", item, "--format", "json"]
        if let vault, !vault.isEmpty {
            arguments.append(contentsOf: ["--vault", vault])
        }
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            throw NSError(domain: "OnePasswordProvider", code: -2, userInfo: [NSLocalizedDescriptionKey: "Unable to launch 'op' CLI. Ensure 1Password CLI is installed and available in PATH."])
        }
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let errorMessage = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "OnePasswordProvider", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: errorMessage.trimmingCharacters(in: .whitespacesAndNewlines)])
        }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        let decoder = JSONDecoder()
        let itemObject = try decoder.decode(Item.self, from: data)

        guard let username = value(for: ["username", "user"], in: itemObject) else {
            throw NSError(domain: "OnePasswordProvider", code: -1, userInfo: [NSLocalizedDescriptionKey: "1Password item missing username field"])
        }
        guard let password = value(for: ["password"], in: itemObject) else {
            throw NSError(domain: "OnePasswordProvider", code: -1, userInfo: [NSLocalizedDescriptionKey: "1Password item missing password field"])
        }

        let totp = itemObject.otp
            ?? value(for: ["otp", "totp", "one-time password", "one-time", "2fa", "mfa"], in: itemObject)
        return OnePasswordCredentials(username: username, password: password, totp: totp)
    }

    private func value(for keys: [String], in item: Item) -> String? {
        for field in item.fields {
            if let id = field.id?.lowercased(), keys.contains(id) { return field.value }
            if let label = field.label?.lowercased(), keys.contains(label) { return field.value }
            if let purpose = field.purpose?.lowercased(), keys.contains(purpose) { return field.value }
        }
        if let sections = item.sectionList {
            for section in sections {
                if let fields = section.fields {
                    for field in fields {
                        if let id = field.id?.lowercased(), keys.contains(id) { return field.value }
                        if let label = field.label?.lowercased(), keys.contains(label) { return field.value }
                    }
                }
            }
        }
        return nil
    }

    func fetchTotpCode(item: String, vault: String?) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        var arguments = ["op", "item", "get", item, "--otp"]
        if let vault, !vault.isEmpty {
            arguments.append(contentsOf: ["--vault", vault])
        }
        process.arguments = arguments

        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return nil
        }
        process.waitUntilExit()

        guard process.terminationStatus == 0 else { return nil }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        guard let code = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !code.isEmpty else {
            return nil
        }
        return code
    }
}
