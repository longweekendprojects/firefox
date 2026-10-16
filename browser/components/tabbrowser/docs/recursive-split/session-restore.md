# Code Context

## Files Retrieved
All Firefox paths below are relative to `/Users/albertgwo/Repositories/firefox`.

1. `browser/components/sessionstore/SessionStore.sys.mjs` (lines 675-705, 1370-1405, 2845-2875, 5620-5650, 5710-5940, 6310-6355, 6400-6535, 8800-8855). Collection, migration, lazy restore, and closed-group restoration.
2. `browser/components/sessionstore/TabState.sys.mjs` (lines 114-200). Tab membership serialization.
3. `browser/components/sessionstore/TabGroupState.sys.mjs` (lines 95-125, 145-165). Closed/saved group containers.
4. `browser/components/sessionstore/session.schema.json` (lines 250-285). Split record definition.
5. `browser/components/tabbrowser/Tabbrowser.sys.mjs` (lines 4080-4125, 4910-5148). Restore construction and browser insertion.
6. `browser/components/tabbrowser/content/tabsplitview.mjs` (lines 1-420, 440-500). State getter, activation, observer, width cache, reverse.
7. `browser/components/sessionstore/test/browser_splitview_integer_ids.js` (searched lines 12-173); `browser_splitview_string_migration.js` (searched lines 13-311); `browser_splitview_restore_in_closed_window.js` (searched lines 13-173).
8. `browser/components/sessionstore/test/marionette/test_splitview_restore.py` (lines 1-100; searched lines 108-182); `test_splitview_hidden.py` (searched lines 48-200).
9. `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs` (lines 2400-2510). Reference serializer.
10. `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (lines 1-220, 840-925; session-related headings searched). Read first; session guidance agrees with lazy metadata-first restoration.

## Key Code

- Native record is `{ id, numberOfTabs }`. It has no tree, ratios, or focused leaf. Source: `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.state`, lines 81-86; `browser/components/sessionstore/session.schema.json:definitions.splitview`, lines 257-269.
- Each tab stores `splitViewId`, not a persistent leaf identity. Source: `browser/components/sessionstore/TabState.sys.mjs:#collectBaseTabData`, lines 191-193.
- Window collection stores `splitView.state` once per wrapper. Window `selected` is the one-based selected tab position. Source: `browser/components/sessionstore/SessionStore.sys.mjs:#collectWindowData`, lines 5636-5650.
- Closed/saved groups carry `splitViews`; a transient Map deduplicates by split ID. Source: `browser/components/sessionstore/SessionStore.sys.mjs:#collectSplitViewDataForTabGroup`, lines 2861-2870. `browser/components/sessionstore/TabGroupState.sys.mjs:closed`, lines 109-115, and `savedInClosedWindow`, lines 153-160, initialize these lists.

## Architecture

### Restore and lazy tabs

`SessionStore.#restoreWindow` computes laziness from existing `sessionstore.restore_tabs_lazily` and restore-on-demand settings, then calls `gBrowser.createTabsForSessionRestore` with tabs, groups, and split records. Do not change these prefs. Source: `browser/components/sessionstore/SessionStore.sys.mjs:#restoreWindow`, lines 5881-5896.

The constructor builds temporary Maps and document fragments. A browser is lazy when restore is lazy, the tab is not selected, and it is not pinned. This stock exception must remain. Source: `browser/components/tabbrowser/Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 4947-5039.

It collects split members from tab `splitViewId` values. It creates the wrapper only when collected count equals saved `numberOfTabs`. Finally it calls `addTabs(..., { isSessionRestore: true })`. Source: `browser/components/tabbrowser/Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 5043-5052, 5118-5123.

**Important corruption hazard:** members of an incomplete split are not appended as ordinary tabs in this loop. No wrapper exists until the exact count is met. A stale count can therefore strand restored tabs outside the inserted DOM. This is a static code-path finding, not a reproduced failure. Source: same function, lines 5066-5100, 5118-5123.

