---
date: 2026-04-09
topic: opentui-upgrade
---

# Upgrade OpenTUI from 0.1.36 to 0.1.97

## Problem Frame

The project pins `@opentui/core` and `@opentui/react` at `^0.1.36` (Nov 2025). The latest release is `0.1.97` (Apr 5, 2026) -- 61 versions and 5 months of development behind. While there are no known bugs blocking current work, the gap means we're missing keyboard handling fixes (Shift+Tab, Kitty alt-key), stdin parser improvements, terminal state restoration during mid-frame destruction, and a new plugin/slots architecture.

## Requirements

- R1. Update `@opentui/core` and `@opentui/react` to `^0.1.97` in package.json
- R2. Run `bun install` and verify the native binary (`core-darwin-arm64`) downloads correctly
- R3. Typecheck passes (`bunx tsc --noEmit`) with no new errors
- R4. All existing tests pass (`bun test`)
- R5. Manual smoke test: launch `bun run dev`, authenticate, verify all keyboard shortcuts work (arrow keys, space, n, d, c, r, q), paste a URL into the new-task prompt, and confirm the TUI renders correctly
- R6. Build succeeds (`bun run build`) and the dist artifact runs

## Success Criteria

- All 6 requirements pass on the first attempt, or any issues are identified and fixed
- No regressions in TUI rendering, keyboard handling, or paste support

## Scope Boundaries

- Not switching to a different TUI framework (Ink, blessed, etc.)
- Not adopting the new plugin/slots system yet -- just upgrading the dependency
- Not changing the `^` version range strategy (semver caret is fine for a pre-1.0 library that has shown no breaking changes)

## Key Decisions

- **Keep `^` range**: The project uses `^0.1.36` which allows patch bumps. Keeping `^0.1.97` rather than pinning exact -- OpenTUI publishes frequently (97 releases) with no documented breaking changes, so the flexibility is worth it.
- **Upgrade both packages together**: `@opentui/core` and `@opentui/react` should stay version-aligned.

## Dependencies / Assumptions

- OpenTUI 0.1.97 continues to support React 19.x and Bun 1.2.x
- No breaking API changes in the 0.1.36 -> 0.1.97 range (confirmed via release notes scan -- changes are incremental: keyboard fixes, renderer improvements, plugin system)

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Needs testing] Does the `useKeyboard` hook behavior change between versions? The hook doesn't expose a dependency array -- verify the callback is always current after upgrade.
- [Affects R5][Needs testing] Does the `<textarea>` component's `plainText` property still work identically? Paste handling relies on this.

## Next Steps

-> `/ce:plan` for structured implementation planning
