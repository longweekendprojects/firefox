# Code Context

## Files Retrieved

Paths below are relative to `/Users/albertgwo/Repositories/zen-desktop-ref`, unless absolute. Function references use `Z` for `src/zen/split-view/ZenViewSplitter.mjs`.

1. `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (1–180): fork goals and upstream-first constraints.
2. `src/zen/split-view/ZenViewSplitter.mjs` (1–180, 280–300, 425–455, 630–740, 830–905, 1050–1140, 1540–1845, 1846–1985, 2410–2538, 2570–2662): tree, lifecycle, rendering, persistence, allocation paths.
3. `src/zen/split-view/zen-split-view.css` (1–140; targeted matches through 246): visibility and positioning.
4. `src/zen/split-view/zen-split-group.inc.css` (targeted matches 8–184): group presentation and visibility. Full rules UNVERIFIED.
5. `src/zen/split-view/zen-splitview-overlay.inc.xhtml` (1–10), `jar.inc.mn` (1–7): static overlay and packaging.
6. `src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch` (1–13; targeted matches throughout): browser-list integration.
7. `src/browser/components/tabbrowser/AsyncTabSwitcher-sys-mjs.patch` (1–12), `src/toolkit/content/widgets/browser-custom-element-mjs.patch` (1–19), `src/browser/components/tabbrowser/TabUnloader-sys-mjs.patch` (1–24): activation and unload changes.
8. `src/browser/components/sessionstore/SessionStore-sys-mjs.patch` (search matches 270, 337): persistence hooks; surrounding integration UNVERIFIED.
9. `LICENSE` (1–20, 158–207): MPL terms.

## Key Code

### Tree and edits

- `Z:nsSplitLeafNode` (9–37) holds `tab`, fractional percentage `sizeInParent`, `parent`, and cached root-relative inset rectangle `positionToRoot`. Width/height getters interpret size through the parent axis.
- `Z:nsSplitNode` (39–71) extends the leaf class with `direction` (`row` or `column`) and a child array. Assigning `children` repairs parent links. This is an n-ary alternating-axis tree, not strictly binary.
- `Z:splitIntoNode` (1075–1110) takes an insertion fraction, e.g. `0.5`, despite sizes being stored on a 0–100 scale. It inserts beside a leaf when its parent already has the requested axis. Otherwise it wraps the target in a new internal node. It divides only the target's existing share. Root replacement searches `_data` by tree identity.
- `Z:removeNode` (638–677) deletes the child and scales surviving sibling shares by `100 / (100 - removedShare)`. It collapses a unary parent. Where the replacement internal child has its grandparent's axis, it flattens that child and rescales grandchildren. Root collapse clears the new root's parent and rectangle.
- `Z:swapNodes` (1057–1066) exchanges sibling-array positions, parent references, and size shares. It does not exchange tabs or rectangles. Caller `onBrowserDrop` reapplies layout (1043–1048).
- `Z:calculateLayoutTree` (1639–1671) generates equal-width rows (`vsep`), equal-height columns (`hsep`), or a grid made of paired vertical columns. Grid with two tabs becomes a single row.

### Layout and splitters

- `Z:applyGridLayout` (1736–1788) converts parent percentages into root-relative percent insets recursively. Leaves set `.browserSidebarContainer.style.inset` and populate a tab-to-leaf WeakMap. Internal nodes create `children.length - 1` divider elements.
- `Z:getSplitters` (1811–1833) maintains a strong `Map<internalNode, divider[]>`. Each divider carries `parentSplitNode`, `gridIdx`, and orientation. `createSplitter` (1796–1804) adds one mousedown listener. `removeSplitters` (1836–1841) removes DOM and clears the map.
- `Z:handleSplitterMouseDown` (1870–1949) snapshots sibling sizes. Dragging redistributes size across neighboring siblings, bounded by `minResizeWidth`, which is a local percentage, not pixels. It installs document mousemove and one-shot mouseup listeners. Each move schedules its own animation frame; mouseup removes mousemove.
- `src/zen/split-view/zen-split-view.css:split-container rules` (11–65) make marked containers absolute and show multiple browser panels. Attribute ordering matters: `Z:activateSplitView` (1622–1628) marks children before parents to avoid a documented black flash. CSS fullscreen rules hide nonselected panes and expand the selected pane (42–49).
- `src/zen/split-view/zen-splitview-overlay.inc.xhtml:overlay markup` (5–9) provides three static hboxes. `zen-split-view.css:overlay rules` (114–136) places the wrapper above content, disables wrapper pointer events, and reenables them for divider hit targets.

### Activation and Firefox patches

- `Z:activateSplitView` (1596–1637) activates all pending member tabs, not only the selected tab. It calls `gBrowser.insertBrowser(tab)` for every pending tab. It dispatches nonbubbling `TabSplitViewActivate` on the tab container so SessionStore restores history, scroll and forms without reaching native tabbrowser split tracking. It then lays out and activates all docshells.
- `Z:setTabsDocShellState` (1957–1984) sets **browser** `.zenModeActive`, then `.docShellIsActive`. On deactivation it leaves the selected browser active. Activation removes `pending` and adds per-container dragstart/dragend listeners; deactivation removes those listeners.
- `Z:deactivateCurrentSplitView` (1568–1589) disables member docshells, resets container styles, removes divider DOM, clears the active index and hides overlay. It does not delete the stored tree or tabs.
- `src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch:Tabbrowser.splitViewBrowsers` (5–12) unconditionally delegates to Zen's getter, bypassing native active-split handling. `Z:splitViewBrowsers` (2651–2656) returns an empty array outside Zen splits or maps every active member to its linked browser. Do not copy this unconditional takeover into the stock-first fork.
- `src/browser/components/tabbrowser/AsyncTabSwitcher-sys-mjs.patch:AsyncTabSwitcher.shouldActivateDocShell` (5–10) adds `browser?.zenModeActive` to the activation predicate, alongside native split membership and PiP.
- `src/toolkit/content/widgets/browser-custom-element-mjs.patch:MozBrowser.docShellIsActive setter` (5–18) changes both `browsingContext.isActive` and `remoteTab.renderLayers` to `val || this.zenModeActive`. This prevents normal tab switching from turning visible nonselected panes off. It is a toolkit-level patch, not just CSS.
- `src/browser/components/tabbrowser/TabUnloader-sys-mjs.patch:DefaultTabUnloaderMethods.isNonDiscardable` (5–11) checks **tab** `.zenModeActive`. The splitter sets this on the **browser**, not the tab. Protection therefore appears mismatched; runtime outcome UNVERIFIED. Its `iterateTabs` change (13–24) also depends on Zen workspaces; do not import it.
- `src/browser/components/sessionstore/SessionStore-sys-mjs.patch:store/restore integration` (270, 337) calls Zen persistence hooks. Exact surrounding function names UNVERIFIED.

### Persistence

- `Z:storeDataForSessionStore` (2418–2445) serializes leaves as `{type: 'leaf', tabId, sizeInParent}` and internal nodes as `{type: 'splitter', direction, sizeInParent, children}`. Group records also retain `groupId`, `gridType`, and tab IDs. Parent pointers, cached rectangles and divider DOM are excluded.
- `Z:restoreDataFromSessionStore` (2448–2509) resolves groups and tabs by DOM IDs, skips missing leaves, reconstructs parent links, then replaces a generated tree with restored layout. There is no visible schema, axis, size, depth or arity validation in this function. Missing leaves can leave unary/empty internal nodes. Its legacy-data branch returns after one group; later groups are not processed by that invocation.

## Architecture

`Z:splitTabs` (search locations 1446–1519) stores group tabs plus a tree in `_data`. Detailed creation flow outside retrieved ranges is UNVERIFIED. `activateSplitView` materializes pending browsers, sets visibility attributes, computes absolute rectangles, builds overlay dividers and keeps member rendering active. `deactivateCurrentSplitView` removes active divider DOM but retains group models. `storeDataForSessionStore` bridges the model to session restore.

The useful reusable boundary is tree edits plus rectangle calculation. Zen's workspace, glance, DND, preference and new-tab dependencies should remain outside this fork. Evidence: `Z:init` (90–136), `maybeDisableOpeningTabOnSplitView` (2521–2534), and empty-split URL-bar flow (2582–2647).

## Scout Target Answer

### Memory findings

- **Module/window baseline:** `Z:nsZenViewSplitter` field initializers (73–87) allocate `_data`, a strong Map and a WeakMap. Module tail (2660) creates the singleton eagerly when evaluated. `init` (90–136) binds handlers, installs three persistent window tab listeners, a one-shot restore listener, and optional dragover listener; it registers lazy preference getters. Actual module load timing is UNVERIFIED.
- **Static baseline DOM:** overlay markup contains three hboxes even while hidden (`zen-splitview-overlay.inc.xhtml:overlay markup`, 5–9). Lazy overlay access does not itself defer that markup's allocation.
- **Per split:** tree nodes, internal child arrays, group tab arrays, and parent/tab references persist in `_data` (`Z:nsSplitNode`, 39–71; `storeDataForSessionStore`, 2436–2444). No numeric memory measurements were made.
- **Per pane:** one leaf; one cached rectangle per layout pass; four header elements and one remove-button closure/listener; a container mousedown listener; and two active drag listeners (`Z:applyGridLayout`, 1736–1770; `_createHeader`, 1704–1720; `styleContainer`, 1855–1857; `setTabsDocShellState`, 1957–1984). The header has unsplit/rearrange controls, not per-pane URL/navigation controls.
- **Per active divider:** a DOM div, mousedown listener, Map entry/array reference and back-reference (`Z:createSplitter/getSplitters`, 1796–1833). Tree invariants give N−1 dividers across a well-formed tree.
- **Hot-path garbage:** layout creates new rectangle objects on every recursive pass. The browser-list getter allocates an array on every call, even outside splits (`Z:applyGridLayout`, 1760–1770; `splitViewBrowsers`, 2651–2656).
- **Rendering dominates:** pending activation eagerly creates every pane browser. Keeping every pane's docshell and layers active adds content/rendering memory beyond the JS tree (`Z:activateSplitView`, 1607–1618; `setTabsDocShellState`, 1957–1973; `MozBrowser.docShellIsActive` patch, 5–18). These are existing tab browsers, not duplicate pane browsers.
- **Optional DND overhead:** cached thumbnail canvas is 280×140 device-pixel-ratio scaled; drag canvas is 160×90 similarly scaled. Linux creates and attaches a feedback panel and wrapper (`Z:enableTabRearrangeView`, 708–720; `onBrowserDragStart`, 842–900). Canvas/panel final disposal is UNVERIFIED. `fakeBrowser` is a vbox placeholder, not an actual browser (`Z:onBrowserDragOverToSplit`, 453–463).
- **Transient scheduling:** resize schedules one rAF per mousemove with no visible coalescing/cancellation (`Z:handleSplitterMouseDown`, 1899–1948). Empty-split flow schedules a timeout, then creates an AbortController and window URL-bar listener (`Z:empty-split flow`, 2582–2647; enclosing method name UNVERIFIED). No setInterval match exists in this module. No startup browser creation was found in `init`; broader startup behavior is UNVERIFIED.

### Sharp edges and visible comments

- Recursive divider removal loses the recursive flag: `_removeNodeSplitters` (684–692) calls `this._removeNodeSplitters(c)` rather than passing true. Deep subtree divider entries can survive; actual leak requires a path removing such a subtree and is UNVERIFIED.
- `getSplitters` (1813) treats zero as “do not adjust”, so a malformed unary node cannot request cleanup to zero.
- `removeNode`, `swapNodes` and `splitIntoNode` assume valid parents/membership and legal sizes; no visible ancestor-swap or fraction validation exists in these methods. `removeNode` normalization divides by zero for a removed 100% share with multiple remaining children (638–677).
- `applyGridLayout` calls command-state DOM updates at each internal node, not only once at the root (1786); unnecessary repeated work.
- Resize percent minimum does not establish a pixel minimum for nested leaves (`handleSplitterMouseDown`, 1917–1925). Pending rAFs can still run after mouseup; runtime impact UNVERIFIED.
- Explicit FIXME: setting min-width/min-height only on left/top DND preview is a workaround (`Z:onBrowserDragOverToSplit`, 425–450). Explicit TODO: make drop-edge threshold a preference (`_calculateDropSide`, 285–291). Explicit TODO: support splitting essential tabs (`splitTabs`, 1439).
- Visibility-order black-flash comments occur in `activateSplitView` (1622–1628) and `applyGridToTabs` (1686–1690). Dialog-stack absolute positioning is labeled a fix for issue 7564 (`zen-split-view.css:dialogStack`, 37–40).
- `MAX_TABS = 4` remains a product ceiling despite the general tree (`Z:fields`, 87; enforcement search hits 373, 1321, 1446, 1461, 2259, 2540).

### License and reuse

`Z:file header` (1–3), CSS/overlay headers, and `LICENSE:title` identify MPL-2.0. Reuse and modification are allowed by `LICENSE:2.1` (89 onward). Distribution must preserve notices and satisfy covered-source availability requirements (`LICENSE:3.1–3.4`, 160–205). Keep attribution/license headers on copied code. This is a license reading, not legal advice. Third-party assets or additional files need separate checks; permission for them is UNVERIFIED.

### Pure geometric directional focus

External tmux/i3/VS Code algorithms were not researched. Attribution or exact behavioral equivalence is **UNVERIFIED**; a web researcher follow-up is required. The following is a proposed local algorithm, not a claim about those projects. It consumes leaf rectangles produced analogously to `Z:applyGridLayout` (1736–1788).

1. Normalize rectangles into a common coordinate system. Reject zero/negative extents. Keep stable leaf IDs.
2. Rotate coordinates so the requested direction is “right”. For each other leaf, require its center to be beyond the source center along that axis. This tolerates rounded/shared boundaries.
3. Compute forward edge gap, perpendicular interval overlap, perpendicular interval gap, and perpendicular center distance. Clamp forward edge gap to zero for overlapping extents.
4. Prefer candidates with positive perpendicular overlap (the directional beam). Within that set minimize forward edge gap, then perpendicular center distance, then stable ID.
5. If no beam candidate exists, minimize squared rectangle distance `forwardGap² + perpendicularGap²`, then forward gap, then center distance, then stable ID. This allows diagonal fallback without choosing an arbitrary tree sibling.
6. Return null when no candidate exists. Make wraparound an explicit opt-in policy, not implicit behavior.

This is O(N) time and O(1) auxiliary space with a running best candidate. Define epsilon once for fractional coordinates. Tests should cover T-junctions, unequal panes, diagonals, ties, tiny overlap, no candidate and repeated commands. No tests were run.

## Gaps / Follow-up Scouts

- UNVERIFIED: module import/init timing, complete teardown, canvas disposal, and exact add/remove-browser flow. Focused follow-up: Zen feature loader plus DND cleanup methods.
- UNVERIFIED: actual current Firefox already supplies all needed N-browser activation through native `splitViewBrowsers`. Focused follow-up: compare native `Tabbrowser.splitViewBrowsers`, `AsyncTabSwitcher.shouldActivateDocShell`, and panel visibility before deciding whether any toolkit patch is needed.
- UNVERIFIED: external directional-focus implementation details; web research needed for project-specific attribution.

## Start Here

Open `Z:splitIntoNode` (1075–1110), then `applyGridLayout` (1736–1788). Separate pure tree/geometry operations from browser DOM and lifecycle work before reusing anything.

## Open questions

- Can native Firefox split membership keep every pane active without Zen's global browser-element override?
- Should inactive split models retain only tab IDs rather than strong tab references?
- What pixel minimum and deterministic focus fallback should the fork guarantee?
- Must restore reject malformed trees, or normalize/prune them before browser activation?

## Exactly-two assumptions in this area

- `Z:calculateLayoutTree` (1641): special-cases two grid tabs into a row. This is a special case, not a global two-tab limit.
- `Z:calculateLayoutTree` (1653–1667): grid generation pairs tabs into columns of two; odd final tabs remain full-height. It supports N, but encodes a two-row preset.
- `Z:onBrowserDragOverToSplit` (427–430): a fresh split preview starts with divisor two; existing splits use member count plus one.
- `Z:empty-split creation/replacement flow` (2572–2576, 2625–2634; enclosing method name UNVERIFIED): constructs `[emptyTab, selectedTab]`, then substitutes another two-tab array. This command creates an initial pair, not an arbitrary tree insertion.
- `Z:removeNode` (650): internal nodes require at least two children; this is a tree invariant, not exactly two tabs per split.
- Search also found minimum-two member checks at `Z` lines 1307, 1446 and 2068. They are lower bounds, not exactly-two constraints. No global exactly-two-tab restriction was found in the reviewed Zen splitter; maximum four remains explicit.
