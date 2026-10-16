# Code Context

## Files Retrieved

Paths below are relative to `/Users/albertgwo/Repositories/firefox`, unless absolute. Reads and searches only. No builds, tests, browser launches, or source edits.

1. `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (1–180, 1308–1360, 1610–1654) — project constraints and requested source map.
2. `browser/components/tabbrowser/content/tabsplitview.mjs` (1–540) — membership wrapper and activation.
3. `browser/components/tabbrowser/content/split-view-footer.js` (1–237) — per-pane UI and listeners.
4. `browser/components/tabbrowser/Tabbrowser.sys.mjs` (480–521, 636–644, 1360–1402, 3980–4144, 4408–4450, 8116–8140, 9320–9350; other split references searched) — gBrowser implementation. This checkout uses this module, not tabbrowser.js.
5. `toolkit/content/widgets/tabbox.js` (200–649) — direct-child deck selection, panels, splitter.
6. `toolkit/content/xul.css` (445–465) — panel visibility.
7. `browser/themes/shared/tabbrowser/content-area.css` (350–494; split references searched) — panel flex layout.
8. `browser/components/tabbrowser/content/tab.js` (400–415, 1040–1065; split references searched) — membership and accessibility.
9. `browser/components/tabbrowser/content/tabs.js` (885–915; split references searched) — flattened tabs and wrapper enumeration.
10. `browser/components/tabbrowser/content/tab-context-menu.js` (750–795, 1384–1428; split references searched) — split actions and two-tab limit.
11. `browser/components/tabbrowser/content/drag-and-drop.js` (575–610, 1030–1045; split references searched) — wrapper drag/adoption integration.
12. `browser/components/tabbrowser/AsyncTabSwitcher.sys.mjs` (900–955) — split docshell exception.
13. `browser/components/tabbrowser/content/opentabs-splitview.mjs` (1–165; remaining split references searched) — picker.
14. `browser/base/content/browser-main.js` (1–38), `browser/components/tabbrowser/jar.mn` (split references) — loading and packaging.
15. `browser/components/sessionstore/SessionStore.sys.mjs` (split-reference search), `browser/components/extensions/parent/ext-tabs.js` (split-reference search) — follow-up integration sites, not full audits.
16. `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs` (1736–1790; tree/layout references searched) — flat inset renderer reference.
17. Test inventory from `git ls-files '*splitview*' '*split-view*' '*tabsplit*'`. Tests were not executed or fully read.

## Key Code

### Membership and wrapper

`browser/components/tabbrowser/content/tab.js:splitview` (406–411) recognizes only an immediate `tab-split-view-wrapper` parent. Keep tab-strip tabs flat inside that wrapper. Do not put recursive tree elements around tab-strip tabs.

`browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper` owns `#tabs`, closing/unsplitting flags, a width WeakMap, and a MutationObserver. Its public `tabs` getter separately scans direct child tabs. These are two representations of membership.

| Function | Owns | Exactly two? | Action |
| --- | --- | --- | --- |
| `tabs`, `state`, `panels` | Direct children, serialized ID/count, browser panels | No fixed count; state has no tree | Extend state for tree; retain flat tab children |
| `connectedCallback`, `disconnectedCallback` | Window TabSelect listener, observer, width restoration, activation/removal events | No | Keep lifecycle; add deterministic tree teardown |
| `#observeTabChanges` | Accessibility numbering; empty removal; unsplit when one remains | Minimum-two invariant, not a maximum-two cap | Modify to prune removed leaves and collapse branches before singleton teardown |
| `#activate` | Show browser panels; emit TabSplitViewActivate | No | Hook renderer without changing event contract |
| `#deactivate`, `#suspend` | Remove or temporarily hide panel presentation; emit deactivate | No | Preserve distinction and extend geometry cleanup |
| `#resetPanelWidths`, `#restorePanelWidths` | Per-panel pixel width cache | Horizontal-only sizing | Replace with branch ratios for recursive layout |
| `resetRightPanelWidth` | Clears `panels[1]` width | Yes | Replace with branch-local resizing |
| `addTabs` | Adoption, private list updates, moving tabs, activation, URI telemetry | Loop is N-capable; telemetry describes positions 1/2 | Extend tree insertion; audit telemetry labels |
| `replaceTab` | Select new tab, remove old, insert at same index, reactivate | No explicit cap | Replace leaf identity atomically; protect observer interactions |
| `reverseTabs` | Destructures first/second; overwrites private list with two entries | Yes; loses N-member private list | Replace with explicit branch/leaf swap semantics |
| `unsplitTabs`, `close` | Close picker, unwrap tabs, close members | Loops support N | Preserve; release tree/chrome state |
| `on_TabSelect` | Activate selected wrapper or suspend old wrapper; adoption exception | No | Preserve |

