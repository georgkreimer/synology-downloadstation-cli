---
date: 2026-06-07
topic: destination-recovery
---

# Destination Recovery

## Problem Frame

Users can create downloads from the TUI or Safari relay, but Synology may reject task creation with error `120` when no destination is supplied. The project intends to avoid this by caching the latest known destination, yet a new install or empty task list can still leave the app without a usable destination. In that state, the TUI should guide the user to provide a destination and recover in-place instead of surfacing a confusing API error.

## Requirements

- R1. When a user creates a task in the TUI and no cached or NAS default destination is available, the create flow asks for a download destination before submitting the task.
- R2. The destination prompt preserves the URLs the user already entered so they do not need to paste them again.
- R3. When the user provides a destination, the TUI uses it for the pending task creation and caches it for the current host.
- R4. If Synology still returns error `120` during task creation, the TUI treats it as a destination recovery case: ask for a destination, retry once, and cache the successful destination.
- R5. If the retry fails, the TUI shows a clear error that includes the Synology failure context without asking the user to restart.
- R6. The relay continues to use cached destination or NAS default destination only; if task creation fails with error `120`, it returns an actionable error telling the user to open the TUI and set a destination.
- R7. Disabling session caching with `--no-session-cache` also disables persistent destination caching, but the TUI may still reuse a destination in memory during the current run.

## Success Criteria

- A first-run TUI user with no cached destination can create a download without manually editing `sessions.json`.
- A pasted batch of URLs is not lost when the destination prompt appears.
- Synology error `120` no longer appears as a bare failure in the TUI create flow.
- The relay produces a clear setup instruction when it cannot infer a destination.
- Existing session cache behavior remains safe: credentials are never written to disk, and only SID, username, destination, and timestamp are stored.

## Scope Boundaries

- Do not build a full destination manager in this feature.
- Do not add destination browsing or folder selection from the NAS in this feature.
- Do not add extension preferences or a Safari popup for destination entry.
- Do not persist destinations when session caching is disabled.
- Do not change authentication, 1Password, or TLS behavior except as needed to preserve existing retry behavior.

## Key Decisions

- Proactive TUI recovery: The TUI should ask before submitting when it already knows no destination is available, because this prevents a predictable API failure.
- Retry-on-120 fallback: Even proactive checks can be wrong if the NAS rejects a destination or its defaults change, so error `120` should still trigger one guided retry.
- Relay stays non-interactive: The relay should not attempt stdin prompts or browser-driven destination entry; a clear instruction back to the user keeps the local relay simple and secure.
- Destination caching remains host-scoped: The value should stay tied to the normalized Synology host, matching current session behavior.

## Dependencies / Assumptions

- Synology error `120` continues to mean task creation requires a destination.
- A manually typed destination path is acceptable for this iteration.
- The TUI can show a destination prompt without losing the current create prompt input.

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] What is the simplest OpenTUI interaction model for adding destination entry without making the create modal brittle?
- [Affects R4][Technical] Should an invalid destination clear the cached destination immediately, or only replace it after a successful retry?
- [Affects R6][Technical] What exact relay status code and message best fit error `120` without exposing unnecessary NAS internals?

## Next Steps

-> `/prompts:ce-plan` for structured implementation planning.
