# Code Context

## Files Retrieved
All source paths below are relative to `/Users/albertgwo/Repositories/firefox`.

1. `browser/components/tabbrowser/content/split-view-footer.js` (1-230): existing per-pane display and listener lifetime.
2. `browser/components/tabbrowser/Tabbrowser.sys.mjs` (893-898, 1444-1480, 4090-4128, 7490-7535, 10557-10590, 10705-10733): browser routing, footer creation, all-tab progress.
3. `toolkit/content/widgets/browser-custom-element.mjs` (449-478, 882-908): navigation getters and methods.
4. `toolkit/components/remotebrowserutils/RemoteWebNavigation.sys.mjs` (45-68): history-derived navigation state.
5. `browser/base/content/browser.js` (844-872, 1367-1390, 2230-2260): global commands and location focus.
6. `browser/base/content/browser-sets.js` (238-242), `browser/base/content/browser-sets.inc.xhtml` (100, 145-149): location command wiring.
7. `browser/components/urlbar/UrlbarUtils.sys.mjs` (100-174): shortcut/keyword resolution.
8. `browser/modules/URILoadingHelper.sys.mjs` (255-324, 407-428, 559-607): fixup and explicit browser targeting.
9. `browser/base/content/utilityOverlay.js` (118-120): trusted navigation wrapper.
10. `browser/themes/shared/tabbrowser/content-area.css` (482-489, 518-575): footer styling.
11. `toolkit/themes/shared/design-system/dist/tokens-shared.css` (125-142, 393-395, 479-480), `browser/themes/shared/jar.inc.mn` (207, 233): sizes and icons.
12. Architecture guide: `/Users/albertgwo/Downloads/firefox-recursive-split-view-architecture-guide.md` (1-200, 1970-2067); targeted heading search through remainder. Full guide not read; remaining details UNVERIFIED.
13. Zen reference: `/Users/albertgwo/Repositories/zen-desktop-ref/src/zen/split-view/ZenViewSplitter.mjs` targeted search only (2558-2582). No Zen behavior relied upon.

## Key Code

### Per-browser history
`toolkit/content/widgets/browser-custom-element.mjs:goBack/goForward` (882-908) call that browser's webNavigation through `_wrapURIChangeCall`. Use `tab.linkedBrowser.goBack()` and `.goForward()`, not global toolbar commands. Keep the default user-interaction filtering.

`browser-custom-element.mjs:canGoBack/canGoForward` (449-458) delegate to webNavigation. For remote browsers, `RemoteWebNavigation.sys.mjs:canGoBack/canGoForward` (48-61) derive values from `browsingContext.sessionHistory`: back uses `canGoBackFromEntryAtIndex(index)`; forward compares index and count. They are not UI-owned cached booleans needing a custom observer.

`browser/base/content/browser.js:gBrowserInit` is not the progress owner; the relevant existing method is `gBrowserStatusHandler.onLocationChange` (2230-2250), which calls `UpdateBackForwardCommands(gBrowser.webNavigation)`. `UpdateBackForwardCommands` (844-872) changes disabled attributes only when values differ. Apply the same diffing to pane buttons. Exact containing object name should be rechecked before editing (UNVERIFIED).

### One progress listener
`Tabbrowser.sys.mjs:addTabsProgressListener/removeTabsProgressListener` (7507-7530) stores one listener in the existing array. `_callProgressListeners` (1444-1480) sends global notifications only for the selected browser, but sends tabs listeners an extra leading browser argument for every browser.

Recommended signature:
```js
onLocationChange(browser, webProgress, request, location, flags) {
  if (!webProgress?.isTopLevel) return;
  // Find an existing pane header for browser; do not create one here.
  // Read browser.canGoBack / browser.canGoForward and browser.currentURI.
}
```
This is a design sketch, not implemented code. Initialize values when attaching a header; do not wait for a navigation. `Tabbrowser.sys.mjs:TabProgressListener.onLocationChange` (10557-10590, 10720-10726) receives subframe events and forwards location changes. Filtering is required. Whether all history mutations without navigation need another callback is UNVERIFIED.

