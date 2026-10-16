# Performance and memory baseline

Measured on an artifact build of Firefox 157.0.1 in headless browser-chrome tests.

## Visibility (four panes, stock activation path)

Every pane reported `visibilityState == "visible"`, an active docshell, and about 32 animation frames in 500 ms.
Changing the selected pane did not hide any other pane.
No Gecko or activation patch was needed.

## Memory added by the split view code

- No split view: the layout model and pane renderer are not loaded. No listeners, observers, timers, or DOM are added.
- Active split: one tabs progress listener, one ResizeObserver, one splitter container per window; one header per visible pane; one splitter per split.
- Leaving or closing the split removes all of it.
- `browser_tab_splitview_recursive.js` checks that every header, splitter, and wrapper from five split cycles is garbage collected.

Parent-process heap comparisons were too noisy to use as a gate: plain tab switching alone varied by 14 to 17 MB over 20 cycles.
The weak-reference check replaces them.

## Upstream leaks fixed where we touch them

- The wrapper kept references to tabs that had left it. It now drops them.
- Split view footers stayed attached after a split closed. Pane headers replace them and are removed with the split.

## Behavior kept from upstream

Visible panes stay fully live, as in native two-pane Split View.
Visible panes are protected from automatic tab unloading, like the selected tab.
Inactive splits keep their tabs lazy until shown.
