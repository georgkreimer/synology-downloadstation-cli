import Foundation
import Darwin

struct SessionState {
    let host: String
    var defaultDestination: String?
    let useSessionCache: Bool
}

@main
struct SynologyDownloadStationMain {
    static func main() async {
        do {
            let parser = CLIParser()
            let options = try parser.parse(CommandLine.arguments)
            if case .help = options.command {
                CLIPrinter.printUsage()
                return
            }
            var hostInput = options.host.trimmingCharacters(in: .whitespacesAndNewlines)
            if hostInput.isEmpty {
                hostInput = promptForValue("Synology URL: ")
            }

            var canonicalHost = canonicalizeHost(hostInput)
            var hostKey = SessionStore.key(for: canonicalHost)
            var storedCredentials: (username: String, password: String)? = nil
            if options.useSessionCache, options.opItemIdentifier == nil, let cached = SessionStore.shared.load(hostKey: hostKey) {
                storedCredentials = (cached.username, cached.password)
            }

            var username = storedCredentials?.username ?? ""
            var password = storedCredentials?.password ?? ""
            var otpCode: String? = nil

            let opItemIdentifier = options.opItemIdentifier
            let opVault = options.opVault
            var opProvider: OnePasswordProvider?
            if let opItemIdentifier {
                do {
                    let provider = OnePasswordProvider()
                    let creds = try provider.fetch(item: opItemIdentifier, vault: opVault)
                    username = creds.username
                    password = creds.password
                    if let totp = creds.totp, !totp.isEmpty {
                        otpCode = totp
                    }
                    opProvider = provider
                } catch {
                    CLIPrinter.printError("Failed to load 1Password item: \(error.localizedDescription)")
                }
            }

            if username.isEmpty {
                username = promptForValue("Username: ")
            }
            if password.isEmpty {
                password = promptForPassword("Password: ")
            }

            var activeClient: SynologyDownloadStationClient?
            var activeConfig: SynologyDownloadStationConfiguration?

            let shouldPersistCredentials = options.useSessionCache && options.opItemIdentifier == nil

            while activeClient == nil {
                if let provider = opProvider, let opItem = opItemIdentifier {
                    if let freshTotp = provider.fetchTotpCode(item: opItem, vault: opVault), !freshTotp.isEmpty {
                        otpCode = freshTotp
                    }
                }
                if shouldPersistCredentials, username.isEmpty || password.isEmpty,
                   let cached = SessionStore.shared.load(hostKey: hostKey) {
                    if username.isEmpty { username = cached.username }
                    if password.isEmpty { password = cached.password }
                }
                do {
                    let config = try SynologyDownloadStationConfiguration(
                        host: hostInput,
                        username: username,
                        password: password,
                        allowInsecureCertificates: options.allowInsecureCertificates,
                        cacheSessions: shouldPersistCredentials
                    )
                    let client = SynologyDownloadStationClient(configuration: config)
                    if let otp = otpCode, !otp.isEmpty {
                        try await client.authorize(otpCode: otp)
                    } else {
                        try await client.authorize()
                    }
                    canonicalHost = config.host.absoluteString
                    hostKey = SessionStore.key(for: canonicalHost)
                    activeClient = client
                    activeConfig = config
                } catch let error as SynologyDownloadStationError {
                    if case .api(let code, _) = error, (code == 403 || code == 404) {
                        if let provider = opProvider, let opItem = opItemIdentifier {
                            if let freshTotp = provider.fetchTotpCode(item: opItem, vault: opVault), !freshTotp.isEmpty {
                                otpCode = freshTotp
                                continue
                            }
                        }
                        if otpCode == nil || otpCode?.isEmpty == true {
                            otpCode = promptForOTP()
                            if otpCode?.isEmpty ?? true {
                                CLIPrinter.printError(error.description)
                                throw error
                            }
                            continue
                        }
                    }

                    CLIPrinter.printError(error.description)
                    switch error {
                    case .configuration:
                        hostInput = promptForValue("Synology URL: ")
                        canonicalHost = canonicalizeHost(hostInput)
                        hostKey = SessionStore.key(for: canonicalHost)
                        if shouldPersistCredentials, let cached = SessionStore.shared.load(hostKey: hostKey) {
                            username = cached.username
                            password = cached.password
                        } else {
                            username = promptForValue("Username: ")
                            password = promptForPassword("Password: ")
                        }
                        otpCode = nil
                        continue
                    case .api:
                        CLIPrinter.printError("Authentication failed. Please re-enter credentials.")
                        if shouldPersistCredentials {
                            SessionStore.shared.delete(hostKey: hostKey)
                        }
                        otpCode = nil
                        username = promptForValue("Username: ")
                        password = promptForPassword("Password: ")
                        continue
                    case .sessionExpired:
                        if shouldPersistCredentials {
                            SessionStore.shared.delete(hostKey: hostKey)
                        }
                        otpCode = promptForOTP()
                        if otpCode?.isEmpty ?? true {
                            throw error
                        }
                        continue
                    default:
                        throw error
                    }
                }
            }

            guard let client = activeClient, let config = activeConfig else {
                throw SynologyDownloadStationError.configuration("Failed to initialize Download Station client.")
            }

            var cachedDestination: String? = nil
            if shouldPersistCredentials, let cached = SessionStore.shared.load(hostKey: hostKey) {
                cachedDestination = cached.destination
                if cached.username.isEmpty {
                    var updated = cached
                    updated.username = username
                    updated.password = password
                    SessionStore.shared.save(hostKey: hostKey, state: updated)
                }
            }

            var sessionState = SessionState(
                host: hostKey,
                defaultDestination: cachedDestination,
                useSessionCache: shouldPersistCredentials
            )
            if shouldPersistCredentials {
                var saved = SessionStore.shared.load(hostKey: hostKey) ?? SessionStateStorage(username: username, password: password, destination: cachedDestination, sid: nil, expiresAt: nil)
                saved.username = username
                saved.password = password
                if saved.destination == nil {
                    saved.destination = cachedDestination
                }
                SessionStore.shared.save(hostKey: hostKey, state: saved)
            }

            let printer = CLIPrinter()
            if case .interactive = options.command {
                printer.printSuccess("Connected to \(config.host.absoluteString) as \(config.username). Type 'help' for commands, 'exit' to quit.")
                await runInteractiveSession(client: client, printer: printer, state: &sessionState)
            } else {
                try await performCommand(options.command, client: client, printer: printer, state: &sessionState)
            }
        } catch let error as CLIError {
            CLIPrinter.printError(error.localizedDescription)
            Foundation.exit(EXIT_FAILURE)
        } catch let error as SynologyDownloadStationError {
            CLIPrinter.printError(error.description)
            Foundation.exit(EXIT_FAILURE)
        } catch {
            CLIPrinter.printError(error.localizedDescription)
            Foundation.exit(EXIT_FAILURE)
        }
    }
}