### Trusted URL source
`browser-custom-element.mjs:currentURI` (461-473) returns the auth-prompt URI when present, otherwise `webNavigation.currentURI`. Read this chrome-side getter. Do not read page text, title, DOM location, or accept content messages as displayed URL truth. The site still chooses its navigations; this is browser-maintained state, not a claim that URLs are safe.

`split-view-footer.js:setTab` (190-211) seeds from `tab.linkedBrowser.currentURI`. Its listener updates from top-level location notifications (40-44). `#updateUriElement` (178-182) uses `BrowserUtils.formatURIForDisplay` and `textContent`. That is a compact display, not necessarily the full editable URL. Recommend full browser URI for editing and retain existing security treatment. Credential hiding, IDN handling, auth-prompt refresh, and edit/display formatting require a focused security follow-up (UNVERIFIED).

## Architecture

### Existing footer
`split-view-footer.js:MozSplitViewFooter` renders insecure status, favicon, domain text, and a menu button (57-66). `setTab` (190-211) installs one TabAttrModified listener and one per-browser progress listener for location/security. Each instance allocates its own listener object and arrow functions (35-52), state fields, and DOM. `connectedCallback` (69-89) adds click and command handlers. `#resetTab` (219-227) removes browser/tab subscriptions; `disconnectedCallback` (91-93) invokes it. No timer appears in this file.

**Memory:** `Tabbrowser.sys.mjs:showSplitViewPanels` (4090-4102) calls `#insertBrowser` for every visible split tab, enables docshell activity, and creates footers. This is existing eager browser activation for visible panes, not a reason for header code to instantiate additional browsers. `#insertSplitViewFooter` (4110-4119) caches by existing DOM presence. No explicit footer removal was found in the targeted Tabbrowser search. Retention after leaving split view is UNVERIFIED and needs lifecycle audit; hiding CSS does not remove listeners.

`content-area.css:inactive split footer selector` (482-489) shows footers only on non-selected split panels. New headers should either replace this display in the fork's split mode or avoid duplicate footer subscriptions. Simply adding headers above existing footers doubles UI state and keeps old listeners.

## Scout Target Answer

### URL versus search from a plain input
`UrlbarUtils.sys.mjs:getShortcutOrURIAndPostData` (116-174) handles engine aliases and Places keywords, including POST data and `mayInheritPrincipal`. It explicitly returns unchanged input if neither matches. It is **not** a complete URL-versus-search parser.

A small proposed chain is:
1. On Enter only, call this helper lazily.
2. Navigate through `openTrustedLinkIn(resolved.url, "current", params)` with explicit `targetBrowser`, POST data, and third-party fixup enabled.
3. Preserve the helper's inheritance semantics deliberately; do not grant inheritance for arbitrary input.

Evidence: `utilityOverlay.js:openTrustedLinkIn` (118-120) delegates to URILoadingHelper. `URILoadingHelper.sys.mjs:openLinkIn` (559-607) selects `params.targetBrowser || selectedBrowser`, with pinned-tab/container checks that can reject current-target loading. `openInCurrentTab` (255-320) enables ALLOW_THIRD_PARTY_FIXUP and FIXUP_SCHEME_TYPOS and calls `targetBrowser.fixupAndLoadURIString`. It disallows principal inheritance unless explicitly allowed.

**UNVERIFIED:** plain-text default-search equivalence, keyword-enabled fixup policy, pasted javascript stripping, POST principal behavior, private/container/pinned targeting, and async Enter races. Do not advertise stock omnibox semantics until these are traced. Capture the original target before awaiting shortcut resolution and abort if it was closed or detached. Avoid falling back silently to a different selected tab. Existing code warns that callers must strip javascript from pasted strings (`openInCurrentTab`, 262-267).

**Memory:** helper use can lazily load SearchService/Places/keyword utilities and allocate POST streams (`UrlbarUtils:getShortcutOrURIAndPostData`, 116-174; `getPostDataStream`, 185-201). Invoke only on submission, not on every keystroke or header construction. No per-pane UrlbarInput, autocomplete controller, popup, or Places query should be created. Exact incremental bytes are UNVERIFIED.

