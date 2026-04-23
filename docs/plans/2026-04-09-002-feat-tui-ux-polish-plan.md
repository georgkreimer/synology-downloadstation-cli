---
title: "feat: TUI UX polish"
type: feat
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-tui-ux-polish-requirements.md
---

# feat: TUI UX Polish

## Overview

Comprehensive UX overhaul addressing 18 requirements across scrolling, navigation, confirmations, feedback, visual polish, and error handling. The primary goal is making the TUI usable with 30+ tasks — currently the list overflows with no scrolling. Secondary goals add safety (delete confirmation), feedback (status message timing, busy spinner), and polish (progress bar, collapsible banner, empty state, inline detail view).

(see origin: `docs/brainstorms/2026-04-09-tui-ux-polish-requirements.md`)

## Technical Findings

### OpenTUI 0.1.97 APIs Available

**`<scrollbox>`** — scrollable container with built-in scrollbar:
- Props: `scrollY`, `scrollX`, `scrollbarOptions` (track/thumb colors via `foregroundColor`/`backgroundColor` on `trackOptions`), `viewportCulling` (only renders visible children), `stickyScroll`/`stickyStart`
- Methods via ref (`ScrollBoxRenderable`): `scrollChildIntoView(childId: string)`, `scrollBy(delta, unit: "absolute"|"viewport"|"content"|"step")`, `scrollTo(position)`
- Children must have `id` prop for `scrollChildIntoView` to find them
- `viewport.height` property gives visible area height for page-size calculations
- Hierarchy: root > wrapper > viewport (clipping box) > content > [children]

**`<ascii-font>`** — ASCII art text renderer. Props: `text`, `font` ("tiny"/"block"/"slick"/"shade"), `color`.

**`useKeyboard`** — already supports key names `pageup`, `pagedown`, `home`, `end`, `return`. KeyEvent has `name`, `ctrl`, `meta`, `shift`, `option`, `repeated` properties.

**No built-in spinner** — need a simple `setInterval` cycling through frame characters.

### Best Practices (from research)

- **Selection tracking:** Identity-based (by task ID) is the standard for auto-refreshing lists. Bubbletea, lazygit, and Textual all recommend storing selected item ID and resolving index after refresh. Fallback to index clamping only when the selected item disappears.
- **Page Up/Down:** Convention A ("cursor moves with page") is the strong consensus for TUI lists — selection moves by `viewportHeight` items, clamped to bounds. No overlap needed (unlike text paging).
- **Scrollbar characters:** `█` (thumb) and `░` (track) is the most common default. Show only when content exceeds viewport. OpenTUI handles this natively via `<scrollbox>` scrollbar.
- **Inline expansion:** Track `expandedTaskId` in state. Expanded task renders extra rows below the main row. Collapse on selection change. The scroll math must account for extra rows — `scrollChildIntoView` handles this since it works on the rendered DOM, not the task count.

### Current State (App.tsx)

- Selection: index-based (`selectedIndex: number`, line 97)
- Task list: plain `<box>` children, no scroll container (lines 399-425)
- Delete: immediate, no confirmation (lines 292-295)
- Status messages: replaced on every action, no auto-clear timer
- Banner: always visible, 6 lines + padding (lines 11-18, 382-386)
- Empty state: `<text>No tasks found.</text>` (line 405)
- Progress: `formatPercent(progress)` returns "45%" text (line 471)

## Scope Boundaries

- Not redesigning the overall layout or adding new screens (see origin)
- Not adding mouse support (see origin)
- Not changing the column layout or responsive width logic (except scrollbar track taking 1 column) (see origin)
- Not adding sort/filter (see origin)

## Implementation Units

### Unit 1: Add theme colors for new features

- **Goal:** Extend `theme.ts` with colors for error tasks, progress bar, scrollbar, spinner, and empty state
- **Files:** `src/tui/theme.ts`
- **Approach:** Add `status.error` (red), `progressBar.fill` / `progressBar.track`, `scrollbar.thumb` / `scrollbar.track`, and `emptyState` to the theme object.
- **Verification:** `bunx tsc --noEmit` passes

### Unit 2: Selection by task ID instead of index

- **Goal:** R2 — selection tracks by task ID so it survives auto-refresh reordering
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Replace `selectedIndex: number` with `selectedId: string | null`
  - Compute `selectedIndex` as a derived value: `tasks.findIndex(t => t.id === selectedId)`
  - `handleMove(delta)` computes the new index from current position, then sets `selectedId` to `tasks[newIndex].id`
  - When tasks refresh and `selectedId` is no longer in the list, fall back to nearest index or first task
- **Patterns to follow:** Current `selectionClamped` memo pattern (line 245)
- **Verification:** Selection stays on the same task after a refresh adds/removes tasks

### Unit 3: Scrollable task list with scrollbar

