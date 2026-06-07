# Synology Download Station CLI

`synology-ds` is a Bun-powered, TypeScript-native command-line interface for Synology Download Station. It ships with a rich terminal UI built on [OpenTUI](https://github.com/sst/opentui) + React, optional 1Password-based authentication, and on-disk session caching so you rarely need to re-enter credentials.

---

## Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [First Run](#first-run)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Safari Extension](#safari-extension)
- [Serve (Headless Relay)](#serve-headless-relay)
- [CLI Flags & Environment](#cli-flags--environment)
- [TUI Controls](#tui-controls)
- [Configuration & Sessions](#configuration--sessions)
- [For Developers](#for-developers)
- [Release Checklist](#release-checklist)
- [Troubleshooting](#troubleshooting)

---

## Features

- **OpenTUI React interface**  
  Auto-refreshing task list (every ~1 s) with status, throughput, and keyboard-driven controls.

- **Credential flexibility**  
  Interactive username/password prompts or seamless 1Password CLI integration (username, password, and TOTP pulled directly from `op`).

- **Session persistence**  
  Cached SID + destination stored per host under `~/.config/synology-ds/sessions.json`. The last known destination is reused to avoid Synology’s “120” errors, and the TUI prompts for a destination when none is known.

- **Secure by default**  
  No credentials are written to disk; only SID, username, and destination are cached. TLS verification stays enabled unless `--insecure` is explicitly passed.

- **Safari "Send to NAS" extension**  
  Right-click any link or text selection in Safari to send downloads straight to your NAS. Bulk-sends all URLs found in a selection. Supports `http(s)://` and `magnet:` URIs.

- **Built-in HTTP relay**  
  The TUI automatically starts a localhost relay on port 19786 so the Safari extension can talk to Download Station. A standalone `serve` subcommand is available for headless setups.

- **Simple global install**  
  Install the `synology-ds` command once and run it from any terminal.

---

## Prerequisites

- A Synology NAS with **Download Station** installed and enabled.
- A DSM URL you can reach from this machine, such as `https://nas.local:5001`.
- A DSM user that is allowed to use Download Station.
- [Bun](https://bun.com/docs/installation) 1.2.x or newer.
- Optional: [1Password CLI](https://developer.1password.com/docs/cli) if you want `synology-ds` to read your DSM username, password, and TOTP from 1Password.

Install Bun if you do not already have it:

```bash
curl -fsSL https://bun.com/install | bash
```

After installing Bun, restart your terminal or run the shell setup line printed by the installer. Check that it works:

```bash
bun --version
```

---

## Install

Install the CLI globally:

```bash
bun install --global synology-downloadstation-cli
```

Verify the command is available:

```bash
synology-ds --help
```

If your shell says `synology-ds: command not found`, make sure Bun's bin directory is on your `PATH`:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
exec zsh
```

Then try `synology-ds --help` again.

---

## First Run

Launch the TUI:

```bash
synology-ds
```

The first launch walks through setup:

1. Host / URL (defaults to https:// if no scheme supplied)
2. Whether to allow a self-signed NAS certificate
3. Optional 1Password item and vault

Settings are written to `~/.config/synology-ds/config.json`, and can be edited by hand if necessary.

If you use 1Password, sign in before starting the app:

```bash
eval "$(op signin)"
synology-ds --op-item "NAS Download Station"
```

---

## Updating

Install the latest published version:

```bash
bun install --global synology-downloadstation-cli@latest
```

---

## Uninstalling

Remove the global command:

```bash
bun remove --global synology-downloadstation-cli
```

To remove saved `synology-ds` settings and sessions too:

```bash
rm -rf ~/.config/synology-ds
```

---

## Safari Extension

A Safari Web Extension that adds "Send link to NAS" and "Send selected links to NAS" to the right-click context menu. Links are forwarded to Download Station through the built-in localhost relay.

This part is macOS-only and requires Xcode because Safari extensions must be wrapped in a local Xcode app.

### Setup

1. Build the extension wrapper (generates a local Xcode project — not checked into git):
   ```bash
   xcrun safari-web-extension-converter extension/ \
     --app-name "Send to NAS" \
     --bundle-identifier com.synology-ds.send-to-nas \
     --copy-resources --no-open
   ```
2. Open the generated Xcode project and run it (Product → Run).
3. In **Safari → Settings → Extensions**, enable "Send to NAS".
4. In **Safari → Settings → Extensions → Send to NAS**, grant permission for "All Websites".

### Usage

- **Single link:** Right-click any link → "Send link to NAS".
- **Bulk send:** Select text containing one or more URLs, right-click → "Send selected links to NAS". All `http(s)://` and `magnet:` URIs in the selection are extracted, deduplicated, and sent.

The extension requires the relay to be running (it starts automatically with the TUI, or use `synology-ds serve` for headless mode). The extension connects to port **19786** — this is hardcoded in the extension and must match the relay port.

---

## Serve (Headless Relay)

Run the relay without the TUI — useful for headless setups or when you only need the Safari extension:

```bash
synology-ds serve --port 19786
```

The relay listens on `127.0.0.1` only. Session re-authentication happens automatically when sessions expire.

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
- `s` — toggle sort by name  
- `r` — manual refresh (auto refresh already runs every ~1 s)  
- `q` — quit the TUI
- Paste multiple URLs separated by whitespace/newlines into the new-task prompt and press `Ctrl+Enter` or `Command+Enter` to queue them all at once.

Paste support accepts bracketed paste sequences (cmd+V) and strips ANSI/control characters before inserting into the URL prompt.

---

## Configuration & Sessions

- **Config** (`~/.config/synology-ds/config.json`)  
  Stores host, TLS preference, and optional 1Password metadata captured during onboarding.

- **Sessions** (`~/.config/synology-ds/sessions.json`)  
  Per-host record containing SID, username, and last-known download destination. Credentials are *never* written to disk. Delete this file or use `--no-session-cache` if you need a cold start.

- **Destination caching**  
  Whenever the Download Station API returns a `detail.destination`, we persist it so subsequent `create` requests succeed without reprompting. If the NAS has never reported a destination, the TUI asks for one before scheduling the task and caches it after a successful create. The headless relay cannot prompt; if it cannot infer a destination, open the TUI and create a download once to set the path.

---

## For Developers

Normal users should use the [Install](#install) steps above. These commands are for people changing the code or building from source.

```bash
git clone https://github.com/georgkreimer/synology-downloadstation-cli.git
cd synology-downloadstation-cli
bun install --frozen-lockfile
bun run build
./dist/index.js --help
```

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

## Release Checklist

For maintainers publishing a new version:

1. Update `version` in `package.json`.
2. Run the release checks:
   ```bash
   bunx tsc --noEmit
   bun test
   bun pm pack --dry-run
   ```
3. Confirm the dry-run package includes `dist/index.js`, the tree-sitter assets in `dist/`, `README.md`, `LICENSE`, and the Safari extension files.
4. Publish to npm:
   ```bash
   bun publish --access public
   ```
5. Tag the release and push the tag:
   ```bash
   git tag v$(bun -e 'console.log(require("./package.json").version)')
   git push origin --tags
   ```
6. Create a GitHub release from the pushed tag with the validation commands and user-facing changes.

After publishing, users can install or update with:

```bash
bun install --global synology-downloadstation-cli@latest
```

---

## Troubleshooting

- **`bun: command not found` or `synology-ds: command not found`**  
  Restart your terminal. If it still fails, add Bun's bin directory to your shell: `echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && exec zsh`.

- **`op: command not found`**  
  Install the 1Password CLI and re-run `eval "$(op signin)"`.

- **Certificate errors / `The certificate for this server is invalid`**  
  Try `--insecure` temporarily, or import your NAS certificate into the macOS trust store.

- **`Failed to create task. (120)`**  
  Indicates the NAS expects a destination path. In the TUI, enter the destination path when prompted; if Synology rejects the path, the prompt lets you retry once. In relay/Safari flows, open the TUI and create a download once so the destination can be cached.

- **Paste doesn’t work**  
  Ensure you’re in the “new task” prompt (`n`). We intercept bracketed paste events only while the prompt is focused.

- **Session expired**  
  1Password users reauthenticate automatically. Manual logins will be reprompted inline rather than forcing a restart.

Need help? File an issue or run `synology-ds --help` for the exhaustive flag list.
