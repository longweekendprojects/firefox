# Code Context

## Files Retrieved
Paths below are relative to `/Users/albertgwo/Repositories/firefox`, except the guide and Zen reference.

1. `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (1–180, 780–835) — principles and visibility expectations. Read these sections first; the full guide was not retrieved.
2. `browser/components/tabbrowser/Tabbrowser.sys.mjs` (470–505, 625–645, 790–825, 3285–3445, 4080–4135, 8970–9030, 9230–9280, 9310–9340) — activation, insertion, discard, selected browsers.
3. `browser/components/tabbrowser/AsyncTabSwitcher.sys.mjs` (1–95, 260–305, 640–775, 850–885, 925–955) — layer state and split exemptions.
4. `browser/components/tabbrowser/content/tabsplitview.mjs` (1–330, 475–500) — split lifetime and suspension.
5. `toolkit/content/widgets/tabbox.js` (530–625) — panel visibility and listeners.
6. `toolkit/content/widgets/browser-custom-element.mjs` (515–562) — activation/render setters.
7. `docshell/base/BrowsingContext.cpp` (3189–3255, 3330–3365), `docshell/base/nsDocShell.cpp` (4700–4765) — cross-process activation propagation.
8. `dom/base/Document.cpp` (17572–17588), `dom/base/nsGlobalWindowOuter.cpp` (6599–6655), `dom/base/TimeoutManager.cpp` (200–230), `layout/base/PresShell.cpp` (11915–11965) — visibility and scheduling.
9. `dom/media/mediaelement/HTMLMediaElement.cpp` (7488–7525), `dom/media/autoplay/AutoplayPolicy.cpp` (80–110) — playback and autoplay distinction.
10. `browser/components/tabbrowser/TabUnloader.sys.mjs` (1–180) — unload scoring and process enumeration.
11. `browser/components/tabbrowser/NewTabPagePreloading.sys.mjs` (100–165), `browser/components/tabbrowser/content/split-view-footer.js` (1–95, search hits 195–221) — retained browsers and chrome costs.
12. `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs` (1950–1985) — reference activation override.

## Key Code

`Tabbrowser.sys.mjs:showSplitViewPanels` (4090–4103) loops over all tabs. It calls `#insertBrowser`, inserts a footer, sets `linkedBrowser.docShellIsActive = true`, marks panels active, and assigns the panel list.

`browser-custom-element.mjs:set docShellIsActive` (523–534) sets `browsingContext.isActive`. For remote browsers it also sets `remoteTab.renderLayers`. Setting only `renderLayers` is not equivalent to making the page foreground (`set renderLayers`, 540–555).

`AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell` (937–943) returns false for print preview, active split browsers, and PiP. `unloadNonRequiredTabs` (737–775) skips those browsers. This is layer retention, not protection from tab discard.

## Architecture

The split wrapper owns membership and activation. The tabbrowser owns the active split pointer. The panel widget owns display and input wiring. Gecko receives ordinary browser activeness; no split-specific engine primitive is needed (`tabsplitview.mjs:#activate`, 238–247; `Tabbrowser.sys.mjs:on_TabSplitViewActivate`, 9320–9323; `tabbox.js:set splitViewPanels`, 530–546; `BrowsingContext.cpp:ActivenessChanged`, 3189–3250).

## Scout Target Answer

### Native visible and active browsers

- All panes are explicitly activated, including the non-selected tab. Lazy browsers are inserted at that point. Activation is eager for every displayed member (`Tabbrowser.sys.mjs:showSplitViewPanels`, 4090–4103).
- `splitViewBrowsers` enumerates only `#activeSplitView.tabs`. `selectedBrowsers` returns that collection, otherwise the selected browser. Both already support arbitrary counts (`Tabbrowser.sys.mjs:get splitViewBrowsers`, 493–502; `get selectedBrowsers`, 638–643).
- Async switching normally loads/unloads layer trees. Loading activates docshells and requests rendering; unloading disables both. Split members are exempt from normal cleanup and do not keep the switcher pending solely because they remain loaded (`AsyncTabSwitcher.sys.mjs:setTabState`, 264–300; `postActions`, 652–668; `unloadNonRequiredTabs`, 737–775).
- The switcher still has one requested/loading/last-visible tab. Those are focus-transition state, not an N-pane layout. Do not replace these with N independent switchers without evidence (`AsyncTabSwitcher.sys.mjs:class documentation and constructor`, 42–95).

### Page Visibility and throttling

