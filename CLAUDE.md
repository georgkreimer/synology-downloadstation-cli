# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev (live) | `bun run dev` |
| Build release | `bun run build` |
| Typecheck | `bun run lint` (alias for `bunx tsc --noEmit`) |
| Run tests | `bun test` |
| Single test | `bun test src/utils/__tests__/formatting.test.ts` |
| Start built artifact | `bun run start` |

After touching build scripts or package metadata, run both `bun run lint` **and** `bun run build`.

## Architecture

Bun 1.2.x + strict TypeScript CLI for Synology Download Station. The TUI is React rendered via OpenTUI (`@opentui/core` + `@opentui/react`) — not a browser DOM. JSX pragma is `@opentui/react` (set in tsconfig `jsxImportSource`).

**Entry point:** `src/index.tsx` — CLI parsing (Commander), onboarding prompts, session/config persistence, auth orchestration, and OpenTUI renderer bootstrap. This is where `main()` lives.

**Data flow:** `index.tsx` creates a `SynologyClient`, authenticates (1Password or manual), then passes the client + callbacks into `<App>`. The App component owns the refresh loop (1s interval), keyboard handling, and task CRUD. Destination caching flows back up via `onDestinationChange` callback.

### Key modules

- `src/services/SynologyClient.ts` — All Synology API calls go through this class (POST to `/webapi/entry.cgi`). Uses `SynologyRequestError` with Synology error codes. Code 119 = session expired. Code 120 = missing destination.
- `src/services/configStore.ts` / `sessionStore.ts` — JSON file persistence under `~/.config/synology-ds/`. Config stores host/TLS/1Password prefs. Sessions store SID + username + cached destination per host.
- `src/services/onePassword.ts` — Synchronous `op` CLI integration via `spawnSync`. Fetches credentials + TOTP.
- `src/services/auth.ts` — Auth orchestration: session validation, 1Password/manual login, session merge, and `refreshSession` / `updateDestination` callbacks.
- `src/services/relay.ts` — Localhost HTTP relay (`Bun.serve`) for the Safari extension. Validates Origin (`safari-web-extension://`), handles session re-auth with promise coalescing.
- `src/services/prompt.ts` — readline-based interactive prompts (including hidden input for passwords).
- `src/tui/App.tsx` — Single large component: task table with responsive column widths, keyboard shortcuts, inline URL creation via `<textarea>`. No sub-components currently.
- `src/tui/theme.ts` — Centralized color constants for the TUI.
- `src/types/synology.ts` — Shared type definitions for Synology API responses and task status codes.
- `src/utils/formatting.ts` — Byte/speed/percent formatters and `deriveProgress`.
- `src/utils/fs.ts` — Config dir management (`~/.config/synology-ds/`) and JSON read/write helpers.

### Important patterns

- **Session reauth:** Both `loadTasks` and `performAction` in App.tsx catch error code 119 and transparently re-authenticate before retrying. Manual logins reprompt inline; 1Password logins call `op` again.
- **Destination caching:** The NAS returns error 120 if `destination` is omitted on task creation. The app extracts destination from existing tasks and persists it in `sessions.json` to avoid this.
- **TLS:** `--insecure` passes `tls: { rejectUnauthorized: false }` per-request in `SynologyClient.post()`. Scoped to Synology API calls only.
- **Bun polyfill:** `ensureBunPolyfills()` in index.tsx shims `Bun.stripANSI` using the `strip-ansi` package (needed by OpenTUI).

## Coding Conventions

- TypeScript strict mode. Explicit `interface`/`type` over `any`. Exported symbols must have return types.
- Functional React components + hooks only. OpenTUI layout primitives: `<box>`, `<text>`, `<textarea>`, `<span>`.
- 2-space indent. No additional lint tools beyond `tsc --noEmit`.
- Commit format: conventional commits with optional scope, e.g. `feat(cli): add serve subcommand`, `fix: handle otp expiry`, `refactor(auth): extract module`.
- Tests live under `src/**/__tests__/` as `*.test.ts` files.
- No Swift/ncurses code — the project was fully migrated to Bun + OpenTUI.

## Security Rules

- Never persist credentials (password/OTP) to disk. Only SID, username, and destination go in `sessions.json`.
- All API calls go through `SynologyClient` — no raw `fetch` elsewhere.
- Paste input is sanitized via `strip-ansi` + control character removal before use.