Source: `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper` (42–540). **Memory:** each wrapper gets an array, WeakMap, lazy preference getter, observer on connection, and one window TabSelect listener. Disconnect removes/disconnects those subscriptions. `tabs` allocates a new array on every read. Private `#tabs` is not visibly pruned in the observer when ordinary children leave. Retention/correctness risk for N-pane close/move; actual leak duration is **UNVERIFIED**. Existing two-tab teardown masks some of this risk.

### gBrowser APIs and lifecycle

All following functions are in `browser/components/tabbrowser/Tabbrowser.sys.mjs`.

| Function | Owns | Exactly two? | Action |
| --- | --- | --- | --- |
| `#createTabSplitView` (3988–4000) | Wrapper creation and stable SessionStore ID | No | Retain; lazily attach model |
| `addTabSplitView` (4020–4083) | Wrapper insertion, tab enrollment, created event, telemetry | Accepts any nonempty array; telemetry examines only tabs 0/1 | Extend options with layout; generalize telemetry |
| `showSplitViewPanels` (4090–4103) | Browser insertion, footer creation, docshell activation, panel list | N-capable | Retain browser lifecycle; invoke geometry renderer |
| `#insertSplitViewFooter` (4110–4120) | One footer per browserStack | No | Replace or extend with tiny pane chrome; avoid duplicate UI |
| `openSplitViewMenu` (4122–4130) | Shared menu and trigger source | No count cap | Extend commands only |
| `adoptSplitView` (4408–4450) | Adopt every tab, preserve split ID and selection, suppress noisy extension moves | N loop | Must transfer tree/ratios/active leaf; currently only reconstructs membership |
| `moveTabToSplitView` (8116–8140) | Pinned rejection, indexed child insertion, move bookkeeping | No | Update both old/new trees through existing bookkeeping |
| `activeSplitView`, `splitViewBrowsers`, `selectedBrowsers` (480–519, 638–643) | Active wrapper and active browser collection | No | Preserve semantics; consider allocation-free membership query |
| `on_TabSplitViewActivate`, `on_TabSplitViewDeactivate`, `#moveSplitViewNotificationBoxes` (9320–9350) | Active pointer and notification relocation | No | Preserve events and panel containers |
| `#insertNotificationBox`, `#isBrowserInActiveSplitView` (1376–1397) | Notifications inside active pane container, otherwise shared deck | No | Keep |

**Memory:** `showSplitViewPanels` calls `#insertBrowser` for every member and sets every linked browser `docShellIsActive = true`. A split containing lazy tabs therefore forces browser insertion at activation. N live content processes/documents dominate tree memory; byte/process cost is **UNVERIFIED**. Do not create clone browsers, hidden mirror browsers, or a second process-backed URL/picker page per pane. `splitViewBrowsers` allocates an array even with no active split and also calls allocating wrapper `tabs`; `selectedBrowsers` adds its singleton array outside splits. These are upstream baseline allocations, not justification for new global caches.

Lifecycle search anchors: `Tabbrowser.sys.mjs` split references at 6914–6926 (selection fallback), 7554–7561 and 7602–7610 (show/hide all siblings), 7673–7754 (new window/adoption), 7911–7943 and 8056–8059 (move whole wrapper), 8160–8201 (move wrapper to groups), 8241–8271 (move-state split ID), 8311–8316 (expand wrapper movement), 8462–8521 (tab navigation), 8646–8711 (multiselection). These are search-level anchors, not full function audits. N-specific changes beyond model hooks are **UNVERIFIED**; keep native wrapper identity so these paths continue to operate on arrays.

### Layout, deck, and splitter

`toolkit/content/widgets/tabbox.js:MozDeck.selectedPanel/selectedIndex` (230–267) indexes `this.children`. `getRelatedElement` in `MozTabpanels` (493–528) also uses direct panel children and linkedpanel IDs. Nested browser-panel DOM would require revisiting these selection and related-element paths.

