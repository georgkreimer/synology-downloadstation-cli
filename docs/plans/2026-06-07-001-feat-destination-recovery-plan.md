---
title: "feat: Add destination recovery to task creation"
type: feat
status: completed
date: 2026-06-07
origin: docs/brainstorms/2026-06-07-destination-recovery-requirements.md
---

# feat: Add destination recovery to task creation

## Enhancement Summary

**Deepened on:** 2026-06-07
**Sections enhanced:** Proposed solution, research findings, technical considerations, implementation units, risks, validation, and sources.
**Research inputs used:** Local repo inspection, AGENTS.md constraints, OpenTUI React documentation via Context7, OpenTUI local README/type references, security review perspective, UI race/state-machine review perspective, and simplicity review perspective.

### Key Improvements

1. Added a concrete create-flow state machine so implementation does not drift into competing boolean flags.
2. Clarified the OpenTUI input approach: one active input by mode, with `focused` controlled from state and URL text captured before mode switches.
3. Tightened retry and cache semantics so stale destinations are only replaced after a successful create.
4. Expanded relay `120` handling to cover both initial create and post-reauth retry paths.
5. Added test seams and manual smoke scenarios for behavior not currently covered by service tests.

### New Considerations Discovered

- OpenTUI React examples use explicit focus state (`focused={focused === "..."}`) and `useKeyboard` for navigation/submission, which supports a modal mode model instead of multiple simultaneous inputs.
- The current create modal reads from `textareaRef.current?.plainText`; changing the rendered input can drop that ref, so pending URLs must be copied into React state before entering destination mode.
- `busy` currently gates polling but not repeated submit keystrokes inside the modal; destination recovery should ignore submit while `busy` is true to avoid duplicate creates.

## Overview

Add a guided destination recovery path for Download Station task creation. When the TUI cannot infer a destination, it should ask the user for one before submitting the task, preserve the entered URLs, cache the destination for the current host, and retry once if Synology still returns error `120`. The relay remains non-interactive and returns an actionable setup error for code `120` instead of a generic NAS failure.

This carries forward the proactive TUI recovery approach, retry-on-120 fallback, non-interactive relay boundary, and host-scoped destination caching from the origin document (see origin: `docs/brainstorms/2026-06-07-destination-recovery-requirements.md`).

## Problem Statement / Motivation

The current TUI create flow tries cached destination, then Synology default destination, then submits without a destination and lets the API decide (`src/tui/App.tsx:383-407`). That can surface `Failed to create task. (120)` for first-run users, empty task lists, or invalid stale destinations. The README promises destination recovery behavior, but the current implementation does not prompt for a destination in this path (see origin: `docs/brainstorms/2026-06-07-destination-recovery-requirements.md`).

The relay has the same underlying dependency but cannot prompt users. It currently maps most non-network Synology failures to a generic 500 response (`src/services/relay.ts:102-133`), which is not enough guidance for a Safari extension user.

## Proposed Solution

Extend the existing create modal into a two-step flow:

1. User enters one or more URLs.
2. If no cached or NAS default destination exists, the modal switches to a destination entry state while retaining the URL text.
3. User submits a destination path.
4. The TUI creates the task(s), updates the in-memory destination, and calls `onDestinationChange` so session storage is updated when session caching is enabled.
5. If task creation returns `SynologyRequestError` code `120`, the TUI switches to the same destination entry state, marks it as a retry, and retries once after the user submits a new path.

For the relay, add an explicit `120` branch that returns a setup-oriented message such as: "Download destination required. Open the TUI, create a download, and enter a destination path." Use a client-error style status such as 409 because the relay request is syntactically valid but cannot be completed until local destination state is configured.

## Research Findings

### Repository Context

- Runtime is Bun 1.2.x with strict TypeScript; React components render through OpenTUI.
- `src/tui/App.tsx` owns polling, create prompt state, destination inference, status messages, and keyboard handling.
- `src/services/SynologyClient.ts` centralizes Synology API calls and converts failed API responses into `SynologyRequestError` with numeric codes.
- `src/services/auth.ts` exposes `updateDestination`, which merges destination into the host-scoped session only when session caching is enabled.
- `src/services/relay.ts` already resolves cached/default destination and handles session-expired retry.
- No `docs/solutions/` directory exists, so there are no institutional learnings to apply.