An inactive restored wrapper does not call activation from `addTabs`. An active wrapper does. Source: `browser/components/tabbrowser/content/tabsplitview.mjs:addTabs`, lines 333-359. Activation calls `showSplitViewPanels`, which inserts each browser, creates its footer if absent, and sets `docShellIsActive`. Source: `tabsplitview.mjs:#activate`, lines 238-246; `browser/components/tabbrowser/Tabbrowser.sys.mjs:showSplitViewPanels`, lines 4090-4118.

SessionStore receives `TabSplitViewActivate` and restores content for every event member. `#restoreTab` also treats all members of the selected split as immediate restoration candidates. Source: `browser/components/sessionstore/SessionStore.sys.mjs:handleEvent`, lines 1393-1398; `#restoreTab`, lines 6324-6327. Detached lazy browsers instead receive `TAB_LAZY_STATES`; connected browsers receive restore history and may enter the normal queue. Source: `SessionStore.sys.mjs:#restoreTab`, lines 6418-6485.

### IDs and migration

The split counter is session-global. `getNextSplitViewId` increments it and guards the safe-integer limit. Source: `browser/components/sessionstore/SessionStore.sys.mjs:getNextSplitViewId`, lines 403-408.

Startup initializes IDs before deferred-session processing. Explicit state restoration also initializes IDs. Source: `SessionStore.sys.mjs:#initSession`, lines 688-689; explicit restore entry near lines 3395-3397.

`#initSplitViewIds` covers deferred initial state, last session state, and current state. `#migrateSplitViewIds` covers open and closed windows, maps non-number tab membership IDs, and updates matching window split records. A numeric `maxSplitViewId` bypasses migration entirely. Source: `SessionStore.sys.mjs:#initSplitViewIds`, lines 5710-5732; `#migrateSplitViewIds`, lines 5741-5793.

Do not reuse this migration as tree validation. It does not walk closed/saved group split records or establish leaf IDs in the inspected implementation. Numeric membership IDs are accepted without a safe-integer check there. Source: `SessionStore.sys.mjs:#migrateSplitViewIds`, lines 5750-5793.

### Closed windows and recovery

Closed/saved group restore reuses `createTabsForSessionRestore(true, 0, ..., splitViews)` and then `#restoreTabs`. Extend the shared constructor rather than add another restore engine. Source: `browser/components/sessionstore/SessionStore.sys.mjs:#createTabsForSavedOrClosedTabGroup`, lines 8830-8843.

Closed-window split membership and preserved IDs have dedicated coverage. Group reopening from a closed window is also covered. Source: `browser/components/sessionstore/test/browser_splitview_restore_in_closed_window.js:test_restoreSplitViewInClosedWindow`, lines 13-54, and following task, lines 60-173.

Browser crash events still route to native `#onBrowserCrashed`; inserted-browser restore marks `TAB_STATE_NEEDS_RESTORE` specifically to handle crashes while restoring. Keep layout metadata independent of content actors. Source: `browser/components/sessionstore/SessionStore.sys.mjs:handleEvent`, lines 1399-1403; `#restoreTab`, lines 6424-6427. Full application crash/recovery-file flow and split-specific crash tests are **UNVERIFIED** in this pass.

### Memory findings