private func performCommand(_ command: CLIOptions.Command, client: SynologyDownloadStationClient, printer: CLIPrinter, state: inout SessionState) async throws {
    switch command {
    case .interactive:
        return
    case .help:
        CLIPrinter.printUsage()
    case .listTasks:
        let tasks = try await client.listTasks()
        captureDestination(from: tasks, state: &state)
        printer.printTaskSummary(tasks)
    case .taskInfo(let id):
        let info = try await client.taskInfo(ids: [id])
        printer.printTaskDetails(info)
    case .create(let url, let destination):
        try await handleCreateTask(url: url, destination: destination, client: client, printer: printer, state: &state)
    case .createFile(let filePath, let destination):
        let data = try Data(contentsOf: URL(fileURLWithPath: filePath))
        let fileName = URL(fileURLWithPath: filePath).lastPathComponent
        try await handleCreateFileTask(fileName: fileName, data: data, destination: destination, client: client, printer: printer, state: &state)
    case .pause(let id):
        try await client.pauseTask(id: id)
        printer.printSuccess("Paused task \(id)")
    case .resume(let id):
        let operation = try await client.resumeTask(id: id)
        printer.printTaskOperation(operation, verb: "Resume")
    case .complete(let id):
        let result = try await client.completeTask(id: id)
        printer.printSuccess("Marked task \(result.taskId) as complete")
    case .delete(let id, let force):
        let operation = try await client.deleteTask(id: id, force: force)
        printer.printTaskOperation(operation, verb: "Delete")
    case .clearCompleted:
        try await client.clearCompleted()
        printer.printSuccess("Cleared completed tasks")
    case .authCheck:
        printer.printSuccess("Authentication successful")
    }
}

private func handleCreateTask(url: String, destination: String?, client: SynologyDownloadStationClient, printer: CLIPrinter, state: inout SessionState) async throws {
    var attemptDestination = resolvedDestination(destination, state: state)
    var prompted = false

    while true {
        do {
            try await client.createTask(from: url, destination: attemptDestination)
            printer.printSuccess("Created task for \(url)")
            let storedDestination = destination?.nonEmptyTrimmed ?? attemptDestination?.nonEmptyTrimmed
            captureDestination(storedDestination, state: &state)
            return
        } catch let error as SynologyDownloadStationError {
            guard case .api(let code, _) = error, code == 120, !prompted else {
                throw error
            }
            prompted = true
            let input = promptForValue("Download destination: ", allowEmpty: true)
            attemptDestination = input.nonEmptyTrimmed
        }
    }
}