`toolkit/content/xul.css` panel rules (447–462; stylesheet, no function) visually hide unselected direct children, then expose `.deck-selected`, `.split-view-panel-active`, and `.split-view-splitter`. The extra active class is how multiple browsers appear despite normal single-panel deck behavior.

`browser/themes/shared/tabbrowser/content-area.css` panel rules (364–490; stylesheet, no function) make tabpanels a flex row. Each split panel has 140px minimum width, a `100% - minimum` maximum, and a default width of 49.4%. Active panels get margins and relative positioning. Column 0 has order 0, the splitter order 1, and column 1 order 2. Fullscreen shows the selected browser over the others. Replace only split-scoped geometry; retain normal deck styling and audit fullscreen/dialog clipping.

| `toolkit/content/widgets/tabbox.js:MozTabpanels` function | Owns | Two? | Action |
| --- | --- | --- | --- |
| `splitViewPanels` setter (530–545) | Panel classes/column; focus and hover handlers | N loop | Retain membership/listeners; renderer assigns geometry |
| `removeTabsFromSplitview` (556–580) | Removes classes, column, listeners, active list entries | No | Extend geometry cleanup |
| `suspendSplitViewPanels` (590–596) | Hides active panels but preserves sizes | No | Preserve no-reflow intent |
| `setSplitViewActive` (605–644) | DOM order, singleton splitter placement, selected-panel repair | Yes: first/second panels | Replace pair-specific ordering and splitter placement |
| `splitViewSplitter`, `#createSplitViewSplitter` (412–438) | One lazy XUL splitter, observer and command handler | Yes: singleton horizontal sibling resize | Replace with branch splitters scoped to active layout |
| `updateSplitterAriaAttributes` (440–488) | First panel width, second panel's assumed equal minimum, aria bounds | Yes | Branch-specific axis and bounds |
| `#recordSplitViewResizeTelemetry` (330–347) | First panel's percent of window width | Yes in meaning | Generalize or avoid new telemetry |
| `#updateSelectedSplitViewColumn` (355–373) | Root column attribute for surrounding chrome | Columns are indexed, surrounding styles only 0/1 | Replace directional-edge assumptions |
| `handleEvent` (381–409) | Focus selects pane tab; hover relocates StatusPanel | No | Retain; pane toolbar must not select wrong browser |

**Memory:** `MozTabpanels` fields (278–305) eagerly allocate an empty panel array and MutationObserver even without a split. `connectedCallback` (317–324) eagerly creates a DeferredTask. Splitter itself is lazy, but `setSplitViewActive` reads its getter even on deactivation. Once created, splitter/observer/command closure stay associated with tabpanels; disconnect finalizes the task and observer. Active panel setup adds click/mouseover/mouseout on each browserContainer plus focus on each browser. Suspension does not remove these; final removal does. Avoid extra per-pane timers/observers. One split-scoped resize handler can update N rectangles.

### Footer and tiny chrome

`browser/components/tabbrowser/content/split-view-footer.js:MozSplitViewFooter.connectedCallback` (67–88) builds security/icon/domain/menu DOM and installs click/command handlers. `setTab` (189–215) installs TabAttrModified and a browser progress listener for location/security. `#resetTab` (220–233) removes those on reassociation or disconnect. No two-pane cap. Extend or replace this component for Back/Forward/URL, using the associated tab's browser, not global selectedBrowser.

**Memory:** one footer has DOM references, URI/icon/security state, one listener object with closures, and a strong tab reference. `Tabbrowser.sys.mjs:#insertSplitViewFooter` only creates it once. `tabsplitview.mjs:#deactivate/#suspend` and `tabbox.js:removeTabsFromSplitview` do not remove footers. Thus footer DOM and progress/tab listeners remain after unsplitting while the panel survives. This is source-visible persistence, not a measured leak. Remove new pane chrome/listeners on leaving split membership; keep suspension policy explicit. Do not keep an editable URL history/autocomplete controller per pane without a measured need.

### Startup and packing

`browser/base/content/browser-main.js` top-level block (22, 31) eagerly loads the footer script and imports tabsplitview in each chrome window. `tabsplitview.mjs` top-level `updateUrlbarButton` (7–30) imports DeferredTask and allocates one task per window; it is armed on activation/deactivation/selection/reverse. It is not a periodic timer. Existing wrapper connection also writes the upstream `browser.tabs.splitview.hasUsed` marker, `tabsplitview.mjs:connectedCallback` (124–126). Do not introduce browser-wide pref changes.

