import Foundation

struct CLIOptions {
    enum Command {
        case interactive
        case help
        case listTasks
        case taskInfo(id: String)
        case create(url: String, destination: String?)
        case createFile(filePath: String, destination: String?)
        case pause(id: String)
        case resume(id: String)
        case complete(id: String)
        case delete(id: String, force: Bool)
        case clearCompleted
        case authCheck
    }

    let host: String
    let allowInsecureCertificates: Bool
    let useSessionCache: Bool
    let opItemIdentifier: String?
    let opVault: String?
    let command: Command
}

enum CLIError: LocalizedError {
    case missingCommand
    case missingCredential(String)
    case unknownCommand(String)
    case missingArgument(String)
    case invalidFlag(String)

    var errorDescription: String? {
        switch self {
        case .missingCommand:
            return "No command provided. Run 'synology-ds help' to see available commands."
        case .missingCredential(let key):
            return "Missing required credential: \(key). Provide it via flag or environment variable."
        case .unknownCommand(let command):
            return "Unknown command '\(command)'. Run 'synology-ds help' for usage."
        case .missingArgument(let argument):
            return "Missing value for \(argument)."
        case .invalidFlag(let flag):
            return "Invalid flag format '\(flag)'. Use --key value or --key=value."
        }
    }
}

struct CLIParser {
    private static let hostKeys = ["--host", "--url"]
    private static let insecureKeys = ["--insecure", "--skip-tls-verify"]
    private static let disableSessionCacheKeys = ["--no-session-cache", "--no-cache"]
    private static let enableSessionCacheKeys = ["--session-cache"]
    private static let opItemKeys = ["--op-item", "--op-item-id"]
    private static let opVaultKeys = ["--op-vault"]

    func parse(_ arguments: [String]) throws -> CLIOptions {
        let tokens = Array(arguments.dropFirst())
        var host = ProcessInfo.processInfo.environment["SYNOLOGY_URL"]
        var insecure = false
        var useSessionCache = true
        var opItem = ProcessInfo.processInfo.environment["SYNOLOGY_OP_ITEM"]
        var opVault = ProcessInfo.processInfo.environment["SYNOLOGY_OP_VAULT"]

        var positionals: [String] = []
        var index = 0

        while index < tokens.count {
            let token = tokens[index]

            if let match = matchingFlag(token, keys: Self.hostKeys) {
                switch match {
                case .inline(let value):
                    host = value
                    index += 1
                case .separate:
                    index += 1
                    guard index < tokens.count else {
                        throw CLIError.missingArgument(token)
                    }
                    host = tokens[index]
                    index += 1
                }
                continue
            }

            if matchingFlag(token, keys: Self.insecureKeys) != nil {
                insecure = true
                index += 1
                continue
            }

            if Self.disableSessionCacheKeys.contains(token) {
                useSessionCache = false
                index += 1
                continue
            }

            if Self.enableSessionCacheKeys.contains(token) {
                useSessionCache = true
                index += 1
                continue
            }

            if let match = matchingFlag(token, keys: Self.opItemKeys) {
                switch match {
                case .inline(let value):
                    opItem = value
                    index += 1
                case .separate:
                    index += 1
                    guard index < tokens.count else {
                        throw CLIError.missingArgument(token)
                    }
                    opItem = tokens[index]
                    index += 1
                }
                continue
            }

            if let match = matchingFlag(token, keys: Self.opVaultKeys) {
                switch match {
                case .inline(let value):
                    opVault = value
                    index += 1
                case .separate:
                    index += 1
                    guard index < tokens.count else {
                        throw CLIError.missingArgument(token)
                    }
                    opVault = tokens[index]
                    index += 1
                }
                continue
            }

            positionals.append(token)
            index += 1
        }

        let command: CLIOptions.Command
        if let commandName = positionals.first {
            let commandArgs = Array(positionals.dropFirst())
            command = try parseCommand(name: commandName, arguments: commandArgs)
        } else {
            command = .interactive
        }

        let resolvedHost = host ?? ""

        return CLIOptions(
            host: resolvedHost,
            allowInsecureCertificates: insecure,
            useSessionCache: useSessionCache,
            opItemIdentifier: opItem,
            opVault: opVault,
            command: command
        )
    }

    func parseCommand(name: String, arguments: [String]) throws -> CLIOptions.Command {
        switch name {
        case "help", "--help", "-h":
            return .help
        case "list":
            return .listTasks
        case "info":
            guard let id = arguments.first else {
                throw CLIError.missingArgument("task id (synology-ds info <task-id>)")
            }
            return .taskInfo(id: id)
        case "create":
            return try parseCreate(arguments)
        case "create-file":
            return try parseCreateFile(arguments)
        case "pause":
            guard let id = arguments.first else {
                throw CLIError.missingArgument("task id (synology-ds pause <task-id>)")
            }
            return .pause(id: id)
        case "resume":
            guard let id = arguments.first else {
                throw CLIError.missingArgument("task id (synology-ds resume <task-id>)")
            }
            return .resume(id: id)
        case "complete":
            guard let id = arguments.first else {
                throw CLIError.missingArgument("task id (synology-ds complete <task-id>)")
            }
            return .complete(id: id)
        case "delete":
            guard let id = arguments.first else {
                throw CLIError.missingArgument("task id (synology-ds delete <task-id> [--force])")
            }
            let force = arguments.contains("--force")
            return .delete(id: id, force: force)
        case "clear-completed":
            return .clearCompleted
        case "auth-check":
            return .authCheck
        case "interactive":
            return .interactive
        default:
            throw CLIError.unknownCommand(name)
        }
    }

