---
title: "feat: Add Safari 'Send to NAS' extension with local relay"
type: feat
status: active
date: 2026-04-24
origin: docs/brainstorms/2026-04-24-safari-extension-requirements.md
---

# feat: Add Safari "Send to NAS" extension with local relay

## Overview

Add a Safari Web Extension that places a "Send to NAS" item in the right-click context menu for links. The extension sends the URL to a local HTTP relay (`synology-ds serve`) which reuses the existing `SynologyClient`, session caching, and 1Password authentication to queue downloads on the Synology NAS. Feedback is delivered via a toolbar badge on the extension icon.

---

## Problem Frame

Downloading files to a Synology NAS currently requires opening the TUI, pressing `n`, and pasting a URL. The most common workflow — grabbing a link from a webpage — should be a single right-click from Safari. (see origin: `docs/brainstorms/2026-04-24-safari-extension-requirements.md`)

---

## Requirements Trace

- R1. Safari extension adds "Send to NAS" to context menu on right-clicked `<a>` links
- R2. Context menu item not shown on non-link elements
- R3. CLI gains `serve` subcommand starting HTTP server on localhost
- R4. Relay reuses existing SynologyClient, session caching, destination resolution, 1Password auth
- R5. Relay exposes single endpoint accepting a URL, queues download, returns success/error
- R6. On success/failure, extension shows feedback via toolbar badge (revised from macOS notifications — `browser.notifications` is unreliable in Safari)
- R7. When relay unreachable, badge shows error indicator
- R8. Relay only listens on `127.0.0.1`
- R9. No credentials sent to or stored in the extension

**Origin actors:** A1 (Browser user), A2 (Local relay daemon), A3 (Synology NAS)
**Origin flows:** F1 (Send link to NAS), F2 (Relay not running)
**Origin acceptance examples:** AE1 (success feedback — origin specified macOS notification, revised to toolbar badge), AE2 (no menu on non-links), AE3 (relay not running feedback — origin specified notification with message text, badge shows error indicator instead), AE4 (transparent re-auth)

**Origin deviation:** R6/R7 and AE1/AE3 originally specified macOS notifications with descriptive text (e.g., "Download queued: ubuntu-24.04.iso", "Relay not running. Start with: synology-ds serve"). Since `browser.notifications` is unreliable in Safari, this plan substitutes toolbar badge indicators (✓/✗). The badge cannot display descriptive text — it confirms success/failure only. Users check the TUI or relay terminal output for details. This is an accepted tradeoff for v1.

---

## Scope Boundaries