### Project Constraints

- Credentials, OTPs, and 1Password data must never be persisted.
- Session cache entries may store SID, username, destination, and timestamp only.
- `--no-session-cache` must fully disable persistent caching, but in-memory reuse during a process is acceptable (see origin: `docs/brainstorms/2026-06-07-destination-recovery-requirements.md`).
- New user input must remain inline and non-blocking for other keybindings.
- Paste sanitization and bracketed paste behavior must continue to strip ANSI/control characters.
- Minimum validation for code changes is `bunx tsc --noEmit` and `bun test`.

### OpenTUI Findings

- OpenTUI React inputs and textareas accept a `focused` prop, and examples model focus as React state rather than relying on private renderer fields.
- OpenTUI textarea examples read text through `TextareaRenderable.plainText`, matching the current code, but that is safe only while the textarea remains mounted.
- Multi-input examples use `useKeyboard` to change focus state, which means this feature can stay within the existing `useKeyboard` handler and avoid private `_keyHandler` access.
- For this feature, prefer rendering a single input surface per mode (`textarea` for URLs, likely `input` or a one-line `textarea` for destination) rather than two focused controls in one modal.

### Review Perspective Findings

- **Security:** Destination paths are user input. They should be trimmed and rejected when empty, but not aggressively sanitized as URLs because valid Synology paths may include spaces or non-URL characters. Do not log them or include them in relay error responses.
- **Simplicity:** A full destination manager, path browser, extension settings UI, or reusable modal framework would violate the origin scope. Keep the implementation local to create-task recovery.
- **UI race/state:** Submit handling should be ignored while `busy` is true. The plan should avoid a state combination where `busy`, `showCreatePrompt`, `createPromptMode`, and `pendingCreateUrls` disagree.

### SpecFlow Analysis

Primary user flows:

- First-run TUI user enters URLs, no destination exists, destination prompt appears, user enters destination, task creation succeeds.
- Returning TUI user has cached/default destination, current create flow remains one-step.
- TUI user has stale or invalid destination, task creation returns `120`, user enters corrected destination, retry succeeds.
- TUI user cancels at the destination step, the create flow closes without creating tasks or mutating cached destination.
- Relay receives `120`, cannot prompt, returns an actionable setup message.

Key gaps resolved in this plan:

- OpenTUI interaction model: reuse the existing create modal and add a mode field rather than creating a second modal.
- Invalid destination cache behavior: do not clear the cached destination merely because `120` occurs; replace it only after the user submits a new destination and the retry succeeds.
- Relay response: use an explicit `120` response branch with a non-generic message and status 409.

## Technical Considerations

### TUI State Model

Use a small explicit mode instead of multiple booleans:

```ts
type CreatePromptMode = "urls" | "destination" | "destinationRetry"
```

Keep URL text available across modes. The existing implementation reads URL text directly from `textareaRef.current?.plainText`, which can disappear if the textarea is re-keyed or replaced. The implementation should introduce state or refs for pending URLs before switching to destination mode.

Recommended state shape:

- `createPromptMode`: current modal mode.
- `pendingCreateUrls`: parsed URLs retained while destination is requested.
- `destinationInputRef`: input/textarea renderable for the destination value.
- `destinationInputKey` or equivalent reset control for the destination textarea/input.
- `destinationRetryAttempted`: boolean guard to prevent repeated retry loops if error `120` persists after a retry.
- `pendingDestination`: optional string only if the implementation needs controlled input; do not persist this separately.

Recommended transitions:

| Current State | Event | Guard | Next State | Side Effects |
|---|---|---|---|---|
| `closed` | `n` | none | `urls` | Reset URL input, pending URLs, retry flag, status |
| `urls` | submit | no URLs | `urls` | Show "Provide at least one URL." |
| `urls` | submit | cached/default destination exists | `urls` while busy, then closed | Create tasks, cache destination after success, refresh |
| `urls` | submit | no destination | `destination` | Store parsed URLs, reset destination input |
| `destination` | submit | empty destination | `destination` | Show persistent input error |
| `destination` | submit | non-empty destination succeeds | closed | Create tasks, cache destination, refresh |
| `destination` | submit | returns `120` and no retry used | `destinationRetry` | Keep URLs, ask for corrected destination |
| `destinationRetry` | submit | returns `120` again | closed | Show clear Synology `120` error and require reopening the prompt to try again |
| any prompt state | `Esc` | none | closed | Clear pending create state, do not cache destination |

Recommended helper shape:

```ts
interface CreateAttempt {
  urls: string[]
  destination: string
  retryingDestination: boolean
}

async function createWithDestination(attempt: CreateAttempt): Promise<void>
```

The helper should own the success path and the `120` branch, but it should not parse URLs or read renderable refs. Keeping ref reads at the keyboard/input boundary makes the async create path easier to reason about.

### Destination Resolution

The current order should remain:

1. In-memory cached destination (`defaultDestinationRef.current`)
2. NAS default (`client.getDefaultDestination()`)
3. Manual destination entry

When the user supplies a destination:

- Trim whitespace.
- Reject empty destination with a TUI error and keep the destination prompt open.
- Use the value for the pending create call.
- Cache only after the create succeeds, except the in-memory value may be staged during the retry attempt if needed for the request.
- Do not clear `defaultDestinationRef.current` on the first `120`; a transient Synology error or destination permission issue should not erase the last known value until a replacement succeeds.
- If a user-entered destination succeeds, update `defaultDestinationRef.current` and call `onDestinationChange?.(destination)` exactly once for that successful create.

### Error Handling

Preserve existing session retry behavior for code `119`; destination recovery handles code `120`.

If create fails with code `120`:

- If no retry has been attempted, switch to `destinationRetry` mode and preserve the pending URLs.
- If a retry has already been attempted, show a clear persistent error and do not loop.
- If the `120` occurs after using a cached/default destination, treat the next destination entry as the one allowed retry.
- If a non-`120` error occurs while in `destinationRetry`, do not stay in an ambiguous state; keep the modal open with the pending URLs and show the error so the user can correct or cancel.

If create fails with any other error, use existing `formatError` behavior.

### Prompt Rendering Details

URL mode should keep the current modal title and URL copy. Destination mode should use the same modal shell with changed body text and controls:

- Title: ` Download Destination ` or ` Destination Required `
- Body copy: one concise sentence, e.g. `Enter the Synology destination path for these downloads:`
- Retry copy: `Synology still requires a valid destination. Enter a destination path and retry:`
- Placeholder: `/volume1/downloads`
- Footer: `Ctrl+Enter save and create`, `Esc cancel`

Keep text compact because the modal is width-limited (`Math.min(64, width - 4)`). Avoid adding explanatory paragraphs in the TUI; the README can carry detail.

### Relay Behavior

In `handleAdd`, add explicit handling for `SynologyRequestError` code `120` in both the initial create attempt and the post-reauth retry branch. The response should not mention credentials or internals beyond the destination requirement.

Recommended response:

```json
{
  "ok": false,
  "error": "Download destination required. Open the TUI and enter a destination path before using the Safari extension."
}
```

Recommended status: `409`.

Recommended helper:

```ts
function isDestinationRequired(error: unknown): error is SynologyRequestError {
  return error instanceof SynologyRequestError && error.code === 120
}
```

Use the helper in both catch blocks so the initial create and post-reauth retry return the same destination setup response.

### Security Considerations

- Do not log destination paths unless existing code already surfaces them in UI state.
- Do not persist destination when `--no-session-cache` disables session caching; rely on `auth.updateDestination` because it already gates persistence on `useSessionCache`.
- Do not change CORS origin validation or relay binding.
- Do not add raw `fetch` calls outside `SynologyClient`.
- Do not return the attempted destination path in relay JSON. The Safari extension only needs setup guidance, not local path details.
- Do not validate destination by trying unrelated API calls outside task creation; that would expand Synology API coverage beyond the scope and could expose different permissions behavior.

