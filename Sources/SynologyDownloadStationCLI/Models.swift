import Foundation

struct SynologyResponse<D: Decodable>: Decodable {
    let success: Bool
    let data: D?
    let error: SynologyErrorResponse?
}

struct SynologyErrorResponse: Decodable {
    let code: Int
    let errors: TaskOperation?
}

struct AuthData: Decodable {
    let account: String?
    let deviceId: String?
    let ikMessage: String?
    let isPortalPort: Bool?
    let sid: String
    let synologyToken: String?

    private enum CodingKeys: String, CodingKey {
        case account
        case deviceId = "device_id"
        case ikMessage = "ik_message"
        case isPortalPort = "is_portal_port"
        case sid
        case synologyToken = "synotoken"
    }
}

struct Tasks: Decodable {
    let offset: Int
    let task: [Task]
    let total: Int
}

struct TaskInfo: Decodable {
    let task: [Task]
}

struct Task: Decodable {
    let id: String
    let username: String
    let taskType: String
    let title: String
    let size: UInt64
    let status: TaskStatus
    let statusExtra: StatusExtra?
    let additional: AdditionalTaskInfo?

    private enum CodingKeys: String, CodingKey {
        case id
        case username
        case taskType = "type"
        case title
        case size
        case status
        case statusExtra = "status_extra"
        case additional
    }
}

extension Task {
    var progress: Double? {
        guard let transfer = additional?.transfer, size > 0 else { return nil }
        let ratio = Double(transfer.sizeDownloaded) / Double(size)
        if ratio.isNaN || ratio.isInfinite {
            return nil
        }
        return (ratio * 100.0).rounded()
    }

    var transferSpeed: UInt64? {
        guard let transfer = additional?.transfer else { return nil }
        switch status {
        case .downloading:
            return transfer.speedDownload > 0 ? transfer.speedDownload : nil
        case .seeding:
            return transfer.speedUpload > 0 ? transfer.speedUpload : nil
        default:
            return nil
        }
    }

    var timeRemaining: TimeInterval? {
        guard case .downloading = status else { return nil }
        guard let transfer = additional?.transfer else { return nil }
        guard transfer.speedDownload > 0 else { return nil }
        let remaining = Double(size - transfer.sizeDownloaded) / Double(transfer.speedDownload)
        return remaining.isFinite ? remaining : nil
    }
}

struct StatusExtra: Decodable {
    let errorDetail: String?
    let unzipProgress: Int?

    private enum CodingKeys: String, CodingKey {
        case errorDetail = "error_detail"
        case unzipProgress = "unzip_progress"
    }
}

struct AdditionalTaskInfo: Decodable {
    let detail: Detail?
    let file: [TaskFile]?
    let peer: [Peer]?
    let tracker: [Tracker]?
    let transfer: Transfer?
}

struct Detail: Decodable {
    let completedTime: Date?
    let connectedLeechers: Int
    let connectedPeers: Int
    let connectedSeeders: Int
    let createdTime: Date
    let destination: String
    let seedElapsed: UInt64
    let startedTime: Date
    let totalPeers: Int
    let totalPieces: Int
    let uri: String
    let unzipPassword: String?
    let waitingSeconds: Int

    private enum CodingKeys: String, CodingKey {
        case completedTime = "completed_time"
        case connectedLeechers = "connected_leechers"
        case connectedPeers = "connected_peers"
        case connectedSeeders = "connected_seeders"
        case createdTime = "created_time"
        case destination
        case seedElapsed = "seed_elapsed"
        case startedTime = "started_time"
        case totalPeers = "total_peers"
        case totalPieces = "total_pieces"
        case uri
        case unzipPassword = "unzip_password"
        case waitingSeconds = "waiting_seconds"
    }
}

struct TaskFile: Decodable {
    let filename: String
    let index: Int
    let priority: String
    let size: UInt64
    let sizeDownloaded: UInt64
    let wanted: Bool

    private enum CodingKeys: String, CodingKey {
        case filename
        case index
        case priority
        case size
        case sizeDownloaded = "size_downloaded"
        case wanted
    }
}

struct Peer: Decodable {
    let address: String
    let agent: String
    let progress: Double
    let speedDownload: UInt64
    let speedUpload: UInt64