### Cmd-L hook
`browser-sets.inc.xhtml:focusURLBar/focusURLBar2` (145-149) point to `Browser:OpenLocation`; `browser-sets.js:command dispatch` (239-241) calls `openLocation(event)`. `browser.js:openLocation` (1367-1390) selects `UrlbarUtils.getURLBarForFocus(window)` and calls `view.autoOpen` in browser windows, otherwise redirects to a browser window.

Recommend one early branch **inside the browser-window case**: if the selected tab is a member of the active recursive split and its header is mounted, focus/select that input and return; otherwise execute upstream unchanged. Do not globally replace `getURLBarForFocus`, which returns a real urlbar with `.view`. No `focusAndSelectUrlBar` definition was found by targeted search. Keep pane selection synchronized with canonical `gBrowser.selectedTab`; selection mechanics are outside this scout.

**Memory:** this hook requires no permanent listener or timer. Resolve the selected pane only on command. Do not change preferences.

### 24–30px header
Use scoped split-only styles. `tokens-shared.css` defines `--size-item-medium: 24px` (480), `--button-min-height-small` and `--button-size-icon-small` (129,141), and `--icon-size-small: 16px` (395). Reuse footer tokens `--border-color`, `--border-radius-medium`, `--button-icon-fill`, `--space-xxsmall`, `--space-small` from `content-area.css:split-view-footer` (518-575). Back/forward icons are `chrome://browser/skin/back.svg` and `forward.svg` (`jar.inc.mn`, 207,233). RTL icon behavior and touch/accessibility sizing at 24px are UNVERIFIED; do not shrink browser-wide controls.

### Lowest-memory recommendation
Design recommendation, grounded in the APIs above:
- Create only two buttons and one plain input per visible split leaf. Reuse existing browser/tab objects.
- One window-level tabs progress listener, registered on first active split and removed on last split teardown. Filter browsers before touching DOM.
- Delegate header command, focus, and key handling at the split container. Avoid closures, timers, observers, and progress listeners per pane.
- Dispose headers and strong browser references on unsplit/close/window teardown. Avoid leaving hidden cached custom chrome behind.
- Remove or reuse footer functionality rather than keeping two subscriptions per pane. If retaining security/favicon UI, multiplex those updates through the same listener and one delegated tab-attribute handler.
- No active split: no custom header DOM, listener registration, timer, map, or eager browser. A small command branch remains. Actual zero incremental startup/module memory is UNVERIFIED.

## Gaps / Follow-up Scouts
- Trace fixup/search/principal pipeline from modern UrlbarInput to URIFixup, including pasted javascript and container/pinned target handling. Input source file was not located in this bounded pass.
- Audit footer removal and retained browser/listener graphs after unsplit.
- Trace session-history-only changes and auth-prompt changes to the exact UI notifications.
- Validate localization, accessible names, focus order, RTL, high contrast, and text scaling. No runtime verification was performed.

## Start Here
Open `browser/components/tabbrowser/content/split-view-footer.js:setTab` (190-227), then `Tabbrowser.sys.mjs:_callProgressListeners` (1444-1480). They show the existing per-pane allocation to avoid and the shared replacement hook.

## Open questions
- Should Cmd-L always target the pane input in split mode, or should a separate command retain the global omnibox?
- Should pane inputs offer plain fixup only, or stock aliases/bookmark keywords as well?
- Should existing footer security/menu UI be moved into the header or remain separately visible?
- Which history/auth notification gaps must be covered beyond top-level location changes?

## Exactly-two assumptions found in this area
- `Tabbrowser.sys.mjs:TabProgressListener.onLocationChange` (10705-10706) maps split URI telemetry indices to labels `"1"` and `"2"` with the comment `0 -> "1" (LTR left), 1 -> "2" (LTR right)`. N-pane telemetry labels require audit of the metric schema; schema acceptance of further labels is UNVERIFIED.
- No exactly-two loop limit was found in `showSplitViewPanels`, footer construction, or the tabs-progress API. The inactive-versus-selected footer display is binary focus state, not itself a two-pane limit (`content-area.css`, 482-489). This is not a repository-wide two-tab audit.
