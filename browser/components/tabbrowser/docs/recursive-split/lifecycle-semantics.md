# Code Context

## Files Retrieved
All source paths below are relative to `/Users/albertgwo/Repositories/firefox` unless absolute. Research only. No builds, tests, or Firefox runs.

1. `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (1–220, 1141–1178): project constraints and section 26 questions.
2. `browser/components/tabbrowser/content/tabsplitview.mjs` (1–548): wrapper membership, activation, removal, replacement, reversal, and close.
3. `browser/components/tabbrowser/Tabbrowser.sys.mjs` (1246–1295, 3358–3435, 3978–4115, 4408–4448, 6880–6963, 7673–7757, 7911–7943, 8116–8136, 8241–8324, 8388–8437, 8596–8617, 8640–8675, 8847–8858): lifecycle entry points.
4. `browser/components/tabbrowser/content/drag-and-drop.js` (90–110, 593–660, 2932–2933): wrapper drag and adoption.
5. `browser/components/tabbrowser/content/tab-context-menu.js` (1384–1426): split creation and separation commands.
6. `browser/components/extensions/parent/ext-tabs.js` (390–440, 579–590, 832–855, 1000–1004, 1130–1215, 1767–1825): extension remove/query/move/group handling.
7. `browser/components/extensions/parent/ext-browser.js` (920–923): membership getter.
8. `browser/components/extensions/parent/ext-windows.js` (280–310): moving splits into new windows.
9. `browser/components/extensions/schemas/tabs.json` (237–243, 870–875, 1795–1800): membership fields.
10. `toolkit/components/extensions/parent/ext-tabs-base.js` (630–660): query matching.
11. `browser/components/extensions/test/browser/browser_ext_tabs_splitViewId.js` (50–212): membership events and pair removal/move expectations.
12. `browser/components/extensions/test/browser/browser_ext_tabs_move_splitview.js` (35–63, 121–125, 207–588): pair-based move matrix.
13. `browser/components/extensions/test/browser/browser_ext_tabs_group_splitview.js` (35–39, 48–334, 349–416): pair-based grouping matrix.
14. `browser/components/sessionstore/SessionStore.sys.mjs` (3678–3772, 4233–4310): duplicate and undo-close.
15. `browser/components/sessionstore/TabState.sys.mjs` (191–192): membership serialization.
16. `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs` (638–682): recursive leaf removal algorithm.

## Key Code

- `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.#observeTabChanges` (143–184) already unsplits only when one tab remains. It removes empty wrappers. However, singleton detection additionally requires a mutation with exactly one removed node.
- `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.tabs` (197–199) derives live membership from DOM children. Activation, close, and panels instead use a separate `#tabs` array. **Critical:** the observer does not prune this array on member removal. N-pane removal must reconcile both representations before updating visibility or closing again.
- `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.close` (500–517) calls `gBrowser.removeTabs(this.#tabs)`; `unsplitTabs` (393–435) moves live children out and closes `about:opentabs` placeholders.
- `browser/components/tabbrowser/Tabbrowser.sys.mjs:addTabSplitView` (4020–4049) rejects zero tabs, not N tabs. `MozTabSplitViewWrapper.addTabs` (tabsplitview.mjs:337–385) loops arbitrary tabs but refuses pinned tabs.

## Architecture

Tabs remain ordinary Firefox tabs. The split wrapper owns tab-strip membership. Content panels remain accessed through each tab's `linkedPanel`. WebExtensions read membership from the wrapper. Normal move helpers promote a member to its whole wrapper. Membership changes travel through `TabMove` state snapshots. Sources: `browser/components/tabbrowser/Tabbrowser.sys.mjs:moveTabTo` (7911–7943), `#handleTabMove` (8305–8324), tab-state capture (8241–8271); `browser/components/extensions/parent/ext-browser.js:Tab.splitViewId` (920–923); `browser/components/extensions/parent/ext-tabs.js:onUpdated event handling` (422–434).

## Scout Target Answer

### Recommended lifecycle semantics

These are proposals, not existing tested behavior.