- Native split wrapper allocates a tab array and WeakMap; connected wrappers add one window TabSelect listener and a MutationObserver. Disconnect removes the listener and disconnects the observer. Source: `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper` fields, lines 43-55; `connectedCallback`, lines 109-118; `disconnectedCallback`, lines 137-148; `#observeTabChanges`, lines 150-185.
- Module evaluation allocates one shared DeferredTask, even before a wrapper is instantiated if this module is loaded. Exact startup import timing is **UNVERIFIED**. Source: `tabsplitview.mjs:updateUrlbarButton`, lines 7-30.
- Every `tabs` getter creates a temporary array; `state` creates a fresh object. Source: `tabsplitview.mjs:tabs`, lines 198-200; `state`, lines 81-86.
- Restore allocates temporary per-window Maps and per-split member arrays, plus fragments. Source: `Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 4947-4969.
- Showing a split inserts all member browsers and creates one footer per shown pane. This is the major memory multiplier. Inactive metadata restoration should never call this path. Source: `Tabbrowser.sys.mjs:showSplitViewPanels`, lines 4090-4118.
- Native window serialization creates an empty splitViews array even with no splits. Do not add parallel per-window registries, per-tab tree copies, observers, or timers. Source: `SessionStore.sys.mjs:#collectWindowData`, lines 5636-5640. Recommendation, not measured memory evidence.

## Scout Target Answer

### Recommended minimal extension

Extend native split records, not window custom-value JSON strings or a second session service. Proposed shape:

```json
{"id":42,"numberOfTabs":3,"layout":{"version":1,"focusedLeaf":2,"root":{"axis":"horizontal","ratio":0.6,"first":{"leaf":1},"second":{"axis":"vertical","ratio":0.5,"first":{"leaf":2},"second":{"leaf":3}}}}}
```

Add an optional split-local `splitLeafId` to each member tab's native TabState. Allocate it only for split tabs. IDs should survive tree rearrangement; avoid DOM tab IDs or absolute window positions. Keep one canonical live tree per wrapper. Serialize a fresh plain tree only during existing collection. These are design recommendations anchored at `TabState.sys.mjs:#collectBaseTabData`, lines 191-193, and `tabsplitview.mjs:state`, lines 81-86.

Carry the same record through existing window and closed/saved group arrays. Update the split-state typedef and schema, and add the optional tab field to schema. The current split schema does not constrain extra properties and has no bounds for numberOfTabs; runtime validation is still essential. Source: `session.schema.json:definitions.splitview`, lines 257-269; `SessionStore.sys.mjs:#collectSplitViewDataForTabGroup`, lines 2861-2870.

Before DOM placement, reconcile actual membership against records in `createTabsForSessionRestore`. Do not gate placement on an untrusted saved count. Validate bounded depth/node count, known version, finite bounded ratio, valid axis, unique leaf IDs, and membership in this split/window/group. Prune missing leaves and collapse unary branches. Reject duplicates. If fewer than two members survive, restore ordinary tabs. For corrupt/unknown-version trees, restore all tabs normally or use a deterministic balanced layout of actual members. No layout error should abort tab history restoration. This is a recommendation for the hazard at `Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 5043-5100.

For legacy records without layout, assign split-local IDs in actual restored tab order and synthesize the existing two-pane layout. Do not change split ID counter migration. Source integration points: `Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 4962-4969; `SessionStore.sys.mjs:#migrateSplitViewIds`, lines 5741-5793.

Use window `selected` as canonical focus when it belongs to the active split. Store focusedLeaf to remember an inactive split's last focused pane; never let it steal startup selection from another tab. Fallback to a surviving leaf. Source integration points: `SessionStore.sys.mjs:#collectWindowData`, lines 5642-5650; `tabsplitview.mjs:on_TabSelect`, lines 482-495.

