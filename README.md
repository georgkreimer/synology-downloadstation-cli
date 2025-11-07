# Synology Download Station CLI

`synology-ds` is a Bun-powered, TypeScript-native command-line interface for Synology Download Station. It ships with a rich terminal UI built on [OpenTUI](https://github.com/sst/opentui) + React, optional 1Password-based authentication, and on-disk session caching so you rarely need to re-enter credentials.

---

## Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [CLI Flags & Environment](#cli-flags--environment)
- [TUI Controls](#tui-controls)
- [Configuration & Sessions](#configuration--sessions)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)

---

## Features

- **OpenTUI React interface**  
  Auto-refreshing task list (every ~1 s) with status, throughput, and keyboard-driven controls.

- **Credential flexibility**  
  Interactive username/password prompts or seamless 1Password CLI integration (username, password, and TOTP pulled directly from `op`).

- **Session persistence**  
  Cached SID + destination stored per host under `~/.config/synology-ds/sessions.json`. The last known destination is reused to avoid Synology’s “120” errors without nagging for a path.

- **Secure by default**  
  No credentials are written to disk; only SID, username, and destination are cached. TLS verification stays enabled unless `--insecure` is explicitly passed.

- **Modern toolchain**  
  Bun 1.2.x runtime, TypeScript strict mode, and a single `bun run build` output (`dist/index.js`) with a baked-in `#!/usr/bin/env bun` shebang.

---

## Prerequisites

- macOS (Apple Silicon or Intel) with the latest Xcode Command Line Tools.
- [Bun 1.2.x](https://bun.sh/) (see `.tool-versions` for the pinned version).
- Optional: [1Password CLI](https://developer.1password.com/docs/cli) signed in via `eval "$(op signin)"`.
- Optional: [Zig](https://ziglang.org) only if you plan to hack on OpenTUI itself (pre-built artifacts are bundled).

Install dependencies once:

```bash
bun install
```

---

## Quick Start

```bash
# Run straight from sources with live reload semantics
bun run dev

# Produce a distributable binary w/ Bun shebang in dist/
bun run build

# Execute the compiled artifact
bun run start          # or: ./dist/index.js --host ...
```

First launch walks through onboarding:
1. Host / URL (defaults to https:// if no scheme supplied)
2. Self-signed TLS preference
3. Optional 1Password item + vault (if `op` is available)

Settings are written to `~/.config/synology-ds/config.json`, and can be edited by hand if necessary.

---

## CLI Flags & Environment

```
synology-ds \
  --host https://nas.local:5001 \
  --insecure \
  --op-item "NAS Download Station" \
  --op-vault "Private" \
  --timeout 15000 \
  --no-session-cache
```

| Flag | Description |
|------|-------------|
| `--host <url>` | Target DSM host (prompted if omitted). Use `https://` whenever possible. |
| `--insecure` | Skip TLS validation (handy for self-signed certs). |
| `--timeout <ms>` | HTTP timeout in milliseconds (default 10000). |
| `--op-item`, `--op-vault` | Fetch credentials/TOTP from a 1Password item; requires `op` CLI session. |
| `--no-session-cache` | Disable disk-backed session caching. |

Environment variables such as `SYNOLOGY_URL`, `SYNOLOGY_OP_ITEM`, etc., can be added later; currently we rely on the CLI flags/onboarding prompts.

---

## TUI Controls

- `↑ / ↓` — move selection  
- `space` — pause/resume task  
- `n` — new task (inline URL prompt with paste support)  
- `d` — delete selected task  
- `c` — clear all completed tasks  
- `r` — manual refresh (auto refresh already runs every ~1 s)  
- `q` — quit the TUI
- Paste multiple URLs separated by whitespace/newlines into the new-task prompt and press `Option+Enter` to queue them all at once.

Paste support accepts bracketed paste sequences (cmd+V) and strips ANSI/control characters before inserting into the URL prompt.

---

## Configuration & Sessions

- **Config** (`~/.config/synology-ds/config.json`)  
  Stores host, TLS preference, and optional 1Password metadata captured during onboarding.

- **Sessions** (`~/.config/synology-ds/sessions.json`)  
  Per-host record containing SID, username, and last-known download destination. Credentials are *never* written to disk. Delete this file or use `--no-session-cache` if you need a cold start.

- **Destination caching**  
  Whenever the Download Station API returns a `detail.destination`, we persist it so subsequent `create` requests succeed without reprompting. If the NAS has never reported a destination, the CLI will reprompt before scheduling the first task.

---

## Development Workflow

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Typecheck | `bunx tsc --noEmit` |
| Run tests | `bun test` |
| Run dev build | `bun run dev` |
| Build release | `bun run build` |
| Format (VS Code) | Use built-in TS formatter (2-space indent) |

Source layout:

```
src/
  index.tsx             # CLI entry + onboarding + renderer boot
  services/             # Synology client, config/session stores, prompts, 1Password wrapper
  tui/                  # React components rendered via OpenTUI
  utils/                # Formatting helpers, filesystem helpers, etc.
```

Keep TypeScript strict mode happy, prefer async/await, and add comments only for non-obvious logic (e.g., destination caching rationale).

---

## Troubleshooting

- **`op: command not found`**  
  Install the 1Password CLI and re-run `eval "$(op signin)"`.

- **Certificate errors / `The certificate for this server is invalid`**  
  Try `--insecure` temporarily, or import your NAS certificate into the macOS trust store.

- **`Failed to create task. (120)`**  
  Indicates the NAS expects a destination path. The CLI now reuses the last known destination automatically; if you still see this, clear `sessions.json` and let the TUI capture a fresh destination from an existing task.

- **Paste doesn’t work**  
  Ensure you’re in the “new task” prompt (`n`). We intercept bracketed paste events only while the prompt is focused.

- **Session expired**  
  1Password users reauthenticate automatically. Manual logins will be reprompted inline rather than forcing a restart.

Need help? File an issue or run the CLI with `bun run dev --help` for the exhaustive flag list. Happy downloading!