- Activeness propagates to descendant browsing contexts, remote render state, process-priority recomputation, and local docshells (`docshell/base/BrowsingContext.cpp:ActivenessChanged`, 3189–3250; `DidSet ExplicitActive`, 3338–3357). This supports Fission descendants without enumerating OS processes in split chrome.
- Docshell activeness updates PresShell, window background state, and posts a document visibility update (`nsDocShell.cpp:ActivenessMaybeChanged`, 4722–4765).
- A visible document with a non-background outer window reports visible. Focus is not consulted in this computation (`Document.cpp:ComputeVisibilityState`, 17572–17585). Thus unfocused split panes can remain visible.
- Background-state changes reach the timeout manager (`nsGlobalWindowOuter.cpp:SetIsBackground`, 6599–6627; `nsGlobalWindowInner.cpp:UpdateBackgroundState`, search hit 6020–6024). Timeout budgets distinguish foreground and background; active pane does not mean unlimited timers (`TimeoutManager.cpp:MinSchedulingDelay`, 208–230).
- Active PresShells tick refresh drivers at full speed when needed. Each visible animated pane can therefore keep animation work running; this is not merely painting a frozen tab (`PresShell.cpp:ActivenessMaybeChanged/ComputeActiveness`, 11915–11965). Exact rAF, WebGL, occlusion, and IntersectionObserver runtime behavior is UNVERIFIED.

### Hidden window edge case

- Without a switcher, chrome visibility changes loop over all selected browsers, preserve layers when inactive, and set activeness to the inverse of document.hidden (`Tabbrowser.sys.mjs:on_visibilitychange`, 9257–9265).
- With a switcher, `onVisibilityChange` skips split browsers because `shouldDeactivateDocShell` exempts them. Thus this path does not deactivate active-split panes even when windowHidden is true (`AsyncTabSwitcher.sys.mjs:onVisibilityChange`, 865–881; `shouldDeactivateDocShell`, 937–943). Actual minimized-window visibility and resource behavior is UNVERIFIED. This asymmetry deserves a focused review before copying it into N panes.

### Playback and autoplay

- Media suspension from an inactive docshell is conditional on the top browsing context's `suspendMediaWhenInactive`. Making a browser inactive is not a universal pause operation (`HTMLMediaElement.cpp:ShouldBeSuspendedByInactiveDocShell/NotifyOwnerDocumentActivityChanged`, 7497–7525).
- Autoplay authorization is separate from docshell activeness. It checks user activation and traits such as capture permission (`AutoplayPolicy.cpp:user-activation helper`, 80–85; `IsWindowAllowedToPlayByTraits`, 88–110). Keep stock policy; do not synthesize user activation or change autoplay preferences. Full background-video decoder and autoplay-policy paths are UNVERIFIED.

### Discard protection: important gap

- The automatic unloader's non-discardable check protects `tab.undiscardable` or `tab.selected`, not split membership. Audio, PiP, WebRTC and private tabs receive separate NEVER_DISCARD weights (`TabUnloader.sys.mjs:criteriaTypes`, 32–40; `DefaultTabUnloaderMethods.isNonDiscardable`, 52–58; media methods, 68–96).
- The final tabbrowser discard guard likewise checks selected, closing, connected, remote, window closing, and permitUnload, but not active split membership (`Tabbrowser.sys.mjs:#mayDiscardBrowser`, 3358–3384).
- Consequently the inspected paths do not protect an ordinary non-selected visible split pane. Protection elsewhere is UNVERIFIED. Layer-unload exemption must not be confused with discard protection.
- For N panes, protect active visible members in both the scoring predicate and final discard guard. Prefer deriving membership from the existing active split rather than adding permanent per-tab flags. Preserve ordinary background-split discard eligibility. This is a proposed change to `TabUnloader.sys.mjs:isNonDiscardable` and `Tabbrowser.sys.mjs:#mayDiscardBrowser`, not existing behavior.
- Unloader process enumeration already walks descendant browsing contexts and uses their current process IDs. A pane is not necessarily one new process; processes can be shared (`TabUnloader.sys.mjs:iterateBrowsingContexts/iterateProcesses`, 116–138).

### When the split is not selected

- Selecting outside the wrapper calls `#suspend`, not `#deactivate`. It removes active-panel classes and emits TabSplitViewDeactivate. The active split pointer is cleared. Panel classes, columns, dimensions, browser elements and membership survive (`tabsplitview.mjs:on_TabSelect`, 482–495; `#suspend`, 272–284; `Tabbrowser.sys.mjs:on_TabSplitViewDeactivate`, 9325–9330; `tabbox.js:suspendSplitViewPanels`, 590–596).
- These browsers cease to qualify for the active-split layer exemption. Normal switcher cleanup can deactivate them and unload layers later; it does not destroy the pages (`AsyncTabSwitcher.sys.mjs:unloadNonRequiredTabs`, 737–775; `setTabState`, 287–300). Precise event ordering for every transition is UNVERIFIED.
- Suspension does not remove panel listeners or footers. Full removal removes panel listeners; wrapper disconnection removes its TabSelect listener and disconnects its observer (`tabbox.js:removeTabsFromSplitview`, 558–580; `tabsplitview.mjs:disconnectedCallback`, 137–147).

### Memory costs and N-pane recommendation

