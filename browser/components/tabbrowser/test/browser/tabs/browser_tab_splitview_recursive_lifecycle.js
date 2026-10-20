/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Recursive split view: pin, duplicate, undo close, private windows,
// containers, dragging between windows, and restore with bad data.

const PAGE = "https://example.com/";

const triggeringPrincipal_base64 = E10SUtils.SERIALIZED_SYSTEMPRINCIPAL;

const { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs"
);

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

async function addLoadedTab(win = window, params = {}) {
  const tab = BrowserTestUtils.addTab(win.gBrowser, PAGE, params);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

// A | (B over C) in `win`, with A selected.
async function threePaneSplit(win = window, params = {}) {
  const tabs = [
    await addLoadedTab(win, params),
    await addLoadedTab(win, params),
    await addLoadedTab(win, params),
  ];
  await BrowserTestUtils.switchTab(win.gBrowser, tabs[0]);
  const sv = win.gBrowser.addTabSplitView(tabs.slice(0, 2), {
    insertBefore: tabs[0],
  });
  sv.splitPane(tabs[1], "down", tabs[2]);
  await TestUtils.waitForTick();
  return { sv, tabs };
}

function headerCount(win = window) {
  return win.document.querySelectorAll(".split-pane-header").length;
}

function visibility(tab) {
  return SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.document.visibilityState
  );
}

async function closeSplit(sv) {
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
}

add_task(async function test_pin_member() {
  const { sv, tabs } = await threePaneSplit();
  const [a, b, c] = tabs;

  // Pin a pane that is visible but not selected.
  gBrowser.pinTab(c);
  await TestUtils.waitForCondition(() => sv.tabs.length == 2);
  Assert.ok(c.pinned && !c.splitview, "pinned pane left the split");
  Assert.ok(sv.isConnected, "split survives with two panes");
  Assert.equal(headerCount(), 2, "only remaining panes keep headers");
  const panel = document.getElementById(c.linkedPanel);
  Assert.ok(!panel.classList.contains("split-pane"), "pane state cleared");
  Assert.ok(!panel.style.left, "pane geometry cleared");
  await TestUtils.waitForCondition(
    async () => (await visibility(c)) == "hidden",
    "pinned pane no longer renders"
  );
  Assert.deepEqual(
    sv.state.layout.root,
    { axis: "row", ratio: 0.5, first: { id: 0 }, second: { id: 1 } },
    "layout collapses to the remaining panes"
  );

  // Pin the selected pane.
  await BrowserTestUtils.switchTab(gBrowser, b);
  gBrowser.pinTab(b);
  await TestUtils.waitForCondition(() => !sv.isConnected);
  Assert.ok(b.selected && b.pinned, "pinned pane stays selected");
  Assert.ok(!a.splitview, "a split of one becomes a plain tab");
  Assert.equal(headerCount(), 0, "no pane chrome left");
  Assert.ok(!gBrowser.activeSplitView, "no active split");

  // Unpinning does not rejoin anything.
  gBrowser.unpinTab(b);
  gBrowser.unpinTab(c);
  Assert.ok(!b.splitview && !c.splitview, "unpinned tabs stay ordinary");
  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_pin_selected_member_of_large_split() {
  const { sv, tabs } = await threePaneSplit();
  gBrowser.pinTab(tabs[0]);
  await TestUtils.waitForCondition(() => sv.tabs.length == 2);
  Assert.ok(tabs[0].selected, "pinned tab stays selected");
  Assert.ok(!sv.hasActiveTab, "split no longer active");
  Assert.equal(headerCount(), 0, "split chrome hidden while not shown");
  Assert.ok(!gBrowser.activeSplitView, "no active split");
  Assert.ok(
    !document.getElementById(tabs[1].linkedPanel).checkVisibility(),
    "split panes are not drawn over the pinned tab"
  );
  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  Assert.equal(headerCount(), 2, "split shows again");
  gBrowser.unpinTab(tabs[0]);
  BrowserTestUtils.removeTab(tabs[0]);
  await closeSplit(sv);
});

add_task(async function test_duplicate_member() {
  const { sv, tabs } = await threePaneSplit();
  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  const restored = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "SSTabRestored"
  );
  const dup = gBrowser.duplicateTab(tabs[1]);
  await restored;
  Assert.ok(!dup.splitview, "duplicate is an ordinary tab");
  Assert.equal(sv.tabs.length, 3, "split unchanged");
  Assert.deepEqual(sv.tabs, tabs, "split members unchanged");
  Assert.ok(
    dup.index < tabs[0].index || dup.index > tabs[2].index,
    "duplicate sits outside the split"
  );
  BrowserTestUtils.removeTab(dup);
  await closeSplit(sv);
});