- **Close one leaf:** close only the requested tab. Remove its tree leaf after close succeeds. Promote its sibling subtree into the removed parent's position. Keep the split and ID at >=2 leaves. At one leaf, remove split chrome and wrapper. At zero, remove all split state. Do not alter stock close/beforeunload behavior. Existing singleton cleanup is in `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.#observeTabChanges` (143–184). Zen's sibling promotion is a useful algorithm reference: `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs:removeNode` (638–678).
- **Close multiple:** remove only successfully closed requested leaves, then normalize once. Do not derive collapse from one mutation record's removed-node count. Whole-split close remains explicit. Existing whole-split close: `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.close` (500–517). Extension batch removal groups requested tabs per window: `browser/components/extensions/parent/ext-tabs.js:tabs.remove` (832–855).
- **Undo close:** recommend stock ordinary-tab restoration for the first version. Do not silently splice a restored tab into a possibly changed tree. Existing `browser/components/sessionstore/SessionStore.sys.mjs:undoCloseTab` (4233–4310) creates an ordinary tab with group/container/pin metadata, then restores content; it has no explicit split-wrapper reconstruction in this function. `TabState.sys.mjs:collect` (191–192) does serialize splitViewId. Full downstream restore interaction is **UNVERIFIED** and needs a focused sessionstore pass before relying on this default.
- **Duplicate:** recommend duplicate only the focused/requested tab as an ordinary tab, preserving stock group/container behavior. `browser/components/tabbrowser/Tabbrowser.sys.mjs:duplicateTab` (8596–8608) delegates to SessionStore. `browser/components/sessionstore/SessionStore.sys.mjs:duplicateTab` (3678–3772) creates one tab, preserves userContextId and tabGroup, and clears pinned state. Collected state includes splitViewId; its downstream effect is **UNVERIFIED**. Explicitly exclude recursive layout from duplication unless a separate duplicate-split command is added.
- **Pin/unpin:** retain the ban on pinned split members. Pin one member should extract that leaf and pin that tab, preserving surviving split at >=2. Unpin should not rejoin automatically. Existing `browser/components/tabbrowser/Tabbrowser.sys.mjs:pinTab/unpinTab` (1246–1295) reparents a single tab. `content/tabsplitview.mjs:MozTabSplitViewWrapper.addTabs` (337–341) refuses pinned input. Audit move notifications because `#handleTabMove` (Tabbrowser.sys.mjs:8311–8317) snapshots every sibling even when callback moves one tab.
- **Move / move to new window / adopt:** preserve whole-wrapper movement for ordinary tab-strip and extension moves. Add leaf extraction only as an explicit pane command. `browser/components/tabbrowser/Tabbrowser.sys.mjs:moveTabTo` (7911–7913), `replaceTabWithWindow` (7673–7675), and `adoptSplitView` (4408–4445) already use wrapper movement. Adoption loops N tabs and preserves split ID; add tree transfer beside membership transfer. Adoption failure handling is a risk: this function dereferences the adopted tab without checking null, while `adoptTab` can return null (8388–8437).
- **Groups:** keep each split atomic in one tab group. Existing extension grouping deduplicates members into wrappers: `browser/components/extensions/parent/ext-tabs.js:getNativeTabsOrSplitViews` (579–581), group/ungroup calls (1767–1825). Keep this N-safe behavior. Do not allow a single split across groups.
- **Multiselect:** preserve wrapper-as-selection-unit for tab-strip actions, but explicit pane close should target one tab. Existing `browser/components/tabbrowser/Tabbrowser.sys.mjs:addToMultiSelectedTabs` (8646–8667) expands wrappers to children; `selectedElements` (8847–8858) deduplicates them back to wrappers. Test selectedTabs versus selectedElements callers rather than treating them as interchangeable.
- **Drag:** keep native tab-strip drag atomic. `browser/components/tabbrowser/content/drag-and-drop.js:handle_dragstart` (90–101) substitutes the wrapper; cross-window drop uses `adoptSplitView` (593–610). Pane rearrangement needs a separate tree operation, not ordinary tab drag semantics.
- **Discard:** preserve tree membership for discarded background leaves. Do not reload them merely because another member changes. `browser/components/tabbrowser/Tabbrowser.sys.mjs:explicitUnloadTabs` (6914–6930) avoids selecting sibling panes during unload. `#mayDiscardBrowser` (3358–3383) forbids selected tabs but has no explicit active-split sibling guard. Active visible nonselected panes therefore need policy review; behavior is **UNVERIFIED** without tests. Do not change global discard prefs.
- **Private windows:** prohibit cross-private-boundary adoption before mutating a tree. Existing private checks remain in `browser/components/tabbrowser/Tabbrowser.sys.mjs:swapBrowsersAndCloseOther` (7110–7111), `content/drag-and-drop.js:getDropEffectForTabDrag` (2932–2933), and `browser/components/sessionstore/SessionStore.sys.mjs:undoCloseTab` (4233–4250). Preflight all members, not just the focused leaf.
- **Containers:** keep identity per tab, not per split. `browser/components/tabbrowser/Tabbrowser.sys.mjs:adoptTab` (8425–8428) preserves usercontextid; `SessionStore.sys.mjs:duplicateTab` (3701–3712) preserves it too. `browser/components/extensions/parent/ext-windows.js:windows.create` (280–305) validates cookieStoreId against the requested tab before promoting to the wrapper. Mixed-container split plus explicit cookieStoreId needs a compatibility decision; validation of every promoted member is **UNVERIFIED**.

