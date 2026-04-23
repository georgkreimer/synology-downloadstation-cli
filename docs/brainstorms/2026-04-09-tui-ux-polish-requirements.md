---
date: 2026-04-09
topic: tui-ux-polish
---

# TUI UX Polish

## Problem Frame

The TUI has several usability issues that make it frustrating when managing more than a handful of download tasks. The most critical: the task list overflows the terminal with no scrolling, so tasks beyond the visible area are invisible and unreachable visually. Several other rough edges compound the problem — accidental deletes with no confirmation, ephemeral status messages, no busy indicator, and a banner that wastes 30% of vertical space on small terminals.

## Requirements

### Task List Scrolling
- R1. The task list must scroll when tasks exceed the visible area. The selected row must always be visible — the viewport follows the cursor.
- R2. Selection must track by task ID, not array index. When tasks are added/removed during auto-refresh, the selection stays on the same task (or moves to the nearest neighbor if the selected task was removed).
- R11. Page Up/Page Down jump by one screenful of rows. Home jumps to the first task, End to the last.
- R12. When the list is scrollable, show a scrollbar track on the right edge of the task list box indicating the viewport position relative to the full list.

### Task Detail View
- R13. Pressing Enter on a selected task expands the row inline to show 2-3 additional lines of detail: source URL, created/started/completed timestamps, error detail (for failed tasks), and downloaded pieces.
- R14. The expanded detail collapses when the user moves selection (up/down) or presses Esc. Only one task can be expanded at a time.

### Error State
- R15. Tasks with error status (>= 101) render with red text for the entire row.
- R16. Errored tasks auto-expand their inline detail (R13) to show the `error_detail` field without the user needing to press Enter.

### Banner
- R3. The ASCII art banner is shown on startup, then collapses to a compact single-line header after 3 seconds or on the first keypress (whichever comes first). The collapsed state shows the same connection info (host + username) but in one line.

### Delete Confirmation
- R4. Pressing `d` on a non-completed task shows a "Press d again to delete" inline confirmation. A second `d` within 2 seconds executes the delete. Any other key cancels.
- R5. Pressing `d` on a completed task (status 5) deletes immediately with no confirmation.
- R6. Pressing `c` (clear all completed) shows the same double-press confirmation pattern.

### Status Messages
- R7. Success messages ("Task created", "Task paused", etc.) display for 3 seconds then auto-clear.
- R8. Error messages persist until the user takes any action (keypress) or until a success message replaces them.

### Busy Indicator
- R9. While an API action is in progress (`busy === true`), show a visual indicator (e.g., a spinner or "Working..." text) in the status area so the user knows the UI isn't frozen.

### Progress Display
- R18. Replace the plain percentage text ("45%") with a block-character progress bar followed by the percentage: `████░░░ 45%`. The bar fills proportionally within the progress column width.

### Empty State
- R17. When the task list is empty, show a centered ASCII art download icon with hint text "No downloads. Press n to add a URL." inside the table area instead of plain "No tasks found."

### Keyboard Hints
- R10. The create prompt should say "Ctrl+Enter" instead of "Option+Enter" — more universally supported across terminal emulators. Update the actual keybinding to match.

## Success Criteria

- A user with 30+ download tasks can navigate the full list with scrolling, Page Up/Down, and Home/End
- Accidental delete of an active download requires two deliberate keypresses
- Error messages are visible long enough to read (not cleared in <1 second)
- The TUI feels responsive during API operations (spinner visible)
- The task list works correctly on a 24-row terminal (banner collapses, list scrolls)

## Scope Boundaries

- Not redesigning the overall layout or adding new screens
- Not adding mouse support
- Not changing the column layout or responsive width logic (except the scrollbar track taking 1 column)
- Not adding sort/filter (separate feature)

## Key Decisions

- **Collapsible banner over removal**: The ASCII art provides brand identity; collapsing it preserves the first-impression while reclaiming space for daily use.
- **Double-press over modal confirmation**: Keeps the keyboard-driven flow uninterrupted. No mode switch needed.
- **Completed tasks skip confirmation**: They're already done — deleting them is housekeeping, not a destructive action.
- **Errors persist, success fades**: Errors need attention; success is just reassurance.

## Outstanding Questions

### Deferred to Planning
- [Affects R1, R12][Technical] Does OpenTUI 0.1.97 have a `<scrollbox>` or `scrollChildIntoView` component? The 0.1.88 release notes mentioned `scrollChildIntoView` on ScrollBox. Does it support a scrollbar track, or do we need to render one manually?
- [Affects R3][Technical] What's the cleanest way to animate the banner collapse — a timer in `useEffect` vs. a state transition on first keypress?
- [Affects R9][Technical] Does OpenTUI have a built-in spinner component, or do we need a frame-based animation with `setInterval`?

## Next Steps

-> `/ce:plan` for structured implementation planning