add_task(async function test_undo_close_member() {
  const { sv, tabs } = await threePaneSplit();
  const [, b] = tabs;
  await BrowserTestUtils.switchTab(gBrowser, b);
  await TabStateFlusher.flush(b.linkedBrowser);
  const before = SessionStore.getClosedTabCountForWindow(window);
  BrowserTestUtils.removeTab(b);
  await TestUtils.waitForCondition(
    () => SessionStore.getClosedTabCountForWindow(window) == before + 1
  );
  Assert.equal(sv.tabs.length, 2, "split keeps two panes");

  const restoredPromise = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "SSTabRestored"
  );
  const reopened = SessionStore.undoCloseTab(window, 0);
  await restoredPromise;
  Assert.equal(reopened.splitview, sv, "reopened pane rejoins its split");
  Assert.ok(reopened.selected, "reopened tab selected");
  Assert.equal(sv.tabs.length, 3, "split has three panes again");
  Assert.equal(headerCount(), 3, "every pane shows");
  Assert.less(
    rectOf(tabs[0]).x,
    rectOf(reopened).x,
    "reopened pane is back to the right of A"
  );
  Assert.less(
    rectOf(reopened).y,
    rectOf(tabs[2]).y,
    "reopened pane is back above C"
  );
  Assert.equal(reopened.linkedBrowser.currentURI.spec, PAGE, "page restored");

  // Closing the reopened tab must not resurrect stale split membership.
  await TabStateFlusher.flush(reopened.linkedBrowser);
  BrowserTestUtils.removeTab(reopened);
  await closeSplit(sv);
});

function rectOf(tab) {
  return document.getElementById(tab.linkedPanel).getBoundingClientRect();
}

add_task(async function test_accel_z_reopens_closed_pane() {
  const { sv, tabs } = await threePaneSplit();
  const [, , c] = tabs;
  await BrowserTestUtils.switchTab(gBrowser, c);
  await TabStateFlusher.flush(c.linkedBrowser);
  BrowserTestUtils.removeTab(c);
  await TestUtils.waitForCondition(() => sv.tabs.length == 2);
  // Two panes left: closing one more unsplits into a plain tab.
  const b = tabs[1];
  // Closing C already selected its neighbor B.
  Assert.ok(b.selected, "closing C selects B");
  await TabStateFlusher.flush(b.linkedBrowser);
  BrowserTestUtils.removeTab(b);
  await TestUtils.waitForCondition(() => !sv.isConnected);

  gBrowser.selectedBrowser.focus();
  let restored = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "SSTabRestored"
  );
  EventUtils.synthesizeKey("z", { accelKey: true });
  await restored;
  const b2 = gBrowser.selectedTab;
  Assert.ok(b2.splitview, "Accel+Z rebuilds the split");
  Assert.equal(b2.splitview.tabs.length, 2, "two panes again");
  Assert.less(rectOf(tabs[0]).x, rectOf(b2).x, "B back to the right of A");

  restored = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "SSTabRestored"
  );
  gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey("z", { accelKey: true });
  await restored;
  const c2 = gBrowser.selectedTab;
  Assert.equal(c2.splitview, b2.splitview, "C rejoins the same split");
  Assert.less(rectOf(b2).y, rectOf(c2).y, "C back below B");

  // A text field, in chrome or in a page, keeps Accel+Z for its own undo.
  await SpecialPowers.spawn(c2.linkedBrowser, [], () => {
    const input = content.document.createElement("input");
    content.document.body.append(input);
    input.focus();
  });
  await TestUtils.waitForCondition(
    () =>
      window.windowUtils.IMEStatus != Ci.nsIDOMWindowUtils.IME_STATUS_DISABLED
  );
  const beforePage = SessionStore.getClosedTabCountForWindow(window);
  EventUtils.synthesizeKey("z", { accelKey: true });
  await TestUtils.waitForTick();
  Assert.equal(
    SessionStore.getClosedTabCountForWindow(window),
    beforePage,
    "nothing reopened from a page text field"
  );

  const closedBefore = SessionStore.getClosedTabCountForWindow(window);
  gURLBar.focus();
  EventUtils.synthesizeKey("z", { accelKey: true });
  await TestUtils.waitForTick();
  Assert.equal(
    SessionStore.getClosedTabCountForWindow(window),
    closedBefore,
    "nothing reopened from a text field"
  );
  await closeSplit(c2.splitview);
});