### Memory findings

- **Per split:** `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper` (42–55, 110–179) allocates a `#tabs` array, WeakMap, MutationObserver, and window TabSelect listener. Disconnect removes the listener and disconnects observation (137–149). Avoid adding per-leaf window listeners or timers.
- **Retention risk:** `MozTabSplitViewWrapper.#observeTabChanges` does not prune `#tabs`, while activation/close retain/use it (same file:143–184, 241–252, 500–517). N splits surviving leaf close can retain removed tab references. Fix this before scaling membership.
- **Transient allocations:** `MozTabSplitViewWrapper.tabs` creates and filters a fresh array on every access (same file:197–199). The observer invokes it repeatedly. Cache once per mutation batch, without creating another permanent ownership graph.
- **Per visible pane:** `browser/components/tabbrowser/Tabbrowser.sys.mjs:showSplitViewPanels` (4090–4104) eagerly inserts each browser, activates its docshell, and ensures footer chrome. Hidden/inactive layout metadata must not call this. Repeated activation can undo discard laziness unless filtered.
- **Shared task:** `browser/components/tabbrowser/content/tabsplitview.mjs:updateUrlbarButton` (7–30) allocates one DeferredTask at module evaluation. Actual startup import timing is **UNVERIFIED**. No per-pane timer is needed.
- **Window listeners:** `browser/components/tabbrowser/Tabbrowser.sys.mjs` initialization (262–263) registers split activate/deactivate listeners even without a split. Keep new recursive machinery lazy; do not add more baseline listeners.
- **Adoption:** `browser/components/tabbrowser/Tabbrowser.sys.mjs:adoptTab` (8388–8437) creates replacement tab/browser shells, preserves lazy-browser status and remote type, and swaps existing browsers. Do not replace adoption with URL reload or eager creation of every hidden leaf.
- **Placeholder browser:** `browser/components/tabbrowser/content/tab-context-menu.js:moveTabsToSplitView` (1398–1404) creates an `about:opentabs` tab for a single-tab split command. This costs a tab/browser; do not use placeholder tabs as tree-internal nodes.

## webextension-compatibility

### Guide section 26 answers

1. **Do internals require exactly two?** Some do. Wrapper creation/add/adoption loops accept N; reversal and extension move logic do not. `browser/components/tabbrowser/Tabbrowser.sys.mjs:addTabSplitView` (4020–4049), `adoptSplitView` (4408–4445); `content/tabsplitview.mjs:reverseTabs` (466–474); `browser/components/extensions/parent/ext-tabs.js:tabs.move` (1151–1176).
2. **Does schema require two?** No cardinality restriction is encoded in splitViewId fields. They are integer IDs >= -1. `browser/components/extensions/schemas/tabs.json:Tab.splitViewId` (237–243), query field (870–875), onUpdated field (1795–1800). Tests do assume pairs; see inventory below.
3. **Will query return N?** Source supports it naturally: `browser/components/extensions/parent/ext-tabs.js:tabs.query` (1000–1004) maps all matching wrappers; `toolkit/components/extensions/parent/ext-tabs-base.js:TabBase.matches` (638–660) compares splitViewId by equality. Runtime N behavior is **UNVERIFIED**.
4. **Do move/group operations assume pairs?** Move does: `browser/components/extensions/parent/ext-tabs.js:tabs.move` (1151–1176) chooses one `otherTabInSplit`, reverses pairs, or unsplits when explicit ordering separates the pair. Group uses whole-wrapper deduplication, not pair arithmetic: `getNativeTabsOrSplitViews` (579–581).
5. **Must tabs.remove change?** The API already removes requested IDs only (`ext-tabs.js:tabs.remove`, 832–855). Keep that surface; change underlying membership/tree cleanup. For N->N-1 with >=2, surviving tabs keep splitViewId and should not receive false membership updates. For 2->1, emit splitViewId=-1 on survivor. Existing event filtering compares old/new membership (`ext-tabs.js:onUpdated event handling`, 422–434).
6. **Destroy split or leaf?** Remove leaf only; retain ID at >=2; collapse at one. This extends the existing singleton rule (`content/tabsplitview.mjs:#observeTabChanges`, 173–181).

### Compatibility recommendation