private func handleCreateFileTask(fileName: String, data: Data, destination: String?, client: SynologyDownloadStationClient, printer: CLIPrinter, state: inout SessionState) async throws {
    var attemptDestination = resolvedDestination(destination, state: state)
    var prompted = false

    while true {
        do {
            try await client.createTaskFromFile(data: data, fileName: fileName, destination: attemptDestination)
            printer.printSuccess("Created task from file \(fileName)")
            let storedDestination = destination?.nonEmptyTrimmed ?? attemptDestination?.nonEmptyTrimmed
            captureDestination(storedDestination, state: &state)
            return
        } catch let error as SynologyDownloadStationError {
            guard case .api(let code, _) = error, code == 120, !prompted else {
                throw error
            }
            prompted = true
            let input = promptForValue("Download destination: ", allowEmpty: true)
            attemptDestination = input.nonEmptyTrimmed
        }
    }
}

private func resolvedDestination(_ candidate: String?, state: SessionState) -> String? {
    if let trimmed = candidate?.nonEmptyTrimmed {
        return trimmed
    }
    return state.defaultDestination?.nonEmptyTrimmed
}

private func captureDestination(_ path: String?, state: inout SessionState) {
    guard let value = path?.nonEmptyTrimmed else { return }
    state.defaultDestination = value
    if state.useSessionCache, !state.host.isEmpty {
        var saved = SessionStore.shared.load(hostKey: state.host) ?? SessionStateStorage(username: "", password: "", destination: nil, sid: nil, expiresAt: nil)
        saved.destination = value
        SessionStore.shared.save(hostKey: state.host, state: saved)
    }
}

private func captureDestination(from tasks: Tasks, state: inout SessionState) {
    guard state.defaultDestination == nil else { return }
    if let value = tasks.task.compactMap({ task in
        task.additional?.detail?.destination.nonEmptyTrimmed
    }).first {
        captureDestination(value, state: &state)
    }
}

private func runInteractiveSession(client: SynologyDownloadStationClient, printer: CLIPrinter, state: inout SessionState) async {
    let parser = CLIParser()

    while true {
        print("synology-ds> ", terminator: "")
        fflush(stdout)
        guard let line = readLine() else { break }
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            continue
        }
        let lower = trimmed.lowercased()
        if lower == "exit" || lower == "quit" {
            break
        }

        let tokens = tokenizeCommandLine(trimmed)
        guard let commandName = tokens.first else { continue }
        let args = Array(tokens.dropFirst())

        do {
            let command = try parser.parseCommand(name: commandName, arguments: args)
            if case .interactive = command {
                continue
            }
            try await performCommand(command, client: client, printer: printer, state: &state)
            switch command {
            case .create, .createFile, .pause, .resume, .complete, .delete, .clearCompleted:
                await refreshTaskList(client: client, printer: printer, state: &state)
            default:
                break
            }
        } catch let error as CLIError {
            CLIPrinter.printError(error.localizedDescription)
        } catch let error as SynologyDownloadStationError {
            CLIPrinter.printError(error.description)
        } catch {
            CLIPrinter.printError(error.localizedDescription)
        }
    }
}

private func refreshTaskList(client: SynologyDownloadStationClient, printer: CLIPrinter, state: inout SessionState) async {
    do {
        try await performCommand(.listTasks, client: client, printer: printer, state: &state)
    } catch let error as SynologyDownloadStationError {
        CLIPrinter.printError(error.description)
    } catch {
        CLIPrinter.printError(error.localizedDescription)
    }
}

private func tokenizeCommandLine(_ input: String) -> [String] {
    var tokens: [String] = []
    var current = ""
    var inQuotes = false
    var quoteChar: Character?
    var escape = false

    for character in input {
        if escape {
            current.append(character)
            escape = false
            continue
        }

        if character == "\\" {
            escape = true
            continue
        }

        if character == "\"" || character == "'" {
            if inQuotes {
                if character == quoteChar {
                    inQuotes = false
                    quoteChar = nil
                } else {
                    current.append(character)
                }
            } else {
                inQuotes = true
                quoteChar = character
            }
            continue
        }

        if character.isWhitespace && !inQuotes {
            if !current.isEmpty {
                tokens.append(current)
                current = ""
            }
        } else {
            current.append(character)
        }
    }

    if !current.isEmpty {
        tokens.append(current)
    }

    return tokens
}

private func promptForValue(_ prompt: String, allowEmpty: Bool = false) -> String {
    while true {
        print(prompt, terminator: "")
        fflush(stdout)
        guard let line = readLine() else { continue }
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if allowEmpty || !trimmed.isEmpty {
            return trimmed
        }
    }
}

private func promptForPassword(_ prompt: String) -> String {
    var password = ""
    while password.isEmpty {
        prompt.withCString { cString in
            if let cString = getpass(cString) {
                password = String(cString: cString).trimmingCharacters(in: .newlines)
            }
        }
    }
    return password
}

private func promptForOTP() -> String {
    promptForValue("One-time code (leave blank to cancel): ", allowEmpty: true)
}

private func canonicalizeHost(_ host: String) -> String {
    host.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
}

extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