Keep tree restoration metadata-only. Reuse native activation to insert browsers only when shown. Do not fetch contentWindow, create pane chrome, or insert browsers during validation. Preserve existing pinned/restore-on-demand policy. Source integration points: `Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 5003-5039; `showSplitViewPanels`, lines 4090-4118; `SessionStore.sys.mjs:handleEvent`, lines 1393-1398.

New ratio/tree changes need existing delayed SessionStore saving. Current events save on creation/removal/activation, not a dedicated layout mutation. Add one split-scoped layout-change notification handled by existing save scheduling; no timer per divider. Source: `SessionStore.sys.mjs:handleEvent`, lines 1383-1398.

Zen is algorithm reference only. Its serializer stores DOM tab IDs and recursive node sizes. Its restorer prunes absent DOM leaves and catches errors per group, but inspected code has no version/depth/ratio validation or unary-collapse guarantee. Do not copy it as the persistence contract. Source: `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs:storeDataForSessionStore`, lines 2418-2445; `restoreDataFromSessionStore`, lines 2449-2507.

### Coverage to extend, not execute here

Existing tests cover integer ID sequencing/persistence, string migration including closed windows, closed-window/group reopening, graceful quit/restart, last-window close, hidden splits, and collapsed groups. Sources: the test functions listed in Files Retrieved; `test_splitview_restore.py:TestAutoRestoreWithSplitView`, lines 45-182; `test_splitview_hidden.py:test_splitview_no_hidden_tabs`, line 48, `test_splitview_both_hidden`, line 92, `test_splitview_in_collapsed_group_is_not_hidden`, line 153.

Add eventual coverage for recursive round-trip, ratios, focus, legacy data, missing/duplicate tabs, invalid counts, excessive depth, unknown versions, closed groups/windows, inactive six-pane laziness, activation loading only shown leaves, and crash during restoration. No tests were run.

## Gaps / Follow-up Scouts

- Full crash recovery and deferred/pinned-state partitioning need focused follow-up. Their preservation of new optional fields is **UNVERIFIED**.
- Individual undo-close-tab behavior is **UNVERIFIED**; determine whether it should rejoin a still-existing recursive split.
- Confirm schema enforcement and tab additional-property restrictions before implementation.
- Confirm tree/ratio change notification integration with splitter-owner code.
- No runtime or memory measurements were permitted. No builds, tests, Firefox, or mach were run.

## Start Here

Open `browser/components/tabbrowser/Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 4940-5123. Fix defensive member placement there before adding tree metadata.

## Open questions

- Should undo-close restore a pruned leaf at its former location, or as an ordinary tab?
- Should invalid tree data discard only the tree or the entire split grouping?
- Are hidden leaves ever part of a shown split? If so, activation must filter visible leaves rather than blindly activate every member.
- Should deferred restore preserve inactive focus independently of selected window tab?

## Exactly-two assumptions found in this area

- `browser/components/tabbrowser/content/tabsplitview.mjs:reverseTabs`, lines 446-456, destructures exactly two tabs and replaces the internal array with those two.
- `tabsplitview.mjs:resetRightPanelWidth`, lines 317-322, hardcodes panel index 1.
- `tabsplitview.mjs:#observeTabChanges`, lines 174-180, describes the surviving tab as the result of closing “the other tab.” The length-one unsplit policy itself remains sensible for N panes.
- `tabsplitview.mjs:addTabs`, lines 365-368, labels telemetry indexes using left/right 1/2 semantics. N-index telemetry compatibility is **UNVERIFIED**.
- `browser/components/sessionstore/test/browser_splitview_restore_in_closed_window.js:test_restoreSplitViewInClosedWindow`, lines 17-48, and group task, lines 69-73, 166-168, create/assert two members.
- `browser/components/sessionstore/test/browser_splitview_integer_ids.js` tasks at lines 12, 63, 117 use paired memberships; `browser_splitview_string_migration.js` tasks at lines 13, 139, 249 likewise use paired memberships.
- `browser/components/sessionstore/test/marionette/test_splitview_restore.py:test_splitview_restored_after_quit`, lines 52-78; `test_splitview_restored_multiple_after_quit`, lines 86-135; `test_splitview_restored_after_closing_last_window`, lines 142-182, use/assert two-tab splits.
- `browser/components/sessionstore/test/marionette/test_splitview_hidden.py:test_splitview_both_hidden`, lines 92-150, defines hiding semantics around both members.
- Native serialized count and restore member collector are count-based, not intrinsically two-only. Source: `tabsplitview.mjs:state`, lines 81-86; `Tabbrowser.sys.mjs:createTabsForSessionRestore`, lines 5043-5052. This list is exhaustive only for inspected session-related code, not the whole tabbrowser subsystem.