Recommendation: put pure model and renderer modules under `browser/components/tabbrowser/splitview/` (already contains triage.json). Keep small adapter/custom-element code in `content/`. Package chrome-loaded files through `browser/components/tabbrowser/jar.mn` (existing footer/wrapper mappings at 14, 25). Lazy-import new implementation at first split creation; allocate no new per-window manager, observer, timer, or Map before then. Exact new packaging URI is a design choice, **UNVERIFIED** until implementation.

### Tab strip, context menus, drag/drop, and picker

- `browser/components/tabbrowser/content/tabs.js:allTabs/allSplitViews` (885–915) flatten wrapper children and enumerate wrappers including those inside groups. `focusableItems` and `dragAndDropElements` search anchors (1002–1049) distinguish leaf tab focus from wrapper dragging. N loops; retain flat strip structure. **Memory:** these getters construct arrays; do not add parallel cached tab registries without invalidation/retention justification.
- `browser/components/tabbrowser/content/tab.js:updateSplitViewAriaLabel` (1043–1064) labels only indices 0/1 as left/right. Must support position/count or spatial labels for N. `tab.js` alt-click path (632–639) creates a pair only when neither tab is already split; extend for split-leaf actions if desired.
- `browser/components/tabbrowser/content/tab-context-menu.js` split menu-update block (750–793) disables creation when more than two context tabs are selected. It hides creation for any existing split member. Must change for N creation/insertion. `moveTabsToSplitView` (1384–1416) keeps selected tab first and creates an `about:opentabs` companion for one selection; otherwise passes the array. `unsplitTabs` (1418–1422) already deduplicates wrappers; `reverseSplitView` (1425–1427) delegates pair semantics. Keep group/move actions; replace reverse semantics.
- `browser/base/content/nsContextMenu.sys.mjs` split-reference search: menu eligibility (528–559) excludes a current split tab; `openLinkInSplitView` (1589–1600) creates `[currentTab, linkTab]`. Full surrounding function not read: additional policy **UNVERIFIED**. Follow up for open-link-into-active-leaf behavior.
- `browser/components/tabbrowser/content/drag-and-drop.js:_getDropIndex` (1035–1042) promotes a leaf tab to its wrapper. Cross-window drop block (593–609) calls `gBrowser.adoptSplitView` and handles wrapper collections. Other relevant anchors: 96–101 (drag whole wrapper), 638–660 (first/last selection range), 1106–1109 (expand target split tabs), 2887–2898 (clear wrapper drag styles). No explicit pair cap found in these searched branches. Keep strip DnD; add separate pane drop targets only on demand. Entire DnD file was not audited. **Memory:** do not clone Zen's screenshot/drag-preview machinery just to implement pane splitting.
- `browser/components/tabbrowser/AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell` (937–943) excludes every browser in `gBrowser.splitViewBrowsers`, not just one other tab. Keep. `shouldActivateDocShell` (947–951) follows tab loading state. Other switcher internals are **UNVERIFIED**. **Memory:** active split panes intentionally remain active; this is not a tree bookkeeping leak. The membership check constructs temporary arrays through the getter.
- `browser/components/tabbrowser/content/opentabs-splitview.mjs:OpenTabsInSplitView` (23–165) is the Firefox View-style `about:opentabs` picker, not the browser layout renderer. Constructor creates OpenTabsController and chooses private-window/global tab target. `connectedCallback/disconnectedCallback` add/remove window TabSelect and target TabChange subscriptions. `onTabListRowClick` replaces the embedding picker tab through wrapper `replaceTab`; no explicit pair cap. `allAvailableTabs` excludes pinned, already-split, and picker tabs. Extend if moving an existing split leaf should be supported. **Memory:** each picker is a browser document plus Lit/controller state and tab lists; use only on explicit request, not as background pane chrome. `render` (149–165) queues navigation to newtab if empty or outside split; no repeating timer shown.

### Session and extensions boundary

`browser/components/sessionstore/SessionStore.sys.mjs:#collectSplitViewDataForTabGroup` search anchors (2861–2866) collects wrapper `.state`; `tabsplitview.mjs:state` currently stores only ID/count. Recursive shape and ratios cannot survive that representation. Full restore machinery needs a separate focused audit; do not claim restore support from N-capable addTabs alone.

