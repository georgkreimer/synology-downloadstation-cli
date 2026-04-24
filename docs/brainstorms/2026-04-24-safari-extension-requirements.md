---
date: 2026-04-24
topic: safari-send-to-nas-extension
---

# Safari "Send to NAS" Extension

## Problem Frame

Downloading files to a Synology NAS currently requires opening the TUI, pressing `n`, and pasting a URL. The most common workflow — grabbing a link from a webpage — should be a single right-click from Safari. A Safari extension with a context menu entry ("Send to NAS") eliminates the copy-paste-switch-apps friction and makes the NAS feel like a native download target.

---

## Actors

- A1. Browser user: right-clicks links in Safari to send them to Download Station
- A2. Local relay daemon: receives URLs from the extension, authenticates with the NAS, and queues downloads
- A3. Synology NAS: runs Download Station, receives task creation requests

---

## Key Flows

- F1. Send link to NAS
  - **Trigger:** User right-clicks a link in Safari and selects "Send to NAS"
  - **Actors:** A1, A2, A3
  - **Steps:**
    1. Extension extracts the link href from the right-click target
    2. Extension sends the URL to the local relay (localhost)
    3. Relay authenticates with NAS if needed (reuses existing session cache and 1Password flow)
    4. Relay resolves destination (cached or NAS default)
    5. Relay calls `createTaskFromUrl` on the Synology API
    6. Relay returns success/failure to the extension
    7. Extension fires a macOS notification ("Download queued" or error message)
  - **Outcome:** Download task appears in Download Station on the NAS
  - **Covered by:** R1, R2, R3, R4, R5, R6

- F2. Relay not running
  - **Trigger:** User right-clicks "Send to NAS" but the relay daemon is not active
  - **Actors:** A1, A2
  - **Steps:**
    1. Extension attempts to reach localhost relay
    2. Connection refused
    3. Extension shows macOS notification: "Relay not running. Start it with `synology-ds serve`"
  - **Outcome:** User gets clear guidance on what to do
  - **Covered by:** R7

---

## Requirements

**Context menu**
- R1. Safari extension adds a "Send to NAS" item to the context menu when right-clicking a link (`<a>` elements only)
- R2. Context menu item is not shown when right-clicking non-link elements (images, text, page background)

**Local relay**
- R3. CLI gains a `serve` subcommand that starts an HTTP server on localhost, listening on a fixed port
- R4. The relay reuses the existing `SynologyClient`, session caching (`sessionStore`), destination resolution, and 1Password authentication — no duplicated auth logic
- R5. The relay exposes a single endpoint that accepts a URL and queues it as a download task, returning success or a descriptive error

**Feedback**
- R6. On success or failure, the extension fires a macOS notification with a short message (e.g., "Download queued: filename.iso" or "Failed: session expired")
- R7. When the relay is unreachable, the notification message tells the user to start the relay and how

**Security**
- R8. The relay only listens on `127.0.0.1` (localhost) — not exposed to the network
- R9. No credentials are sent to or stored in the Safari extension — all auth happens in the relay

---

## Acceptance Examples

- AE1. **Covers R1, R6.** Given the relay is running and authenticated, when the user right-clicks a `.iso` download link and selects "Send to NAS", a macOS notification appears within 2-3 seconds: "Download queued: ubuntu-24.04.iso"
- AE2. **Covers R2.** Given the user right-clicks on a paragraph of text, "Send to NAS" does not appear in the context menu
- AE3. **Covers R7.** Given the relay is not running, when the user selects "Send to NAS", a notification says "Relay not running. Start with: synology-ds serve"
- AE4. **Covers R4, R9.** Given the relay's session has expired, the relay transparently re-authenticates (via 1Password or cached credentials) without the extension needing to know about auth

---

## Success Criteria

- Right-click to download is a single-action flow — no popups, no confirmation dialogs, no switching apps
- The relay is a thin wrapper over existing `SynologyClient` logic — minimal new code, no auth duplication
- A user who already has the CLI configured can start using the extension with just `synology-ds serve` and installing the extension

---

## Scope Boundaries

- No toolbar popup or download monitoring in the extension — that's what the TUI is for
- No remote/cloud access — same-network only (NAS reachable from localhost)
- No Safari extension preferences UI in v1 — relay address is always `localhost:PORT`
- No support for sending current page URL or selected text URLs — only right-clicked `<a>` links
- No Chrome/Firefox version — Safari only for now
- No auto-start of the relay daemon — user starts it manually

---

## Key Decisions

- **Local relay over direct NAS connection**: The extension stays dumb (just sends URLs to localhost). All auth, session management, destination resolution, and error handling live in the relay, reusing the existing codebase. This avoids storing credentials in the extension and keeps the security model simple.
- **macOS notifications over in-page UI**: Non-intrusive, works across all tabs, no CSS injection into pages, and native to the platform.
- **Fixed localhost port**: No discovery protocol needed. Extension always talks to `127.0.0.1:PORT`.

---

## Dependencies / Assumptions

- Safari Web Extension API supports context menus on link elements (confirmed: `browser.contextMenus` with `contexts: ["link"]`)
- macOS notification API is available from Safari extensions (via `browser.notifications` or relay-side `osascript`)
- User has already configured the CLI (host, credentials) before using the extension
- NAS is reachable from the machine running Safari (same network / VPN)

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] What port should the relay use? Pick a high port unlikely to conflict. Consider making it configurable via `--port`.
- [Affects R6][Needs research] Can Safari extensions fire native macOS notifications via `browser.notifications`, or should the relay trigger them via `osascript`?
- [Affects R3][Technical] Should the relay be a long-running daemon or a foreground process? Consider launchd/launchctl integration for auto-start in a future version.
- [Affects R1][Needs research] Safari Web Extension packaging: Xcode project required, or can we use `web-ext` / a lightweight build?

---

## Next Steps

-> `/ce-plan` for structured implementation planning
