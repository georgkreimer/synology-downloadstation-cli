// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SynologyDownloadStationCLI",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "synology-ds",
            targets: ["SynologyDownloadStationCLI"]
        )
    ],
    targets: [
        .executableTarget(
            name: "SynologyDownloadStationCLI",
            path: "Sources/SynologyDownloadStationCLI",
            swiftSettings: [
                .unsafeFlags(["-parse-as-library"])
            ],
            linkerSettings: [
                .linkedFramework("Security")
            ]
        )
    ]
)