## System-Wide Impact

- **Interaction graph:** `n` opens create modal -> URL submit triggers destination resolution -> optional destination mode -> `SynologyClient.createTasksFromUrls` -> `onDestinationChange` -> `auth.updateDestination` -> `sessionStore.updateSession` when caching is enabled.
- **Error propagation:** `SynologyClient.requireSuccess` throws `SynologyRequestError(120)` -> TUI intercepts for guided recovery or relay returns status 409. `119` continues through existing re-auth retry.
- **State lifecycle risks:** Creating tasks before caching destination can leave a successful task without persisted destination if `onDestinationChange` is skipped. Cache after successful create and verify tests cover the callback.
- **API surface parity:** TUI and relay both create tasks, but only TUI can prompt. Relay must not gain interactive behavior.
- **Integration test scenarios:** Manual TUI smoke testing is important because OpenTUI keyboard/modal behavior is not covered by current service tests.
- **Concurrency risk:** Auto-refresh is paused while `showCreatePrompt` or `busy` is true; keep that behavior so destination entry is not disrupted by polling. Guard submit actions with `if (busy) return`.

## Implementation Units

### U0. Preserve a Small State Machine Before Editing

**Goal:** Make the create prompt states explicit before changing behavior.

**Files:**

- Modify: `src/tui/App.tsx`

**Approach:**

- Add `type CreatePromptMode = "urls" | "destination" | "destinationRetry"`.
- Add a reset helper such as `resetCreatePrompt()` that clears mode, pending URLs, input keys, and retry flag together.
- Use this helper from `n`, `Esc`, and success paths so state does not get cleared differently in different branches.
- Add a small helper such as `isDestinationRequired(error)` either in `App.tsx` or a shared service module if relay also uses it.

**Acceptance:**

- There is a single reset path for create prompt state.
- The implementation does not add separate booleans like `showDestinationPrompt` plus `retryDestination` when `createPromptMode` can carry that state.

### U1. Add Destination Prompt State to the TUI

**Goal:** Extend the existing create modal so it can collect either URLs or a destination path without losing pending URLs.

**Files:**

- Modify: `src/tui/App.tsx`

**Approach:**

- Add a `CreatePromptMode` type and state initialized to `"urls"`.
- Add state/ref storage for parsed pending URLs.
- Adjust `n` key handling to reset mode to `"urls"` and clear pending URLs.
- Adjust `Esc` handling so canceling either create step closes the modal, clears pending create state, and does not mutate destination cache.
- Render destination instructions and a destination input when mode is `"destination"` or `"destinationRetry"`.
- Keep the existing URL textarea and paste sanitization path intact for URL mode.
- Use OpenTUI's `focused` prop so only the currently visible input is focused.
- Prefer `initialValue`/key-reset patterns over trying to imperatively mutate the renderable after mode changes.

**Acceptance:**

- Pressing `n` starts in URL mode.
- Submitting URLs with no destination switches to destination mode.
- URLs are preserved across the mode switch.
- `Esc` cancels without creating tasks or updating destination cache.
- Reopening the create modal after cancel does not show stale destination text or stale pending URLs.

### U2. Implement Proactive Destination Recovery and Retry

**Goal:** Make task creation ask for a destination before predictable `120` failures and retry once when `120` still occurs.

**Files:**

- Modify: `src/tui/App.tsx`

**Approach:**

- Split URL submission from final task creation:
  - `handleUrlSubmit()` parses and validates URLs, resolves cached/default destination, and either creates immediately or switches to destination mode.
  - `handleDestinationSubmit()` validates destination and calls the final create path.
- Create a helper such as `createWithDestination(urls, destination, retryContext)` to centralize success handling.
- On success, set `defaultDestinationRef.current`, call `onDestinationChange?.(destination)`, close modal, reset prompt state, and refresh tasks.
- On `SynologyRequestError` code `120`, switch to `destinationRetry` mode if no retry has been used.
- On a second `120`, show a clear error and leave the user in destination mode so they can correct the path or cancel.
- Add `if (busy) return` at the top of submit handlers to prevent duplicate task creation from repeated `Ctrl+Enter`.
- Keep `loadTasks()` after success, not after failed destination attempts.

