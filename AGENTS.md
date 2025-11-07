# Agent Playbook

This document explains how to collaborate on `synology-ds` as an automation or AI agent. Follow it closely to keep the project stable, secure, and consistent with the user’s expectations.

---

## 1. Architecture Snapshot

- **Runtime:** Bun 1.2.x with strict TypeScript.
- **UI:** React components rendered through OpenTUI (`@opentui/core` + `@opentui/react`).
- **Entry point:** `src/index.tsx` handles CLI parsing (Commander), onboarding prompts, session persistence, and renderer bootstrapping.
- **Services:** `src/services/` contains the Synology API client, config/session stores, prompt utilities, filesystem helpers, and 1Password integration.
- **UI logic:** `src/tui/` houses the main TUI (`App.tsx`) and any supporting components/hooks.
- **Utilities:** `src/utils/` for formatting and filesystem helpers. Reuse utilities instead of duplicating logic.
- **Distribution:** `bun run build` emits `dist/index.js` with a `#!/usr/bin/env bun` banner; that binary is what we expect to ship.

There is no Swift code left—do not reference or add Swift/ncurses components when iterating.

---

## 2. Development Workflow

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Run dev build | `bun run dev` |
| Build release | `bun run build` |
| Type-check / lint | `bunx tsc --noEmit` |
| Execute built artifact | `bun run start` or `./dist/index.js` |

Notes:
- Baseline coverage lives under `src/utils/__tests__` and `src/services/__tests__`. Add new suites under `src/**/__tests__` and run them with `bun test`.
- When touching build scripts or package metadata, re-run both `bunx tsc --noEmit` **and** `bun run build`.

---

## 3. Coding Standards

1. **TypeScript**
   - Strict mode is enforced. Prefer explicit `interface`/`type` definitions over `any`.
   - Exported symbols must declare return types.
   - Use modern ES modules and `async/await`.
   - Indent with two spaces; rely on the TypeScript formatter rather than adding extra lint tools.

2. **React / OpenTUI**
   - Functional components + hooks only.
   - Keep side effects in `useEffect` with cleanup functions.
   - Accessing private renderer fields (`_keyHandler`) is a last resort—guard for undefined and document why it’s needed.
   - Layout should react to terminal width/height; clamp column widths and avoid multi-line wraps.

3. **State & Persistence**
   - Credentials (username/password/OTP) must never be persisted. `sessions.json` can store `{ sid, username, destination }` only.
   - Use `updateSession()` to merge host-specific state (SID, username, cached destination). Never overwrite entire entries without reading existing data.

4. **Networking**
   - Extend `SynologyClient` when adding API coverage. Do not issue raw `fetch` calls elsewhere.
   - Throw `SynologyRequestError` with contextual messages so the TUI can surface them cleanly.
   - Respect `allowInsecure` by using the existing URLSession delegate pattern inside the client.

---

## 4. Authentication & Sessions

- Manual logins (username/password) must re-prompt the user whenever Synology returns code `119` (session expired). Never tell users to restart.
- 1Password flows (`--op-item`) expect the user to have run `eval "$(op signin)"`. If `op` fails, bubble up the stderr output so the fix is obvious.
- Session caching:
  - Lives at `~/.config/synology-ds/sessions.json`.
  - Deleting the file or using `--no-session-cache` must fully disable caching.
  - Cached destinations are essential: Synology error `120` is triggered when we omit the destination. Keep the cache in sync with the latest API responses and propagate changes back through `onDestinationChange`.

---

## 5. UX Expectations

- Auto-refresh every ~1 s. Any computation in `loadTasks()` must remain lightweight.
- The “new task” prompt supports bracketed paste (cmd+V). All control/ANSI sequences must be stripped before appending to the input field.
- Footer layout: key legend left-aligned, status message right-aligned. Preserve this structure when editing the TUI.
- If a new workflow needs additional user input (e.g., destination chooser, OTP prompt), keep it inline and non-blocking for other keybindings.

---

## 6. Testing & Validation

- Minimum requirement for every change: `bunx tsc --noEmit` **and** `bun test`.
- When editing build scripts, session logic, or distribution settings, also run `bun run build`.
- Manual smoke tests before handoff:
  1. Launch `bun run dev`.
  2. Authenticate (with and without 1Password if possible).
  3. Trigger key shortcuts (`n`, `space`, `d`, `c`, `r`, `q`).
  4. Paste a URL into the prompt to ensure the handler still works.
  5. Verify tasks refresh and destination caching behaves as expected.
- Document the commands (and any manual verifications) in your final response if automated coverage is unavailable.

---

## 7. Documentation, Commits & PRs

- Update `README.md` whenever you change CLI flags, onboarding steps, or keyboard shortcuts.
- Use the requested commit format: lowercase + prefix (e.g., `feature: add tui header borders`, `fix: handle otp expiry`).
- PR descriptions should contain:
  1. Problem statement / user impact.
  2. Solution summary.
  3. Security considerations (auth, session cache, 1Password).
  4. Testing evidence (commands and, for UI changes, screenshots or terminal recordings).

---

## 8. Security Checklist

- Never log raw credentials, OTP codes, or 1Password data.
- Redact hostnames/usernames when printing debug info unless explicitly required.
- `--insecure` is process-scoped; do not toggle global Node TLS settings.
- If you touch the 1Password integration, remind users to maintain an active `op` session.
- Ensure paste sanitization continues to strip ANSI/control codes to avoid command injection.

---

Following this playbook keeps the CLI fast, predictable, and safe for users managing their Synology downloads. When in doubt—especially around authentication or session handling—pause and ask for clarification before landing changes.