add_task(async function test_private_window() {
  const win = await BrowserTestUtils.openNewBrowserWindow({ private: true });
  const { sv, tabs } = await threePaneSplit(win);
  Assert.equal(headerCount(win), 3, "private split shows three panes");
  for (const tab of tabs) {
    Assert.equal(await visibility(tab), "visible", "pane visible");
  }

  // A private split cannot move into a normal window.
  const normalTabs = gBrowser.tabs.length;
  const adopted = gBrowser.adoptSplitView(sv, { tabIndex: 0 });
  Assert.equal(adopted, null, "private split refused");
  Assert.equal(gBrowser.tabs.length, normalTabs, "no tabs added");
  Assert.equal(sv.tabs.length, 3, "private split intact");
  Assert.ok(
    tabs.every(t => !t.removedByAdoption),
    "no adoption state left on tabs"
  );

  // Dropping it on the normal tab strip is refused too.
  const effect = EventUtils.synthesizeDrop(
    tabs[0],
    gBrowser.tabs[0],
    [[{ type: TAB_DROP_TYPE, data: tabs[0] }]],
    null,
    win,
    window
  );
  Assert.equal(effect, "none", "drop refused");
  Assert.equal(sv.tabs.length, 3, "private split still intact");

  const closing = sv.tabs[2];
  win.gBrowser.removeTab(closing);
  await TestUtils.waitForCondition(() => sv.tabs.length == 2);
  Assert.equal(headerCount(win), 2, "closing a private pane keeps the split");
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_containers_move_to_new_window() {
  const a = await addLoadedTab(window, { userContextId: 1 });
  const b = await addLoadedTab(window, { userContextId: 2 });
  const c = await addLoadedTab(window);
  await BrowserTestUtils.switchTab(gBrowser, a);
  const sv = gBrowser.addTabSplitView([a, b], { insertBefore: a });
  sv.splitPane(a, "down", c);
  const layout = sv.state.layout;

  const newWindow = BrowserTestUtils.waitForNewWindow();
  gBrowser.replaceTabsWithWindow(b);
  const win = await newWindow;
  const moved = win.gBrowser.tabs[0].splitview;
  Assert.ok(moved, "split moved to the new window");
  Assert.deepEqual(
    moved.tabs.map(t => t.userContextId),
    [1, 2, 0],
    "each pane keeps its container"
  );
  Assert.deepEqual(moved.state.layout, layout, "layout moved intact");
  await TestUtils.waitForCondition(() => headerCount(win) == 3);
  for (const tab of moved.tabs) {
    Assert.equal(tab.linkedBrowser.currentURI.spec, PAGE, "page kept");
  }
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_drag_large_split_to_other_window() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  const { sv, tabs } = await threePaneSplit();
  const layout = sv.state.layout;
  const target = win.gBrowser.tabs[0];

  const opened = BrowserTestUtils.waitForEvent(win, "TabOpen");
  const effect = EventUtils.synthesizeDrop(
    tabs[2],
    target,
    [[{ type: TAB_DROP_TYPE, data: tabs[2] }]],
    null,
    window,
    win
  );
  Assert.equal(effect, "move", "split moves between windows");
  await opened;
  await TestUtils.waitForCondition(
    () => win.gBrowser.tabs.find(t => t.splitview)?.splitview.tabs.length == 3,
    "all three panes adopted"
  );
  const moved = win.gBrowser.tabs.find(t => t.splitview).splitview;
  Assert.deepEqual(moved.state.layout, layout, "layout survives the drag");
  Assert.ok(!sv.isConnected, "source split removed");
  Assert.ok(
    gBrowser.tabs.every(t => !t.splitview),
    "no split left in the source window"
  );
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_restore_with_wrong_tab_count() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  const tabEntry = url => ({ entries: [{ url, triggeringPrincipal_base64 }] });
  const state = {
    windows: [
      {
        tabs: [
          tabEntry("about:robots"),
          { ...tabEntry("about:mozilla"), splitViewId: 5 },
          { ...tabEntry("about:about"), splitViewId: 5 },
          { ...tabEntry("about:license"), splitViewId: 5 },
          { ...tabEntry("about:credits"), splitViewId: 6 },
          tabEntry("about:buildconfig"),
        ],
        selected: 1,
        splitViews: [
          // Saved count is too high; three tabs exist.
          { id: 5, numberOfTabs: 4, layout: { version: 1, root: "junk" } },
          // A split whose other member is missing.
          { id: 6, numberOfTabs: 2 },
        ],
      },
    ],
  };
  const restored = BrowserTestUtils.waitForEvent(win, "SSWindowStateReady");
  SessionStore.setWindowState(win, JSON.stringify(state), true);
  await restored;
  const wb = win.gBrowser;
  Assert.equal(wb.tabs.length, 6, "every saved tab is in the tab strip");
  Assert.ok(
    wb.tabs.every(t => t.isConnected),
    "no tab is left outside the document"
  );
  const split = wb.tabs[1].splitview;
  Assert.ok(split, "split with a stale count restored");
  Assert.equal(split.tabs.length, 3, "all three members kept");
  Assert.equal(split.state.numberOfTabs, 3, "count corrected");
  Assert.ok(!wb.tabs[4].splitview, "lone member restored as ordinary tab");
  Assert.equal(wb.splitViews.length, 1, "only one split view");
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_accessible_names_and_roles() {
  const accService = Cc["@mozilla.org/accessibilityService;1"].getService(
    Ci.nsIAccessibilityService
  );
  const { sv, tabs } = await threePaneSplit();
  const header = document.querySelector(
    `.split-pane-header[panel="${tabs[1].linkedPanel}"]`
  );
  await TestUtils.waitForCondition(
    () => header.querySelector(".split-pane-back").getAttribute("aria-label"),
    "header strings localized"
  );
  const name = el => accService.getAccessibleFor(el)?.name;
  const role = el => accService.getAccessibleFor(el)?.role;
  Assert.equal(name(header.querySelector(".split-pane-back")), "Back");
  Assert.equal(name(header.querySelector(".split-pane-forward")), "Forward");
  Assert.equal(name(header.querySelector(".split-pane-reload")), "Reload");
  Assert.equal(name(header.querySelector(".split-pane-close")), "Close pane");
  Assert.equal(name(header.querySelector(".split-pane-url")), "Pane address");
  Assert.equal(
    name(header.querySelector(".split-pane-menu")),
    "Split view options"
  );
  Assert.equal(role(header), Ci.nsIAccessibleRole.ROLE_TOOLBAR, "toolbar");
  for (const splitter of document.querySelectorAll(".split-pane-splitter")) {
    Assert.equal(role(splitter), Ci.nsIAccessibleRole.ROLE_SEPARATOR);
    Assert.equal(name(splitter), "Resize split view tabs");
    Assert.ok(splitter.hasAttribute("aria-valuenow"), "splitter has a value");
  }
  // Tabs in a split of three announce position without left or right.
  await TestUtils.waitForCondition(() =>
    tabs[2].getAttribute("aria-label")?.endsWith("Split view pane")
  );
  Assert.equal(tabs[2].getAttribute("aria-posinset"), "3");
  Assert.equal(tabs[2].getAttribute("aria-setsize"), "3");
  await closeSplit(sv);
});