**Acceptance:**

- No destination available -> user enters destination -> create succeeds -> destination callback is called.
- Existing cached/default destination -> create remains a one-step flow.
- First create returns `120` -> user enters destination -> one retry occurs.
- Second `120` does not loop indefinitely.
- Error `119` still triggers existing session refresh before retrying the action.
- Repeated submit while busy does not create duplicate tasks.

### U3. Add Relay Error 120 Messaging

**Goal:** Make Safari relay failures actionable when destination state is missing.

**Files:**

- Modify: `src/services/relay.ts`
- Modify: `src/services/__tests__/relay.test.ts`

**Approach:**

- Add a helper to detect `SynologyRequestError` code `120`.
- In the initial create catch block, return status `409` with the destination setup message.
- In the post-reauth retry catch block, return the same status/message for code `120`; keep other retry failures as 502.
- Keep existing CORS headers and origin behavior unchanged.
- Keep response shape consistent with the existing extension contract: `{ ok: false, error: string }`.
- Avoid changing `extension/background.js`; its existing failed-request handling will show the failure badge and log the message.

**Acceptance:**

- Relay returns `409` and an actionable destination message for code `120`.
- Session-expired code `119` behavior still reauthenticates and retries.
- Network failures still map to 502.
- Forbidden origins remain rejected.
- CORS headers are still present on the `409` response for Safari extension origins.

### U4. Add Focused Tests and Documentation Updates

**Goal:** Cover service-level behavior and document the new destination recovery flow.

**Files:**

- Modify: `src/services/__tests__/relay.test.ts`
- Modify as needed: `src/services/__tests__/SynologyClient.test.ts`
- Modify: `README.md`

**Approach:**

- Update the existing relay test that expects code `120` to return 500; expect 409 and the setup message instead.
- Add a relay test for `120` after session re-auth retry.
- If any helper is extracted from `App.tsx` for pure destination/error handling, add unit tests near the helper. If no pure helper is extracted, rely on manual TUI smoke tests for modal behavior.
- Update README destination caching/troubleshooting language to state that the TUI prompts for a destination when needed.
- Add tests around any exported pure helper for `isDestinationRequired`, if shared.
- If an app-level TUI test harness is not available, document that TUI modal behavior is manually smoke-tested.

**Acceptance:**

- `bunx tsc --noEmit` passes.
- `bun test` passes.
- README accurately describes destination prompting and relay setup failure behavior.

### U5. Manual Verification Script for TUI Behavior

**Goal:** Make manual verification reproducible enough for handoff.

**Files:**

- No required file changes unless the implementer chooses to add a lightweight notes section to README.

**Approach:**

- Before running `bun run dev`, temporarily move or edit the local session cache only if the user approves or uses a disposable config path.
- Prefer using `--no-session-cache` for persistence checks where possible, but remember this disables reading cached destination and may affect the setup path.
- Verify three TUI paths:
  - no destination -> prompt -> success
  - cached destination -> no prompt -> success
  - stale destination or mocked `120` -> retry prompt -> success/failure message
- Verify one relay path:
  - relay create returns `120` -> HTTP `409` JSON with setup message.

**Acceptance:**

- Final implementation handoff includes which manual paths were verified and which could not be reproduced against the real NAS.

## Acceptance Criteria

- [ ] Creating a task in the TUI with no cached/default destination asks for a destination before task creation.
- [ ] URLs entered in the create prompt are preserved while the destination is requested.
- [ ] A provided destination is used for the pending create request and cached for the current host after success.
- [ ] Synology error `120` in the TUI create flow triggers one guided destination retry.
- [ ] A second `120` shows a clear error instead of looping or asking the user to restart.
- [ ] Relay code `120` returns an actionable setup message and status 409.
- [ ] Relay session-expired code `119` behavior remains unchanged.
- [ ] `--no-session-cache` does not persist destination, while in-memory reuse during the run remains allowed.
- [ ] Paste sanitization for URL input remains intact.
- [ ] README is updated for the destination recovery behavior.
- [ ] Submit handlers ignore duplicate submits while busy.
- [ ] Destination prompts never persist or log raw credentials, OTPs, or 1Password data.

