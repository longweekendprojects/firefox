# Recursive Split View: architecture

This fork generalizes Firefox's native two-tab Split View into a recursive pane tree.
Everything outside an active split stays stock Firefox.
The research notes in this directory back each decision with source citations.

## Decisions

### 1. One native split, one layout tree

A recursive split stays one native `tab-split-view-wrapper` with N flat member tabs.
A separate layout tree describes geometry only.
Reason: the wrapper, `splitViewId`, `gBrowser.splitViewBrowsers`, and the tab switcher are already list-based (see firefox-source-map.md).
Falsified if: native tab-strip, move, or group code breaks with more than two wrapper children in ways that need broad patches.

### 2. Flat browser panels with computed geometry

Browser panels stay direct children of `tabpanels`.
The renderer sets each active panel's position from the tree's rectangles.
Reason: deck selection, `getRelatedElement`, and `xul.css` visibility rules all expect direct children.
Falsified if: absolute positioning breaks dialogs, fullscreen, find bar, or notification boxes in ways CSS cannot fix.

### 3. Activation reuses the native path

`showSplitViewPanels` already activates every member browser.
`AsyncTabSwitcher.shouldDeactivateDocShell` already exempts every split browser.
We add no activation patch.
Falsified if: the N-browser spike shows a visible pane reports `document.hidden` or gets deactivated.

### 4. Exactly one selected tab

The focused pane is `gBrowser.selectedTab`.
The global toolbar keeps tracking it.

### 5. Removing a pane removes one leaf

Closing a member tab prunes its leaf and promotes the sibling subtree.
The split survives at two or more tabs and unsplits at one.

### 6. Session layout extends the native split record

The tree is stored inside the native split record as an optional, versioned `layout` field.
Leaves refer to member positions, not DOM ids.
Invalid layout data falls back to a default layout and never blocks tab restore.

## Memory rules

The split code must add near-zero memory, both with and without an active split.

- No new module loads, listeners, timers, observers, or DOM until the first split exists in a window.
- The layout model is plain data: one small object per node, no parent pointers, no cached rectangles.
- Pane chrome exists only for panes of the active split. It is removed when the split is suspended or closed.
- One tabs progress listener per window serves every pane, attached only while a split is active.
- Pane events are delegated at the panel container; there are no per-pane closures.
- The URL-or-search helper loads only when the user presses Enter.
- Inactive splits keep pending tabs lazy. Only the shown split materializes browsers.
- Existing upstream leaks found in research are fixed where we touch them: the wrapper's stale private tab list, and footers that outlive the split.
- Every rule is checked with an `about:memory` comparison and a repeated open/close leak check.

## Module layout

- `browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs`: pure tree operations, geometry, directional focus, and serialization. No DOM.
- Later: a renderer and pane chrome loaded lazily from the wrapper.
- Upstream files get small hooks only.

## Machine safety

- Artifact build, capped at 8 jobs, run at low priority.
- One agent builds or runs Firefox at a time, on a dedicated dev profile.
- Firefox runs under `tasks/run-guarded.sh`, which kills the process tree on timeout or on process-count or memory caps.
- Tests run one file at a time.