- No toolbar popup or download monitoring in the extension — that's what the TUI is for
- No remote/cloud access — same-network only
- No Safari extension preferences UI — extension always connects to `localhost:19786` (the relay's `--port` flag is for conflict resolution only; changing it requires rebuilding the extension)
- Only right-clicked `<a>` links — no page URL, no selected text
- Safari only — no Chrome/Firefox
- No auto-start of the relay daemon
- No shared secret for relay auth in v1 — CORS origin validation is sufficient (see Key Technical Decisions)

---

## Context & Research

### Relevant Code and Patterns

- `src/services/SynologyClient.ts` — All API calls, `createTaskFromUrl`, error code handling (119 = session expired, 120 = missing destination)
- `src/services/sessionStore.ts` — Per-host session persistence in `~/.config/synology-ds/sessions.json`, 24-hour TTL
- `src/services/configStore.ts` — Host, TLS, 1Password prefs in `~/.config/synology-ds/config.json`
- `src/services/onePassword.ts` — Synchronous `op` CLI for credentials and TOTP
- `src/index.tsx` — Auth orchestration pattern: restore session → validate with `listTasks()` → re-auth on 119 → 1Password or manual prompts
- `src/tui/App.tsx` — Session retry pattern in `loadTasks` and `performAction` (catch 119, re-auth, retry once)

### External References

- Safari Web Extension packaging requires an Xcode container app — use `xcrun safari-web-extension-converter` to generate the project from a standard web extension directory
- `browser.contextMenus` with `contexts: ["link"]` is supported in Safari — use `"scripts"` (not `"service_worker"`) in manifest.json to avoid a Safari CORS bug with service workers
- `browser.notifications` is unreliable in Safari — use `browser.action.setBadgeText` instead (confirmed working)
- Safari extension origins are `safari-web-extension://<GUID>` where the GUID changes on every Safari launch — CORS must dynamically reflect the origin
- `Bun.serve()` supports `hostname: "127.0.0.1"` for localhost-only binding, `Response.json()` for JSON responses

---

## Key Technical Decisions

- **Bun.serve() for the relay**: Zero new dependencies. Built into the runtime, simple fetch-style handler. Lives in `src/services/relay.ts`.
- **CORS origin validation over shared secret**: When an `Origin` header is present, the relay validates it starts with `safari-web-extension://` before reflecting CORS headers — rejecting browser requests from web pages. Requests without an `Origin` header (curl, local tools) are accepted since the relay is localhost-only and intended for single-user use. A shared secret can be added later if needed.
- **1Password required for relay auth**: The relay cannot use interactive stdin prompts for re-authentication. If the cached session expires, re-auth is only possible via 1Password. If 1Password is not configured, the `serve` command prints an error and exits. Manual-auth users must re-authenticate via the TUI to refresh the cached session.
- **Foreground process**: `serve` runs in the foreground (Ctrl+C to stop). Launchd integration deferred to a future version (see origin Scope Boundaries).
- **Port 19786**: Fixed default, configurable via `--port`. High enough to avoid conflicts, low enough to remember. Hardcoded in extension's `background.js`.
- **Toolbar badge for feedback**: `browser.action.setBadgeText` with auto-clear after 2 seconds. Green "✓" on success, red "✗" on failure. Works reliably in Safari unlike `browser.notifications`.
- **Magnet URI support**: Extend `createTaskFromUrl` to accept `magnet:` scheme — Download Station supports it natively. Magnet links appear as `<a href="magnet:...">` elements in web pages, so the extension's `contexts: ["link"]` filter already captures them. This is a scope expansion beyond the origin doc but low-cost and high-value for download manager use cases.
- **Concurrent relay + TUI**: Both may run simultaneously. They share `sessions.json`. If one re-authenticates (invalidating the other's SID), the other will get a 119 error on its next request and transparently re-auth. Brief hiccup, self-healing. Documented as expected behavior.

---

## Open Questions

### Resolved During Planning

- **Port number**: 19786 — high, unlikely to conflict, configurable via `--port`
- **Notification mechanism**: Toolbar badge — `browser.notifications` doesn't work in Safari
- **Auth when 1Password not configured**: `serve` requires 1Password or a valid cached session. Exits with error if neither available.
- **Relay lifecycle**: Foreground process, Ctrl+C to stop
- **CORS handling**: Dynamic origin reflection for `safari-web-extension://` origins

### Deferred to Implementation

- **Exact badge styling**: Green/red background colors and text may need adjustment after visual testing in Safari
- **Xcode project configuration**: Generated by `safari-web-extension-converter` — exact build settings determined at generation time
- **Extension icon assets**: Need 48px and 128px icons — can use simple NAS/download glyph or project logo

---

## Output Structure

```
extension/
  manifest.json
  background.js
  icons/
    icon-48.png
    icon-128.png
src/services/
  auth.ts          (new — extracted auth bootstrap)
  relay.ts         (new — HTTP relay server)
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Safari Extension (background.js)
  │  browser.contextMenus.onClicked → extracts linkUrl
  │  POST http://127.0.0.1:19786/add { url }
  │  Origin: safari-web-extension://<guid>
  ▼
Bun.serve() relay (src/services/relay.ts)
  │  validates Origin header (safari-web-extension://)
  │  validates URL scheme (http, https, magnet)
  │  resolves destination (cached → getDefaultDestination)
  │  calls client.createTaskFromUrl(url, destination)
  │  on 119: re-authenticates via 1Password, retries once
  ▼
Synology Download Station API
  │  POST /webapi/entry.cgi
  ▼
Response → relay returns JSON → extension reads response → setBadgeText
```

---

## Implementation Units

- [ ] U1. **Extract auth bootstrap into reusable module**

**Goal:** Move the auth orchestration logic out of `index.tsx` into a shared module so both the TUI and relay can authenticate without duplicating code.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Create: `src/services/auth.ts`
- Modify: `src/index.tsx`
- Test: `src/services/__tests__/auth.test.ts`

**Approach:**
- Extract `authenticateWithOnePassword`, `authenticateManually`, `ensureSessionValid`, and the `mergeSession` helper into `src/services/auth.ts`
- The module exports a function that takes `{ client, config, sessionHost, useSessionCache }` and returns an authenticated client with session persistence callbacks
- `index.tsx` calls this instead of inlining the auth flow
- The relay will call the same function but with `manualFallback: false` to prevent stdin prompts

**Patterns to follow:**
- `src/services/configStore.ts` — module structure, export style
- Current auth flow in `src/index.tsx:105-161` — logic to preserve

**Test scenarios:**
- Happy path: given valid cached session, authenticates without prompting and returns client with SID set
- Happy path: given expired session with 1Password configured, re-authenticates via 1Password and updates session store
- Error path: given expired session with no 1Password and `manualFallback: false`, throws descriptive error
- Edge case: given no cached session and no prior config, authenticates fresh via 1Password

**Verification:**
- `bun run lint` passes
- `bun test` passes
- TUI still authenticates and launches correctly (manual smoke test)
- Auth module is importable with a clear API for the relay to use

---

- [ ] U2. **Create relay HTTP server**

**Goal:** Implement the localhost HTTP relay that accepts URLs from the Safari extension and queues them as Download Station tasks.

**Requirements:** R3, R4, R5, R8, R9

**Dependencies:** U1

**Files:**
- Create: `src/services/relay.ts`
- Test: `src/services/__tests__/relay.test.ts`

**Approach:**
- Use `Bun.serve()` with `hostname: "127.0.0.1"` and configurable port (default 19786)
- Single `POST /add` endpoint accepting `{ url: string }`
- CORS handling: preflight `OPTIONS` response, origin validation for `safari-web-extension://` prefix
- URL validation: accept `http://`, `https://`, `magnet:` schemes
- Destination resolution: try cached destination from session store, fall back to `client.getDefaultDestination()`
- Session retry: catch error 119, re-authenticate via auth module (1Password only), retry once
- JSON response: `{ ok: true, filename?: string }` on success, `{ ok: false, error: string }` on failure
- Export a `startRelay(options)` function that the `serve` subcommand calls

**Patterns to follow:**
- Session retry pattern from `src/tui/App.tsx` (`loadTasks`/`performAction` catch 119, re-auth, retry)
- Error model from `src/services/SynologyClient.ts` — `SynologyRequestError` with `.code`

**Test scenarios:**
- Happy path: POST /add with valid http URL returns `{ ok: true }` and calls `createTaskFromUrl`
- Happy path: POST /add with magnet URI returns `{ ok: true }`
- Error path: POST /add with `javascript:` URL returns 400 with error message
- Error path: POST /add with missing `url` field returns 400
- Error path: NAS unreachable (fetch throws) returns 502 with descriptive error
- Error path: session expired (error 119) triggers re-auth and retries once
- Error path: re-auth itself fails (1Password `op` not signed in) returns 503 with message "Re-authentication failed. Run `eval \"$(op signin)\"` in the relay terminal."
- Integration: CORS preflight (OPTIONS) returns correct headers for `safari-web-extension://` origin
- Integration: request without Origin header (curl, local tools) is accepted
- Integration: CORS preflight returns no headers for `https://evil.com` origin
- Edge case: GET /add returns 404
- Edge case: POST /nonexistent returns 404

**Verification:**
- `bun run lint` passes
- `bun test` passes
- `curl -X POST http://127.0.0.1:19786/add -H "Content-Type: application/json" -d '{"url":"https://example.com/file.iso"}'` returns success JSON (no Origin header — accepted for local tools)

---

- [ ] U3. **Add `serve` subcommand to CLI**

**Goal:** Wire the relay into the CLI so users can start it with `synology-ds serve`.

**Requirements:** R3, R4

**Dependencies:** U1, U2

**Files:**
- Modify: `src/index.tsx`

**Approach:**
- Restructure Commander: keep shared options (`--host`, `--insecure`, `--op-item`, `--op-vault`, `--timeout`, `--no-session-cache`) on the root program. Add `program.command("serve")` for the relay with its own `--port <number>` option (default 19786). Use `program.action(...)` on the root for the default TUI behavior. Access shared options from the serve handler via `program.opts()`.
- On startup: load config, create client, authenticate via auth module (1Password or cached session, no manual fallback), resolve destination, start relay
- If 1Password not configured and no valid cached session, print error: "1Password required for relay mode. Configure with `synology-ds --op-item <item>` or authenticate via the TUI first."
- Print relay URL and "Listening..." on successful start

**Patterns to follow:**
- Existing Commander setup in `src/index.tsx:40-49`
- Config loading pattern in `src/index.tsx:51-85`

**Test scenarios:**
- Test expectation: none — CLI wiring is verified via manual smoke test (start `synology-ds serve`, confirm it binds and responds)

**Verification:**
- `bun run lint` passes
- `bun run build` succeeds (new subcommand included in bundle)
- `synology-ds serve` starts the relay and prints the listening address
- `synology-ds` (no subcommand) still launches the TUI
- `synology-ds serve --port 9999` starts on port 9999

---

- [ ] U4. **Extend URL validation for magnet URIs**

**Goal:** Allow `createTaskFromUrl` to accept `magnet:` URIs since Download Station supports them natively.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/services/SynologyClient.ts`
- Modify: `src/services/__tests__/SynologyClient.test.ts`

**Approach:**
- Change the URL validation in `createTaskFromUrl` (line 147) to also accept URLs starting with `magnet:`
- Keep rejecting all other schemes (`javascript:`, `data:`, `file:`, `ftp:`, etc.)

**Patterns to follow:**
- Existing validation style at `src/services/SynologyClient.ts:147-149`

**Test scenarios:**
- Happy path: `magnet:?xt=urn:btih:...` is accepted and sent to the API
- Error path: `javascript:alert(1)` is rejected with descriptive error
- Error path: `ftp://example.com/file` is rejected
- Existing http/https tests continue to pass

**Verification:**
- `bun run lint` passes
- `bun test` passes

---

- [ ] U5. **Create Safari extension source files**

**Goal:** Create the web extension source directory with manifest and background script, ready for Xcode project generation.

**Requirements:** R1, R2, R6, R7, R9

**Dependencies:** U2 (needs to know the relay endpoint contract)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-128.png`

**Approach:**
- Manifest V3 with `"permissions": ["contextMenus"]`, `"host_permissions": ["http://127.0.0.1:*/*"]`
- Use `"scripts": ["background.js"]` (not `"service_worker"`) to avoid Safari CORS bug
- Background script: register context menu item with `contexts: ["link"]` in both `runtime.onInstalled` and at top-level (Safari doesn't always fire `onInstalled`)
- On click: extract `info.linkUrl`, POST to `http://127.0.0.1:19786/add`, read response
- On success: `browser.action.setBadgeText({ text: "✓" })` with green background, clear after 2s
- On failure/unreachable: `browser.action.setBadgeText({ text: "✗" })` with red background, clear after 3s
- Placeholder icon PNGs (simple download arrow glyph)

**Patterns to follow:**
- Standard WebExtension `browser.contextMenus` API
- `browser.action.setBadgeText` / `setBadgeBackgroundColor` API

**Test scenarios:**
- Test expectation: none — Safari extension is tested manually in Safari after Xcode build. Verified by: right-click link shows "Send to NAS", clicking it triggers badge feedback.

**Verification:**
- `extension/manifest.json` is valid JSON with correct permissions
- `xcrun safari-web-extension-converter ./extension --app-name "SendToNAS" --bundle-identifier com.synology-ds.sendtonas --swift --macos-only --copy-resources` generates an Xcode project without errors
- Build and run in Xcode, enable extension in Safari, right-click a link → "Send to NAS" appears
- Covers AE1: right-click download link → badge shows "✓" within 2-3 seconds
- Covers AE2: right-click on text → "Send to NAS" does not appear
- Covers AE3: relay not running → badge shows "✗"
- Covers AE4: expired session → relay transparently re-auths, badge shows "✓"

---

## System-Wide Impact

- **Interaction graph:** The relay calls `SynologyClient.createTaskFromUrl` and the auth module. It reads `config.json` and `sessions.json` via existing store modules. The Safari extension only talks to the relay — no direct NAS contact.
- **Error propagation:** `SynologyRequestError` from the client is caught by the relay and translated to HTTP status codes (400 for bad input, 502 for NAS errors, 503 for auth failure). The extension reads the JSON error message for badge display.
- **State lifecycle risks:** Concurrent relay + TUI may trigger mutual session invalidation. Both recover via 119 retry. No data loss risk — worst case is a brief re-auth delay.
- **API surface parity:** The `serve` subcommand does not affect the TUI. The TUI continues to work independently.
- **Unchanged invariants:** All existing CLI options, TUI behavior, and API call patterns remain unchanged. The auth extraction (U1) is a pure refactor — behavior is identical.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Safari CORS behavior with extension origins may be inconsistent across macOS versions | Use `"scripts"` instead of `"service_worker"` in manifest (confirmed workaround). Test on current macOS. |
| `safari-web-extension-converter` may require specific Xcode version | Document minimum Xcode version. Converter is stable since Safari 14+. |
| 1Password `op` CLI may not be in PATH when relay runs as background process | Document that relay inherits shell environment. Recommend running in a terminal, not as a system daemon. |
| Synology session invalidation when both relay and TUI re-auth simultaneously | Self-healing: both processes retry on 119. Document as expected behavior. |
| Context menu items may disappear after Safari restart (known Safari bug) | Register in both `onInstalled` and at top-level background script execution. |
| 1Password `op` session may expire during long relay runs | Re-auth failure returns 503 with actionable message. User runs `op signin` in relay terminal. |
| `spawnSync` for 1Password blocks Bun.serve() event loop during re-auth | Acceptable for single-user localhost relay. Concurrent requests queue briefly (1-3s) during re-auth. |

---

## Documentation / Operational Notes

- README should document the `serve` subcommand, port configuration, and Safari extension setup
- Include Xcode project generation command in README
- Note that 1Password configuration is required for relay mode
- Add `.gitignore` entries for Xcode build artifacts (`SendToNAS/`, `*.xcodeproj/xcuserdata/`, `build/`)
- The `extension/` directory is a separate artifact from the CLI — not bundled by `bun build`, not distributed via npm. Users build the Xcode project from source.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-24-safari-extension-requirements.md](docs/brainstorms/2026-04-24-safari-extension-requirements.md)
- Related code: `src/services/SynologyClient.ts`, `src/services/sessionStore.ts`, `src/services/configStore.ts`, `src/services/onePassword.ts`, `src/index.tsx`
- Apple Safari Web Extension docs: Creating a Safari web extension
- Bun.serve() API documentation
- MDN: browser.contextMenus API