`browser/components/extensions/parent/ext-tabs.js` tabs.move search anchors (1151–1189) find an `otherTabInSplit`, decide reversal, unsplit, or adopt. This is a material two-tab assumption outside UI. Preserve splitViewId and native move events; audit this branch before shipping N panes. Detailed extension API behavior is **UNVERIFIED** here.

## Architecture

Selected tab -> `MozTabSplitViewWrapper.on_TabSelect` -> wrapper activation -> `gBrowser.showSplitViewPanels` -> materialize member browsers and footers -> `MozTabpanels.splitViewPanels` -> multiple direct-child browser panels visible. Wrapper activation events update gBrowser's active pointer and move notifications. AsyncTabSwitcher uses that pointer's browser list to keep every visible pane active. Sources: `tabsplitview.mjs:on_TabSelect/#activate`, `Tabbrowser.sys.mjs:showSplitViewPanels/on_TabSplitViewActivate`, `tabbox.js:splitViewPanels`, `AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell`.

## Scout Target Answer

Prefer **flat browser panels with computed recursive geometry**. Keep the model tree separate from both tab-strip DOM and browser DOM. Apply rectangles to existing direct-child panels; create only branch separators and tiny pane chrome. This is a recommendation, not a validated prototype.

Why: `tabbox.js:MozDeck.selectedPanel` indexes direct children, `MozTabpanels.getRelatedElement` expects them, `xul.css` exposes direct active panels, and `tab.js:splitview` expects flat strip children. Nested browser panels would touch selection, related-element mapping, visibility, and likely fullscreen/focus CSS. Flat geometry mainly replaces the existing split-only flex/splitter machinery. `ZenViewSplitter.mjs:applyGridLayout` (1736–1790, absolute reference path above) demonstrates recursive percentages applied as `style.inset` to existing `.browserSidebarContainer` leaves and branch splitter geometry. Borrow the arithmetic, not Zen's managers or browser-wide policies.

**Memory recommendation:** one compact tree per split, references to existing tabs, one separator per binary branch, and no extra browser. Reuse upstream membership and activation paths. Allocate renderer/chrome only when a split exists. Destroy on final teardown; retain only ratio data for dormant splits if required. Exact cost and nested-vs-flat runtime performance are **UNVERIFIED** without later approved measurements.

## Tests Inventory

Inventory only; no test execution or assertions audited. All paths below are under `browser/components/tabbrowser/test/browser/` unless stated.

- `tabs/browser_tab_splitview.js`: base operations.
- `tabs/browser_tab_splitview_contextmenu.js`, `browser_tab_splitview_alt_click.js`, `browser_tab_splitview_about_opentabs.js`: entry points/picker.
- `tabs/browser_tab_splitview_resize.js`, `browser_tab_splitview_splitter_keyboard.js`, `browser_tab_splitview_splitter_keyboard_boundary.js`, `browser_tab_splitview_content_size.js`: geometry/splitter coverage.
- `tabs/browser_tab_splitview_keyboard_focus.js`, `browser_tab_splitview_findbar.js`, `browser_tab_splitview_footer.js`: focus and pane UI.
- `tabs/browser_tab_splitview_tab_order.js`, `browser_tab_splitview_tab_height.js`, `browser_tab_splitview_telemetry.js`, `browser_replacewithwindow_splitview.js`: order, strip, metrics, adoption.
- `dragdrop/browser_drag_splitview.js`, `browser_drag_multiselected_splitview.js`, `browser_drop_link_splitview_unselected.js`; `statuspanel/browser_show_statuspanel_splitview.js`.
- `browser/components/sessionstore/test/browser_splitview_integer_ids.js`, `browser_splitview_string_migration.js`, `browser_splitview_restore_in_closed_window.js`; `marionette/test_splitview_restore.py`, `test_splitview_hidden.py` in that test directory.
- `browser/components/extensions/test/browser/browser_ext_tabs_group_splitview.js`, `browser_ext_tabs_move_splitview.js`.
- `browser/components/places/tests/browser/browser_bookmark_drag_splitview.js`; `browser/components/screenshots/tests/browser/browser_screenshots_splitview.js`.
- `toolkit/components/messaging-system/schemas/SpecialMessageActionSchemas/test/browser/browser_sma_open_tab_in_splitview.js`.

Desired additions: three-plus panes, mixed axes, closing/moving a middle leaf, cross-window shape transfer, suspension/reactivation without geometry loss, no new controllers when no split exists, cleanup of pane listeners after unsplit. These are recommendations, not existing coverage claims.

## Gaps / Follow-up Scouts