- **Goal:** R1, R11, R12 — scrollable list with page navigation and scrollbar track
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Replace the inner `<box>` table container (line 400) with `<scrollbox scrollY viewportCulling ref={scrollBoxRef}>`
  - Import `ScrollBoxRenderable` from `@opentui/core`; add `scrollBoxRef = useRef<ScrollBoxRenderable>(null)`
  - Each task row's `<box>` gets `id={task.id}` so `scrollChildIntoView` can find it
  - After selection changes (in `handleMove` and page nav), call `scrollBoxRef.current?.scrollChildIntoView(selectedId)` in a `useEffect` that depends on `selectedId`
  - Configure scrollbar: `verticalScrollbarOptions={{ trackOptions: { foregroundColor: theme.scrollbar.thumb, backgroundColor: theme.scrollbar.track } }}`
  - The header row (`formatHeader`) stays **outside** the scrollbox as a fixed header above it
  - Page navigation: `pageup`/`pagedown` move selection by `Math.floor(scrollBoxRef.current?.viewport.height ?? 10)` rows, clamped. `home` = first, `end` = last. All via `handleMove` with appropriate delta.
  - Enable `viewportCulling` for performance with large lists
- **Patterns to follow:** OpenTUI `ScrollBoxRenderable` API; bubbletea Convention A (cursor moves with page)
- **Verification:** 30+ tasks are navigable; scrollbar track visible on right edge; Page Up/Down/Home/End work; viewport culling active

### Unit 4: Collapsible banner

- **Goal:** R3 — banner collapses after 3s or first keypress
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Add `bannerExpanded: boolean` state, initialized `true`
  - `useEffect` starts a 3-second `setTimeout` that sets it `false`. Cleanup clears the timer.
  - In the `useKeyboard` handler, on any keypress while `bannerExpanded` is true, set `bannerExpanded = false` (before processing the key)
  - When collapsed, render a single-line header: `"SYNOLOGY DS — Connected to {host} as {username}"` with `theme.banner` color
  - When expanded, render the current BANNER array + connection info (as-is)
- **Verification:** Banner collapses after 3s; any keypress before 3s also collapses; collapsed state shows connection info on one line

### Unit 5: Delete confirmation (double-press)

- **Goal:** R4, R5, R6 — double-press `d` for active tasks, immediate for completed; double-press `c` for clear
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Add `pendingConfirm: { action: "delete" | "clear"; taskId?: string; timer: ReturnType<typeof setTimeout> } | null` state
  - On `d` press: if task status === 5 (completed), delete immediately. Otherwise, if no pending confirm, set `pendingConfirm` with a 2-second timer that auto-clears it and show "Press d again to delete [title]" via `setInfo`. If `pendingConfirm` already matches, execute the delete and clear the confirm state.
  - On `c` press: same double-press pattern — first press shows "Press c again to clear completed", second executes
  - Any other key cancels the pending confirm (clear state + timer)
- **Verification:** Active task requires two `d` presses within 2s; completed task deletes on first `d`; `c` requires double-press; any other key cancels

### Unit 6: Status message timing

- **Goal:** R7, R8 — success fades after 3s, errors persist until next action
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Add a `statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)`
  - `setSuccess`: after setting status, start a 3-second timer that clears it. Cancel any existing timer first.
  - `setError`: set status with no timer (errors persist). Cancel any existing success timer.
  - `setInfo`: same as success (3-second fade)
  - In `useKeyboard`, if `status?.tone === "error"`, clear it on any keypress
  - Cleanup: `useEffect` return clears the timer
- **Verification:** Success message visible for ~3s then clears; error message stays until keypress

### Unit 7: Busy spinner

- **Goal:** R9 — visual indicator during API operations
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Add `spinnerFrame: number` state
  - When `busy` is true, start a `setInterval` (80ms) cycling through frames `["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]` (braille spinner)
  - Render the spinner character in the status area (where status messages appear) with `theme.muted` color, followed by "Working..."
  - When `busy` becomes false, clear the interval
- **Verification:** Spinner visible during pause/resume/delete/create operations; disappears when done

### Unit 8: Inline task detail expansion

- **Goal:** R13, R14 — press Enter to expand task details inline
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Add `expandedTaskId: string | null` state
  - On `return` key (when not in create prompt), toggle `expandedTaskId` for the selected task
  - When a task is expanded, render 2-3 additional lines below its row inside the same parent `<box>`:
    - Line 1: Source URL (`task.additional?.detail?.uri`)
    - Line 2: Created/Started/Completed timestamps (formatted from `task.additional?.detail`)
    - Line 3: Downloaded pieces (`task.additional?.transfer?.downloaded_pieces`) + error detail if present
  - Collapse on selection move (up/down/pageup/pagedown/home/end) or Esc
  - Only one task expanded at a time
- **Verification:** Enter toggles detail; moving collapses; detail shows URL, timestamps, pieces

### Unit 9: Error task styling and auto-expansion

