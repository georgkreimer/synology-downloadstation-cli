# Synology Download Station CLI

`synology-ds` is a Swift command-line interface for managing Synology Download Station from macOS. It offers an interactive shell, scripting-friendly commands, 1Password support, and optional on-disk session caching so you can authenticate once and stay connected.

## Features

- Interactive REPL (`synology-ds>`) for listing, creating, pausing, resuming, completing, and deleting tasks
- One-shot commands (`list`, `create`, `delete`, etc.) for automation and scripting
- Optional TLS skipping via `--insecure` for self-signed NAS certificates
- Session cache stored in `~/.config/synology-ds/sessions.json` (disable with `--no-session-cache`)
- 1Password integration to fetch username, password, and TOTP codes with `--op-item`
- Environment-variable support for headless runs (`SYNOLOGY_URL`, `SYNOLOGY_OP_ITEM`, `SYNOLOGY_OP_VAULT`)

## Repository Layout

```
Package.swift          # SwiftPM manifest
Sources/               # CLI sources
Makefile               # Convenience build/run/install targets
.vscode/               # Optional VS Code launch profiles
AGENTS.md              # Contributor notes for AI assistants
```

## Getting Started

1. Install the Xcode Command Line Tools (`xcode-select --install`) on macOS 13 or newer.
2. Clone the repository and change into it.
3. Optionally sign in to 1Password in your shell (`eval "$(op signin)"`) if you plan to use the integration.
4. Build or run the CLI as shown below.

## Build & Install

```bash
# Debug build
make build

# Optimized build
make release

# Install into /usr/local/bin (requires sudo by default)
sudo make install

# Custom prefix example
PREFIX=$HOME/.local make install
```

The release binary is placed at `.build/release/synology-ds`. After running `make install`, it will be available system-wide (e.g., `/usr/local/bin/synology-ds`).

## Usage

```bash
synology-ds --host https://nas.local:5001 --insecure
```

Omit the command to enter the interactive shell. Type `help` for command summaries and `exit` to quit.

### Common Commands

```bash
synology-ds list
synology-ds info <task-id>
synology-ds create --url <magnet-or-http-url> [--destination <path>]
synology-ds create-file --file <torrent-file> [--destination <path>]
synology-ds pause <task-id>
synology-ds resume <task-id>
synology-ds complete <task-id>
synology-ds delete <task-id> [--force]
synology-ds clear-completed
synology-ds auth-check
```

Combine global flags as needed: `--host`, `--insecure`, `--no-session-cache`, `--op-item`, and `--op-vault`. If no host is provided, the CLI will prompt for it.

## Credentials & Sessions

- By default the CLI caches username, password, session ID, and last destination for each host under `~/.config/synology-ds/sessions.json`. Delete this file or pass `--no-session-cache` to disable persistence.
- When 1Password is used (`--op-item <item>`), the CLI refreshes TOTP codes as needed and does not write credentials to disk.
- If credentials are missing or stale, prompts appear inline; press return on the OTP prompt to abort.

## 1Password Integration

```bash
# Requires `op` CLI installed and signed in
synology-ds --host https://nas.local:5001 \
  --op-item <item-id-or-name> \
  --op-vault <optional-vault> \
  list
```

The CLI invokes `op item get` to extract username, password, and TOTP fields. Ensure the 1Password entry exposes the expected fields (`username`, `password`, `one-time password`).

## Troubleshooting

- **Certificate errors**: pass `--insecure` when testing against self-signed NAS certificates.
- **Session expired**: the CLI will request an OTP or credentials again; remove the session cache file if it gets out of sync.
- **1Password CLI not found**: install it from [1Password CLI docs](https://developer.1password.com/docs/cli/) and ensure `op` is on `PATH`.
