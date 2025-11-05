# Repository Guidelines

## Project Structure & Module Organization
The Swift Package Manager manifest lives at `Package.swift`. Executable sources are under `Sources/SynologyDownloadStationCLI/`, split into the interactive shell (`CLI.swift`), networking (`SynologyDownloadStationClient.swift`), session persistence (`SessionStorage.swift`), 1Password integration (`OnePassword.swift`), and models (`Models.swift`, `Formatting.swift`). Add new commands in `CLI.swift` and extend API coverage in the client file so everything stays discoverable.

## Build, Test, and Development Commands
- `swift build` compiles a debug build; pass `-c release` for the optimized binary.
- `swift run synology-ds -- --host ...` runs the CLI without manually copying the binary.
- `swift test` is available once unit tests are added—prefer XCTest inside `Tests/`.
- `make release` (see Makefile) wraps the release build and surfaces `.build/release/synology-ds`.

## Coding Style & Naming Conventions
Format Swift files with `swift format --in-place` using the default style. Use 4-space indentation, UpperCamelCase for types, lowerCamelCase for functions and variables, and prefer clear, descriptive method names. Keep synchronous work on the main task; background HTTP calls should be marked `async`. Error enums use lowerCamelCase cases with associated values when extra context is needed.

## Testing Guidelines
Add future XCTest suites under `Tests/SynologyDownloadStationCLITests/`. Mirror CLI commands with targeted tests that assert on printed output or mocked HTTP responses. Name test methods `test<Action>_<Expectation>()` to align with XCTest discovery. Before opening a PR, run `swift test` and the relevant integration commands against a staging NAS when possible.

## Commit & Pull Request Guidelines
Write imperative commit subjects (`Add resume command feedback`). Group related code, documentation, and configuration updates together. Every PR should explain the user problem, outline the solution, mention any 1Password or session-cache considerations, and link issues when available. Include terminal excerpts or screenshots for CLI UX changes and ensure `make release` succeeds locally.

## Security & Configuration Tips
Keep real NAS URLs, usernames, and passwords out of the repo. When demonstrating flows, redact hostnames and user identifiers. Avoid logging sensitive session data; prefer temporary in-memory storage for secrets obtained during an interactive run. If you need to update the 1Password integration, require users to have an active `op` session instead of storing tokens locally.