    func parseCreate(_ arguments: [String]) throws -> CLIOptions.Command {
        var url: String?
        var destination: String?
        var index = 0
        let args = arguments
        while index < args.count {
            let arg = args[index]
            if arg == "--url" || arg.hasPrefix("--url=") {
                url = try extractValue(after: &index, in: args)
                continue
            }
            if arg == "--destination" || arg.hasPrefix("--destination=") {
                destination = try extractValue(after: &index, in: args)
                continue
            }
            index += 1
        }

        guard let finalUrl = url else {
            throw CLIError.missingArgument("--url")
        }
        return .create(url: finalUrl, destination: destination)
    }

    func parseCreateFile(_ arguments: [String]) throws -> CLIOptions.Command {
        var file: String?
        var destination: String?
        var index = 0
        let args = arguments
        while index < args.count {
            let arg = args[index]
            if arg == "--file" || arg.hasPrefix("--file=") {
                file = try extractValue(after: &index, in: args)
                continue
            }
            if arg == "--destination" || arg.hasPrefix("--destination=") {
                destination = try extractValue(after: &index, in: args)
                continue
            }
            index += 1
        }

        guard let finalFile = file else {
            throw CLIError.missingArgument("--file")
        }
        return .createFile(filePath: finalFile, destination: destination)
    }

    func extractValue(after index: inout Int, in arguments: [String]) throws -> String {
        let current = arguments[index]
        if let equalsIndex = current.firstIndex(of: "=") {
            let valueStart = current.index(after: equalsIndex)
            let value = String(current[valueStart...])
            index += 1
            return value
        }
        index += 1
        guard index < arguments.count else {
            throw CLIError.missingArgument(current)
        }
        let value = arguments[index]
        index += 1
        return value
    }

    private enum FlagMatch {
        case inline(String)
        case separate
    }

    private func matchingFlag(_ token: String, keys: [String]) -> FlagMatch? {
        for key in keys {
            if token == key {
                return .separate
            }
            if token.hasPrefix("\(key)=") {
                let value = String(token.dropFirst(key.count + 1))
                return .inline(value)
            }
        }
        return nil
    }
}

struct CLIPrinter {
    func printTaskSummary(_ tasks: Tasks) {
        if tasks.task.isEmpty {
            print("No active tasks.")
            return
        }
        for task in tasks.task {
            let size = CLIFormatter.bytes(task.size)
            let progress = CLIFormatter.progress(task.progress)
            let speed = CLIFormatter.speed(task.transferSpeed)
            print("- \(task.title) [\(task.id)]")
            print("  Status: \(task.status.description) \(progress) \(speed)")
            print("  Size: \(size)")
            if let destination = task.additional?.detail?.destination {
                print("  Destination: \(destination)")
            }
        }
    }

    func printTaskDetails(_ info: TaskInfo) {
        guard let task = info.task.first else {
            print("Task not found.")
            return
        }
        let size = CLIFormatter.bytes(task.size)
        print("Task \(task.id)")
        print("Title: \(task.title)")
        print("User: \(task.username)")
        print("Type: \(task.taskType)")
        print("Status: \(task.status.description)")
        print("Progress: \(CLIFormatter.progress(task.progress))")
        print("Speed: \(CLIFormatter.speed(task.transferSpeed))")
        print("Size: \(size)")
        if let detail = task.additional?.detail {
            print("Created: \(CLIFormatter.timestamp(detail.createdTime))")
            print("Started: \(CLIFormatter.timestamp(detail.startedTime))")
            print("Completed: \(CLIFormatter.optionalTimestamp(detail.completedTime))")
            print("Destination: \(detail.destination)")
            print("URI: \(detail.uri)")
        }
        if let files = task.additional?.file, !files.isEmpty {
            print("Files:")
            for file in files {
                print("  - \(file.filename) (\(CLIFormatter.bytes(file.size)))")
            }
        }
        if let peers = task.additional?.peer, !peers.isEmpty {
            print("Peers:")
            for peer in peers {
                print("  - \(peer.address) progress \(CLIFormatter.percentage(peer.progress))")
            }
        }
    }

    func printTaskOperation(_ operation: TaskOperation, verb: String) {
        if operation.failedTask.isEmpty {
            print("\(verb) operation succeeded.")
        } else {
            print("\(verb) operation completed with \(operation.failedTask.count) failures:")
            for task in operation.failedTask {
                print("  - \(task.id): error \(task.error)")
            }
        }
    }

    func printSuccess(_ message: String) {
        print(message)
    }

    static func printUsage() {
        print("""
        Synology Download Station CLI
        Usage:
          synology-ds [global flags] <command> [command options]
          (omit <command> to enter the interactive shell; type 'exit' to quit)

        Global flags:
          --host <url>           Synology base URL (https://host:port)
          --insecure             Skip TLS certificate verification (use with caution)
          --no-session-cache     Disable on-disk session caching (enabled by default)
          --op-item <id>         Fetch credentials from 1Password item (requires `op` CLI in PATH)
          --op-vault <vault>     Optional 1Password vault to use with --op-item

        Credentials and one-time codes are requested interactively when needed.

        Commands:
          help                   Show this help text
          auth-check             Validate credentials
          list                   List all download tasks
          info <task-id>         Show detailed task information
          create --url <uri> [--destination <path>]
                               Create a task from HTTP/magnet link
          create-file --file <torrent> [--destination <path>]
                               Create a task from a torrent file
          pause <task-id>        Pause the specified task
          resume <task-id>       Resume the specified task
          complete <task-id>     Mark the task as complete
          delete <task-id> [--force]
                               Delete the task (optionally force complete unfinished)
          clear-completed        Remove all completed tasks

        Environment variables:
          SYNOLOGY_URL
        """)
    }

    static func printError(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}