Keep extension APIs membership-only. Do not add geometry fields or new permissions. Preserve one active tab. Preserve split ID during whole-wrapper adoption: `browser/components/extensions/parent/ext-tabs.js:onUpdated event handling` (427–433) intentionally suppresses intermediate adoption membership events. `browser/components/extensions/parent/ext-windows.js:windows.create` (303–308) moves the whole wrapper when tabId names one member.

For N-aware tabs.move, explicitly specify behavior before implementation: whole split moves by default; fully contiguous explicit member order may reorder leaves; requests interleaving unrelated tabs should separate the affected split rather than silently lose members. This is a proposal. Preserve existing two-tab results in `browser/components/extensions/test/browser/browser_ext_tabs_move_splitview.js:test move matrix` (207–588). Do not call pair-only reverseTabs on N members.

Suggested future coverage, not executed: N=3/4 remove single/batch, N->2->1, cancellation, pin extraction, duplicate/undo, adoption with background discarded leaves, mixed containers, private rejection, group one-member promotion, explicit N member move ordering, and event counts. Existing anchors: `browser_ext_tabs_splitViewId.js:test_existing_adjacent_tabs_in_splitview` (50–112), `browser_ext_tabs_move_splitview.js` (207–588), `browser_ext_tabs_group_splitview.js:test_tab_group_of_splitview` (48–334), all under `browser/components/extensions/test/browser/`.

## Gaps / Follow-up Scouts

- Focused SessionStore scout: trace #restoreTab and closed-set handling for stale splitViewId during undo/duplicate. Full end-to-end semantics are UNVERIFIED.
- Focused discard scout: trace automatic TabUnloader eligibility and inactive split activation. Visible sibling discard/reinsertion behavior is UNVERIFIED.
- Focused selection/close scout: inspect beforeunload cancellation and multiselected native close expansion. This pass did not fully trace removeTab/removeTabs internals.
- Startup module import timing and exact retained memory sizes are UNVERIFIED. No process or allocation measurements were allowed.
- Complete guide beyond the opening and section 26 was not read. No external documentation was used.

## Start Here

Open `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.#observeTabChanges` (143–184). Establish one coherent live membership/tree transaction before changing extension semantics. The stale #tabs risk affects memory and correctness.

## Open questions

- Should undo restore a leaf into its original surviving split, or remain stock ordinary-tab restore? Recommend ordinary restore initially; inspect `SessionStore.sys.mjs:undoCloseTab` (4233–4310) downstream path first.
- Should explicit extension member ordering modify tree leaf order or separate the split? Pair behavior currently mixes reversal and separation (`ext-tabs.js:tabs.move`, 1151–1176).
- How should windows.create(cookieStoreId, tabId) handle promoted mixed-container members? Current validation occurs before wrapper promotion (`ext-windows.js:windows.create`, 280–305).
- Should an explicitly discarded visible pane become an unloaded placeholder or require leaving that split? Existing activation eagerly inserts every browser (`Tabbrowser.sys.mjs:showSplitViewPanels`, 4090–4104).

## Exactly-two assumptions found in this area

This is an inventory of inspected code, not a claim of repository-wide completeness.

- `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper.reverseTabs` (466–474): destructures two tabs and replaces #tabs with only those two. Critical N-member loss.
- Same file: `resetRightPanelWidth` (320–325) addresses only panels[1].
- Same file: `#observeTabChanges` (173–181) describes closing “the other tab”; singleton cleanup is guarded by exactly one removed node. Final cardinality, not mutation size, must govern N cleanup.
- `browser/components/tabbrowser/Tabbrowser.sys.mjs:addTabSplitView` (4030–4034): telemetry captures only primary and secondary groups. Membership creation itself accepts N.
- `browser/components/extensions/parent/ext-tabs.js:tabs.move` (1151–1176): explicit “split view has 2 tabs” assumption; one other member; pair reversal/separation.
- `browser/components/extensions/test/browser/browser_ext_tabs_splitViewId.js:test_existing_adjacent_tabs_in_splitview` (99–109): removing one tab necessarily unsplits.
- Same test file: `test_move_another_tab_into_splitview` (122–151): explicitly says only two tabs can belong; moving into split does not add membership. Keep atomic tab-index movement policy distinct from new pane insertion.
- `browser/components/extensions/test/browser/browser_ext_tabs_move_splitview.js:createSplit helper` (45–47), matrix description (121–125), move cases (207–588): pair construction, pair reversal, and pair-separated ordering.
- `browser/components/extensions/test/browser/browser_ext_tabs_group_splitview.js:createSplit helper` (35–36), `test_tab_group_of_splitview` (131–213, 331–334), cross-window cases (370–415): two-member fixtures and pair result lists. Group helper itself is N-safe.