- **Goal:** R15, R16 — error tasks render red, auto-expand detail
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - In `getStatusColor()`, add a case: if `status >= 101`, return `theme.status.error` (red)
  - In `renderRow()`, when `task.status >= 101`, apply red fg to all segments (not just the status column)
  - Error tasks auto-expand: in the render loop, if `task.status >= 101`, render the detail lines (same as Unit 8) regardless of `expandedTaskId`. This means error tasks always show their `error_detail`.
- **Verification:** Error tasks are red; their detail is always visible showing error_detail

### Unit 10: Progress bar

- **Goal:** R18 — block-character progress bar instead of plain percentage
- **Files:** `src/utils/formatting.ts`, `src/tui/App.tsx`
- **Approach:**
  - Add `formatProgressBar(percent: number | undefined, width: number): string` to `formatting.ts`
  - Given width (from column widths), compute filled = `Math.round((percent / 100) * barWidth)`, remainder is track
  - Use `\u2588` (full block) for filled, `\u2591` (light shade) for track
  - Append ` {percent}%` after the bar if space allows
  - If percent is undefined, return `"-"` padded to width
  - Replace `formatPercent(progress).padEnd(widths.progress)` in `renderRow` with `formatProgressBar(progress, widths.progress)`
- **Verification:** Progress column shows `████░░░ 45%`; undefined shows "-"

### Unit 11: Empty state

- **Goal:** R17 — centered ASCII art + hint when no tasks
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Replace `<text>No tasks found.</text>` with a centered box containing:
    - A small ASCII art download arrow (3-4 lines, manually drawn)
    - Text: "No downloads. Press n to add a URL." in `theme.muted`
  - Use `<box alignItems="center" justifyContent="center" flexGrow={1}>`
- **Verification:** Empty state shows icon + hint centered in the table area

### Unit 12: Keyboard hints update

- **Goal:** R10 — Ctrl+Enter instead of Option+Enter for create submission
- **Files:** `src/tui/App.tsx`
- **Approach:**
  - Update the keybinding check (line 334): currently `key.ctrl || key.meta || key.option` — keep `ctrl` and `meta`, remove `option` to avoid conflict
  - Update the hint text (line 439): "Press Ctrl+Enter to create or Esc to cancel."
  - Update the footer instructions string to mention Enter for details: add `enter detail` to the key legend
  - Update keyboard hints for Page Up/Down/Home/End if space allows
- **Verification:** Ctrl+Enter submits URLs; hint text says "Ctrl+Enter"

## Acceptance Criteria

- [ ] R1: Task list scrolls when tasks exceed visible area; selected row always visible
- [ ] R2: Selection tracks by task ID; survives auto-refresh
- [ ] R3: Banner collapses after 3s or first keypress to single-line header
- [ ] R4: `d` on non-completed task requires double-press within 2s
- [ ] R5: `d` on completed task deletes immediately
- [ ] R6: `c` requires double-press confirmation
- [ ] R7: Success messages auto-clear after 3s
- [ ] R8: Error messages persist until next keypress
- [ ] R9: Spinner visible during API operations
- [ ] R10: Create prompt says "Ctrl+Enter"; keybinding matches
- [ ] R11: Page Up/Down jump by screenful; Home/End jump to first/last
- [ ] R12: Scrollbar track visible on right edge when list is scrollable
- [ ] R13: Enter expands task inline with URL, timestamps, pieces, error detail
- [ ] R14: Detail collapses on selection move or Esc
- [ ] R15: Error tasks render with red text
- [ ] R16: Error tasks auto-expand to show error_detail
- [ ] R17: Empty state shows centered ASCII art + hint
- [ ] R18: Progress column shows block-character bar

## Dependencies & Risks

- **OpenTUI `<scrollbox>` behavior:** The `scrollChildIntoView` API is documented but we haven't used it before. If it doesn't work as expected, fallback is manual `scrollTo` based on row height calculations.
- **Braille spinner characters:** May not render in all terminal fonts. Fallback: simple ASCII frames `["|", "/", "-", "\\"]`.
- **Progress bar column width:** The block chars + percentage need enough horizontal space. At `COLUMN_ABSOLUTE_MIN.progress = 6`, there's barely room. May need to increase the minimum or show only the bar without percentage at narrow widths.

## Sources

- **Origin document:** [docs/brainstorms/2026-04-09-tui-ux-polish-requirements.md](../brainstorms/2026-04-09-tui-ux-polish-requirements.md) — key decisions: collapsible banner, double-press delete, errors persist / success fades, inline detail expansion, block-character progress bar
- ScrollBox API: `node_modules/@opentui/core/renderables/ScrollBox.d.ts`
- ScrollBar API: `node_modules/@opentui/core/renderables/ScrollBar.d.ts`
- KeyEvent type: `node_modules/@opentui/core/lib/KeyHandler.d.ts`
- ASCIIFont component: `node_modules/@opentui/core/renderables/ASCIIFont.d.ts`
- Current App.tsx: `src/tui/App.tsx` (all line references above)
- Theme: `src/tui/theme.ts`
- Formatting utils: `src/utils/formatting.ts`