    private enum CodingKeys: String, CodingKey {
        case address
        case agent
        case progress
        case speedDownload = "speed_download"
        case speedUpload = "speed_upload"
    }
}

struct Tracker: Decodable {
    let peers: Int
    let seeds: Int
    let status: String
    let updateTimer: Int
    let url: String

    private enum CodingKeys: String, CodingKey {
        case peers
        case seeds
        case status
        case updateTimer = "update_timer"
        case url
    }
}

struct Transfer: Decodable {
    let downloadedPieces: Int
    let sizeDownloaded: UInt64
    let sizeUploaded: UInt64
    let speedDownload: UInt64
    let speedUpload: UInt64

    private enum CodingKeys: String, CodingKey {
        case downloadedPieces = "downloaded_pieces"
        case sizeDownloaded = "size_downloaded"
        case sizeUploaded = "size_uploaded"
        case speedDownload = "speed_download"
        case speedUpload = "speed_upload"
    }
}

struct TaskCompleted: Decodable {
    let taskId: String

    private enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
    }
}

struct TaskCreated: Decodable {
    let listId: [String]
    let taskId: [String]

    private enum CodingKeys: String, CodingKey {
        case listId = "list_id"
        case taskId = "task_id"
    }
}

struct TaskOperation: Decodable {
    let failedTask: [FailedTask]

    private enum CodingKeys: String, CodingKey {
        case failedTask = "failed_task"
    }

    init(failedTask: [FailedTask]) {
        self.failedTask = failedTask
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let tasks = try container.decodeIfPresent([FailedTask].self, forKey: .failedTask) ?? []
        self.failedTask = tasks
    }
}

struct FailedTask: Decodable {
    let error: Int
    let id: String
}

struct EmptyResponse: Decodable {}

enum TaskStatus: Decodable, CustomStringConvertible {
    case waiting
    case downloading
    case paused
    case finishing
    case finished
    case hashChecking
    case preSeeding
    case seeding
    case filehostingWaiting
    case extracting
    case preprocessing
    case preprocessPass
    case downloaded
    case postprocessing
    case captchaNeeded
    case error(code: Int)
    case unknown(raw: Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(Int.self)
        switch rawValue {
        case 1: self = .waiting
        case 2: self = .downloading
        case 3: self = .paused
        case 4: self = .finishing
        case 5: self = .finished
        case 6: self = .hashChecking
        case 7: self = .preSeeding
        case 8: self = .seeding
        case 9: self = .filehostingWaiting
        case 10: self = .extracting
        case 11: self = .preprocessing
        case 12: self = .preprocessPass
        case 13: self = .downloaded
        case 14: self = .postprocessing
        case 15: self = .captchaNeeded
        case 101...134:
            self = .error(code: rawValue)
        default:
            self = .unknown(raw: rawValue)
        }
    }

    var description: String {
        switch self {
        case .waiting: return "waiting"
        case .downloading: return "downloading"
        case .paused: return "paused"
        case .finishing: return "finishing"
        case .finished: return "finished"
        case .hashChecking: return "hash checking"
        case .preSeeding: return "pre-seeding"
        case .seeding: return "seeding"
        case .filehostingWaiting: return "filehost waiting"
        case .extracting: return "extracting"
        case .preprocessing: return "preprocessing"
        case .preprocessPass: return "preprocess pass"
        case .downloaded: return "downloaded"
        case .postprocessing: return "postprocessing"
        case .captchaNeeded: return "captcha needed"
        case .error(let code): return "error (\(code))"
        case .unknown(let value): return "unknown (\(value))"
        }
    }

    var rawCode: Int {
        switch self {
        case .waiting: return 1
        case .downloading: return 2
        case .paused: return 3
        case .finishing: return 4
        case .finished: return 5
        case .hashChecking: return 6
        case .preSeeding: return 7
        case .seeding: return 8
        case .filehostingWaiting: return 9
        case .extracting: return 10
        case .preprocessing: return 11
        case .preprocessPass: return 12
        case .downloaded: return 13
        case .postprocessing: return 14
        case .captchaNeeded: return 15
        case .error(let code): return code
        case .unknown(let raw): return raw
        }
    }
}