## Success Metrics

- A first-run user can create a download from the TUI without editing `sessions.json`.
- Bare `Failed to create task. (120)` no longer appears from the normal TUI create flow.
- Safari relay users receive a clear instruction when destination setup is missing.
- Existing service tests continue to pass.

## Dependencies & Risks

- **OpenTUI input focus:** Multiple text inputs in one modal may be awkward. Mitigation: reuse a single focused text input/textarea by mode rather than rendering multiple active inputs.
- **URL preservation:** Reading only from `textareaRef` is fragile across mode changes. Mitigation: store parsed pending URLs before switching modes.
- **Retry loops:** Code `120` can recur if the user enters an invalid path. Mitigation: track retry attempts and do not retry automatically more than once.
- **Destination persistence:** Incorrectly calling `sessionStore` directly could bypass `--no-session-cache`. Mitigation: only use `onDestinationChange`, which routes through `auth.updateDestination`.
- **Manual TUI verification:** Current tests do not exercise OpenTUI modal interactions. Mitigation: include smoke testing in handoff.
- **Duplicate submit race:** The current modal handles `Ctrl+Enter` through `useKeyboard`; repeated keypresses can happen while async creation is running. Mitigation: guard submit handlers with `busy`.
- **Ref lifecycle:** Switching modal content can unmount `textareaRef`. Mitigation: capture parsed URLs into state before changing `createPromptMode`.
- **Scope creep:** Destination browsing, validation APIs, and extension settings are attractive follow-ups. Mitigation: keep them explicitly out of this implementation.

## Validation Plan

Automated:

- `bunx tsc --noEmit`
- `bun test`

Focused automated cases to add or update:

- Relay `120` initial create -> status 409, `ok: false`, setup message, CORS headers.
- Relay `119` then retry `120` -> refresh session called once, status 409, setup message.
- Relay network failure still -> status 502.
- Existing `SynologyClient` destination parameter test still passes.
- Any extracted pure helper correctly detects only `SynologyRequestError` code `120`.

Manual smoke:

1. Launch `bun run dev`.
2. Authenticate with a state where no cached/default destination is available if possible.
3. Press `n`, paste one or more URLs, submit, confirm destination prompt appears.
4. Enter a destination and verify task creation succeeds.
5. Verify `sessions.json` stores destination only when session caching is enabled.
6. Simulate or force a `120` path if possible and verify one retry prompt.
7. Run relay or TUI relay path and confirm Safari/relay error messaging for missing destination is actionable.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-07-destination-recovery-requirements.md` — carried forward proactive TUI recovery, retry-on-120 fallback, non-interactive relay boundary, host-scoped destination caching, and no destination manager/browser picker scope.
- `AGENTS.md` — project rules for Bun/TypeScript, OpenTUI, session persistence, validation, and security.
- `src/tui/App.tsx:123-126` — initial destination ref derives from cached destination or task details.
- `src/tui/App.tsx:383-407` — current create flow resolves cached/default destination then submits.
- `src/tui/App.tsx:614-652` — existing create modal to extend.
- `src/services/SynologyClient.ts:138-166` — task creation and destination parameter handling.
- `src/services/SynologyClient.ts:223-231` — failed API responses become `SynologyRequestError` with code.
- `src/services/auth.ts:51-55` and `src/services/auth.ts:122-128` — destination persistence callback respects session cache configuration.
- `src/services/relay.ts:84-90` and `src/services/relay.ts:102-133` — relay destination resolution and error handling.
- `src/services/__tests__/relay.test.ts:105-118` — existing `120` relay test to update.
- OpenTUI React documentation via Context7 (`/anomalyco/opentui`) — focused input examples use React state with `focused={...}` and `useKeyboard`; textarea examples read `TextareaRenderable.plainText`.
- `node_modules/@opentui/react/README.md` — local installed OpenTUI examples for input, textarea, and focus behavior.