- Audit complete tab removal/adoption/move functions and private `#tabs` synchronization after removing a member from N panes.
- Audit SessionStore collect/restore and closed-window/tab undo for layout shape and browser eagerness.
- Audit ext-tabs tabs.move around 1151–1200 for N-pane preservation.
- Audit full AsyncTabSwitcher loading/unloading, focus handoff, tab unloader, fullscreen, print preview, RDM, DevTools, and dialog interactions. Only split-specific entry points were traced here.
- Read test assertions before proposing exact modifications. Inventory alone does not establish supported behavior.
- No external facts were needed. Memory byte counts and actual browser behavior remain **UNVERIFIED** because runtime inspection is forbidden.

## Start Here

Open `browser/components/tabbrowser/content/tabsplitview.mjs:MozTabSplitViewWrapper`. It is the existing ownership boundary. Resolve membership synchronization and teardown first, then adapt `toolkit/content/widgets/tabbox.js:MozTabpanels` while keeping panels direct children.

## Open questions

1. Should closing a pane close its tab, or detach it from the split? Native observer behavior assumes the former in singleton teardown (`tabsplitview.mjs:#observeTabChanges`).
2. Should dormant splits retain tiny chrome/listeners or only model data? Native footer persistence conflicts with the near-zero-added-memory goal (`split-view-footer.js:setTab`, `Tabbrowser.sys.mjs:#insertSplitViewFooter`).
3. What replaces reverse-tabs semantics and left/right localization for mixed-axis trees (`tabsplitview.mjs:reverseTabs`, `tab.js:updateSplitViewAriaLabel`)?
4. How should extension tabs.move handle one leaf of an N-pane tree (`ext-tabs.js` tabs.move branch, 1151–1189)?
5. Should all visible panes always remain live, matching upstream (`AsyncTabSwitcher.sys.mjs:shouldDeactivateDocShell`), with content memory explicitly outside the small model/chrome budget?

## Exactly-two assumptions found

This list is exhaustive only for the inspected code and search hits, not the entire repository.

- `tabsplitview.mjs:reverseTabs` (464–472): destructures two and replaces private membership with two.
- `tabsplitview.mjs:resetRightPanelWidth` (322–328): always panel 1.
- `tabsplitview.mjs:#observeTabChanges` (174–182): one member remaining triggers total unsplit. Valid minimum-two policy, but insufficient branch pruning.
- `tabsplitview.mjs:addTabs` (385–388), `Tabbrowser.sys.mjs` location telemetry (10703–10706, search-only): positional URI telemetry labels require N audit; allowed label set **UNVERIFIED**.
- `Tabbrowser.sys.mjs:addTabSplitView` (4030–4034): group telemetry only considers primary/secondary tabs.
- `tabbox.js:MozTabpanels.#createSplitViewSplitter` (419–438): one separator resizes preceding sibling; reset second panel.
- `tabbox.js:MozTabpanels.setSplitViewActive` (614–635): orders first/second and inserts one splitter between them.
- `tabbox.js:MozTabpanels.updateSplitterAriaAttributes` (447–464): first panel controlled; other panel assumed same minimum width.
- `tabbox.js:MozTabpanels.#recordSplitViewResizeTelemetry` (335–346): reports left panel as percentage of whole width.
- `content-area.css` split panel rules (387–393, 447–475): 49.4% width, two-panel maximum, columns 0/1 and separator order 1. No function; CSS selectors are ownership boundary.
- `content-area.css` root `splitview-selected-column` rules (111–117, search-only): surrounding splitter chrome recognizes columns 0/1. Full edge styling needs follow-up.
- `tab.js:updateSplitViewAriaLabel` (1043–1064): only left/right labels for 0/1.
- `tab.js` alt-click handler (632–639, search-only): pair creation and excludes existing split membership. Handler name **UNVERIFIED**.
- `tab-context-menu.js` split menu-update block (789–793): disables more than two selections; containing function name **UNVERIFIED** in selective read.
- `tab-context-menu.js:moveTabsToSplitView` (1398–1402): singleton selection creates a two-tab split with picker.
- `nsContextMenu.sys.mjs:openLinkInSplitView` (1589–1600, search-only): opens a pair; current split excluded at 531–559.
- `ext-tabs.js` tabs.move branch (1151–1176, search-only): one other tab, pair reversal/unsplitting. Exact enclosing callback name **UNVERIFIED**.