- **Per visible pane:** a live browser/browsing context, normal tab progress listener and status filter, plus render/layer resources. Newly inserted lazy tabs acquire those normal tab allocations (`Tabbrowser.sys.mjs:showSplitViewPanels`, 4090–4103; browser insertion path, 3285–3323). Actual CPU/GPU bytes are UNVERIFIED and depend on content, viewport, processes and compositor behavior.
- **Per pane, split-specific:** footer DOM, URI/icon/security state, progress listener, TabAttrModified listener, click/command handlers; panel input/focus handlers (`split-view-footer.js:fields/connectedCallback`, 19–88; `setTab/#resetTab`, search hits 195–221; `tabbox.js:set splitViewPanels`, 530–546). Footers survive suspension. Reuse or replace this chrome; do not stack a second URL/progress subsystem on top.
- **Per split:** wrapper, tab-array field, WeakMap of saved widths, MutationObserver and window TabSelect listener. Disconnect cleanup exists (`tabsplitview.mjs:fields`, 43–55; `connectedCallback/#observeTabChanges/disconnectedCallback`, 109–182). Background splits still retain these objects.
- **Shared/startup:** the split module constructs one shared zero-delay DeferredTask for URL-bar updates at module evaluation, not one timer per pane. Actual module-load timing is UNVERIFIED (`tabsplitview.mjs:module-level updateUrlbarButton`, 7–30). The tabbrowser has an active-split pointer; `splitViewBrowsers` allocates a fresh array on every access, including the no-split case (`Tabbrowser.sys.mjs:fields/get splitViewBrowsers`, 481–502). Avoid adding persistent caches, global observers or timers for the fork's no-split path.
- **Switcher:** existing per-switch state and delayed unload timers are shared, not inherently per pane (`AsyncTabSwitcher.sys.mjs:constructor`, 81–95; `unloadNonRequiredTabs`, 737–775). Extend the existing membership exemption, not a per-pane polling loop.
- **Preloads:** stock new-tab preloading creates/loads a separate browser and marks it inactive. It limits and reuses the preload pool; consuming one clears the window preload pointer (`NewTabPagePreloading.sys.mjs:maybeCreatePreloadBrowser/getPreloadedBrowser`, 100–165). Inserted preloaded content deliberately avoids another inactive assignment to retain prepared layers (`Tabbrowser.sys.mjs:browser insertion`, 3312–3324). Do not allocate one preloader per leaf or change browser-wide preload prefs.
- **Reference caution:** Zen uses `zenModeActive` to prevent later deactivation via a separate browser-element patch. Its method also adds drag handlers and removes pending state (`ZenViewSplitter.mjs:setTabsDocShellState`, 1957–1983). Stock native split membership already provides the relevant exemption; importing Zen's override would add unnecessary coupling.
- **Generalization:** retain one selected/focused tab; supply all visible leaves through existing list APIs; activate only visible leaves, lazily materializing them at activation; remove active membership when hiding the tree; retain native delayed layer cleanup. Use small leaf chrome with existing progress infrastructure. These are design recommendations grounded in `Tabbrowser.sys.mjs:showSplitViewPanels/get selectedBrowsers` and `AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell/unloadNonRequiredTabs` cited above.

## Start Here

Open `browser/components/tabbrowser/Tabbrowser.sys.mjs:showSplitViewPanels` (4090–4103), then `AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell` (937–943). These are the activation and retention seams.

## Gaps / Follow-up Scouts / Open questions

- Is a non-selected active split tab ever marked undiscardable elsewhere? Target all writes to undiscardable and automatic-unload selection. The inspected final guards lack split protection.
- Why do switcher and non-switcher paths differ for minimized/occluded split windows? Trace visibility event ordering and engine occlusion behavior. Runtime validation is required later; none was run.
- Trace full autoplay and decoder background-suspension policy if exact media promises are required. Current policy extraction is partial.
- Measure native and N-pane incremental RAM/GPU cost later. No byte counts can be established by this read-only pass.
- Verify module loading timing for split chrome before claiming zero startup allocation.

## Exactly-two assumptions found in this area

- `toolkit/content/widgets/tabbox.js:setSplitViewActive` (614–625): orders only `splitViewPanels[0]` and `[1]`; uses a singular `splitViewSplitter` (607–611). Remaining splitter implementation was not retrieved; further two-pane constraints are UNVERIFIED.
- `browser/components/tabbrowser/content/tabsplitview.mjs:resetRightPanelWidth` (318–325): accesses only `panels[1]` and gives it remaining width.
- `browser/components/tabbrowser/content/tabsplitview.mjs:#observeTabChanges` (168–176): one-tab collapse comment assumes the other tab closed. The minimum-one collapse rule itself remains sensible for N leaves.
- `Tabbrowser.sys.mjs:browser insertion` (3326 onward) checks total window tab count == 2 for hasSiblings. This is not a split cardinality assumption and should remain stock.
- Activation, active membership, selectedBrowsers, and switcher split exemptions are already list-based, with no exactly-two limit in the inspected methods (`Tabbrowser.sys.mjs:showSplitViewPanels/get splitViewBrowsers/get selectedBrowsers`; `AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell`).
