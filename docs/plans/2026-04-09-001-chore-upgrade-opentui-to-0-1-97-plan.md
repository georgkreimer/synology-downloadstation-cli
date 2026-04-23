---
title: "chore: Upgrade OpenTUI to 0.1.97"
type: refactor
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-opentui-upgrade-requirements.md
---

# chore: Upgrade OpenTUI from 0.1.36 to 0.1.97

## Overview

Upgrade `@opentui/core` and `@opentui/react` from `0.1.36` (Nov 2025) to `0.1.97` (Apr 2026). This is a 61-version gap spanning 5 months of active development. No breaking changes are documented. The upgrade brings keyboard handling fixes, stdin parser improvements, terminal state restoration, and a new plugin/slots architecture (see origin: `docs/brainstorms/2026-04-09-opentui-upgrade-requirements.md`).

## Problem Statement / Motivation

The project is 61 versions behind on its TUI framework. While there are no current blocking bugs, the gap means missing fixes for keyboard handling (Shift+Tab, Kitty alt-key), improved stdin parser reliability (timeout increased to 20ms), terminal state restoration during mid-frame destruction, and general renderer stability. Staying current reduces the risk of a large, painful future upgrade.

## Proposed Solution

Bump both `@opentui/core` and `@opentui/react` to `^0.1.97` in `package.json`, run `bun install`, and verify through typecheck, tests, build, and manual smoke test.

## Coupling Surface (from research)

The OpenTUI dependency is narrowly scoped to **2 source files** and **1 config file**:

| API | Package | File | Lines |
|-----|---------|------|-------|
| `createCliRenderer()` | `@opentui/core` | `src/index.tsx` | 167 |
| `createRoot()` | `@opentui/react` | `src/index.tsx` | 168 |
| `TextareaRenderable` (type) | `@opentui/core` | `src/tui/App.tsx` | 3, 107 |
| `TextareaRenderable.plainText` | `@opentui/core` | `src/tui/App.tsx` | 373 |
| `useKeyboard()` | `@opentui/react` | `src/tui/App.tsx` | 326 |
| `useTerminalDimensions()` | `@opentui/react` | `src/tui/App.tsx` | 105 |
| `jsxImportSource` | `@opentui/react` | `tsconfig.json` | 14 |
| JSX intrinsics: `<box>`, `<text>`, `<textarea>`, `<span>`, `<strong>` | `@opentui/react` | `src/tui/App.tsx` | various |

No test files reference OpenTUI. No private/internal APIs are accessed.

## Implementation Units

### Unit 1: Bump versions in package.json

- **Goal:** Update dependency versions
- **Files:** `package.json`
- **Approach:** Change both `@opentui/core` and `@opentui/react` from `"^0.1.36"` to `"^0.1.97"`
- **Verification:** `package.json` has correct versions

### Unit 2: Install and verify native binary

- **Goal:** Ensure `bun install` resolves correctly, including the platform-specific native binary (`@opentui/core-darwin-arm64`)
- **Files:** `bun.lock`
- **Approach:** Run `bun install`. Verify the lockfile updates cleanly and the `node_modules/@opentui/core-darwin-arm64` directory exists with the new version.
- **Verification:** `bun install` exits 0, lockfile shows 0.1.97

### Unit 3: Typecheck

- **Goal:** Confirm no type-level breaking changes in the APIs we use
- **Files:** None modified
- **Approach:** Run `bunx tsc --noEmit`
- **Verification:** Zero errors. This validates that `createCliRenderer`, `createRoot`, `TextareaRenderable`, `useKeyboard`, `useTerminalDimensions`, and all JSX intrinsic elements still type-check.
- **What to watch for:** If `TextareaRenderable` type changed (e.g., `plainText` renamed or removed), the typecheck will catch it here.

### Unit 4: Run tests

- **Goal:** No regressions in existing test suite
- **Files:** None modified
- **Approach:** Run `bun test`
- **Verification:** All 15 tests pass. (Tests don't directly exercise OpenTUI, but they exercise services and utilities that the TUI depends on.)

### Unit 5: Build verification

- **Goal:** Confirm the production build still works
- **Files:** `dist/index.js` (output)
- **Approach:** Run `bun run build`. Verify `dist/index.js` is created and starts with the `#!/usr/bin/env bun` shebang.
- **Verification:** `bun run build` exits 0, output file exists

### Unit 6: Manual smoke test

- **Goal:** Verify runtime behavior of the TUI
- **Files:** None modified
- **Approach:** Run `bun run dev` and perform the following checks:
  1. Onboarding prompts work (or session is restored from cache)
  2. Task list renders and auto-refreshes (~1s)
  3. Arrow keys move selection
  4. `space` pauses/resumes a task
  5. `n` opens the new-task prompt
  6. Paste a URL into the textarea (tests `TextareaRenderable.plainText` + `sanitizeInput`)
  7. `Esc` cancels the prompt
  8. `r` forces a refresh
  9. `q` quits
  10. Terminal state is restored cleanly after quit (no garbled output)
- **Verification:** All 10 checks pass

### Unit 7: Check Bun.stripANSI polyfill

- **Goal:** Determine if the `ensureBunPolyfills()` shim in `src/index.tsx:28-36` is still needed
- **Files:** `src/index.tsx`
- **Approach:** After upgrading, check if OpenTUI 0.1.97 still requires `Bun.stripANSI`. Search the new `node_modules/@opentui/core` for references to `Bun.stripANSI` or `stripANSI`. If the polyfill is no longer needed, remove it and the `strip-ansi` import from `index.tsx` (keep `strip-ansi` in dependencies since `App.tsx` uses it for `sanitizeInput`).
- **Execution note:** This is investigative. If the polyfill is still needed, leave it. If not, remove it as a bonus cleanup.
- **Verification:** App still works with or without the polyfill change

## Acceptance Criteria

- [ ] `package.json` shows `@opentui/core` and `@opentui/react` at `^0.1.97`
- [ ] `bun install` completes without errors
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `bun test` passes all 15 tests
- [ ] `bun run build` produces `dist/index.js` successfully
- [ ] Manual smoke test confirms TUI renders, keyboard works, paste works, and terminal restores cleanly

## Dependencies & Risks

- **Risk: Undocumented breaking change.** Mitigation: The coupling surface is narrow (5 runtime APIs in 2 files). If typecheck passes, it's very likely safe. Manual smoke test covers the runtime path.
- **Risk: Native binary incompatibility.** Mitigation: `bun install` handles platform detection. If the new version drops arm64 macOS support, it will fail at install time, not at runtime.
- **Risk: `TextareaRenderable.plainText` property removed or renamed.** Mitigation: Typecheck (Unit 3) will catch this. If it fails, check the new type definitions for the replacement.

## Scope Boundaries

- Not switching to a different TUI framework (see origin)
- Not adopting the new plugin/slots system (0.1.88+) -- just upgrading
- Not adding OpenTUI-level tests (separate concern)

## Sources

- **Origin document:** [docs/brainstorms/2026-04-09-opentui-upgrade-requirements.md](../brainstorms/2026-04-09-opentui-upgrade-requirements.md) -- key decisions: stay on OpenTUI, keep `^` range, upgrade both packages together
- OpenTUI repo: https://github.com/anomalyco/opentui
- Release notes: https://github.com/anomalyco/opentui/releases
