# Synology Download Station CLI

`synology-ds` is a terminal app for Synology Download Station. It gives you a fast keyboard-driven download list, lets you add URLs or magnet links, and caches your Synology session so you do not have to log in every time.

## Install

Prerequisites:

- A Synology NAS with **Download Station** installed and enabled.
- A DSM URL you can reach from this machine, such as `https://nas.local:5001`.
- A DSM user that is allowed to use Download Station.
- [Bun](https://bun.com/docs/installation) 1.2.x or newer.

Install the CLI:

```bash
bun install --global synology-downloadstation-cli
```

Verify it works:

```bash
synology-ds --help
```

If your shell cannot find `synology-ds`, restart your terminal. If it still fails, add Bun's bin directory to your shell:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
exec zsh
```

## First Run

Start the app:

```bash
synology-ds
```

The first launch asks for:

1. Your DSM host URL.
2. Whether to allow a self-signed certificate.
3. Optional 1Password item and vault.

Settings are saved in `~/.config/synology-ds/config.json`.

If you use 1Password, sign in first:

```bash
eval "$(op signin)"
synology-ds --op-item "NAS Download Station"
```

## Usage

The TUI refreshes automatically about once per second.

| Key | Action |
|-----|--------|
| `up` / `down` | Move selection |
| `space` | Pause or resume selected task |
| `n` | Add a new URL or magnet link |
| `d` | Delete selected task |
| `c` | Clear completed tasks |
| `s` | Toggle sort by name |
| `r` | Refresh now |
| `q` | Quit |

In the new-task prompt, paste one or more URLs and press `Ctrl+Enter` or `Command+Enter` to queue them.

If Synology requires a download destination and none is known yet, the TUI asks for the destination path before creating the task.

## Updating

```bash
bun install --global synology-downloadstation-cli@latest
```

## Uninstalling

Remove the command:

```bash
bun remove --global synology-downloadstation-cli
```

Remove saved settings and sessions:

```bash
rm -rf ~/.config/synology-ds
```

## Safari Extension

The repository includes an optional Safari Web Extension source folder. It adds "Send link to NAS" and "Send selected links to NAS" to Safari's right-click menu.

Safari extension setup requires Xcode because Safari extensions must be wrapped in a local app. See [docs/safari-extension.md](docs/safari-extension.md).

## Headless Relay

Run the relay without the TUI:

```bash
synology-ds serve --port 19786
```

The relay listens on `127.0.0.1` only. It is mainly useful for the Safari extension or headless setups.

## Sessions and Security

`synology-ds` stores:

- Config: `~/.config/synology-ds/config.json`
- Sessions: `~/.config/synology-ds/sessions.json`

Credentials, passwords, OTP codes, and 1Password data are never written to disk. Session storage contains only the Synology SID, username, cached destination, and timestamps.

## Troubleshooting

- **`bun: command not found` or `synology-ds: command not found`**  
  Restart your terminal. If it still fails, add Bun's bin directory to your shell with `echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && exec zsh`.

- **`op: command not found`**  
  Install the 1Password CLI and run `eval "$(op signin)"`.

- **Certificate errors**  
  Use `--insecure` for self-signed NAS certificates, or install the NAS certificate into your system trust store.

- **`Failed to create task. (120)`**  
  Synology expects a destination path. In the TUI, enter the destination when prompted. For relay/Safari flows, open the TUI once and create a download so the destination can be cached.

- **Paste does not work**  
  Make sure the new-task prompt is open with `n`.

## More Docs

- [Developer workflow](docs/development.md)
- [Release checklist](docs/release.md)
- [Safari extension setup](docs/safari-extension.md)
