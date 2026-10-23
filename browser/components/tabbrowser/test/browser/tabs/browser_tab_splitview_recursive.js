/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Recursive split view: N visible panes, pane chrome, close, focus, state.

const PAGE = "https://example.com/";

const { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs"
);

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

async function addLoadedTab() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

function rect(tab) {
  const r = document.getElementById(tab.linkedPanel).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

async function visibility(tab) {
  return SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.document.visibilityState
  );
}

add_task(async function test_recursive_layout() {
  const [a, b, c, d] = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  await BrowserTestUtils.switchTab(gBrowser, a);
  const splitView = gBrowser.addTabSplitView([a, b], { insertBefore: a });
  splitView.splitPane(b, "down", c);
  splitView.splitPane(c, "right", d);
  await TestUtils.waitForCondition(() => splitView.tabs.length == 4);
  await TestUtils.waitForTick();

  // Guide layout: A | (B over (C | D)).
  const [ra, rb, rc, rd] = [a, b, c, d].map(rect);
  info(JSON.stringify({ ra, rb, rc, rd }));
  Assert.less(ra.x, rb.x, "A left of B");
  Assert.less(rb.y, rc.y, "B above C");
  Assert.equal(Math.round(rc.y), Math.round(rd.y), "C and D share a row");
  Assert.less(rc.x, rd.x, "C left of D");
  Assert.greater(ra.h, rb.h, "A spans full height");

  for (const tab of [a, b, c, d]) {
    Assert.equal(await visibility(tab), "visible", "every pane is visible");
    const header = document.querySelector(
      `.split-pane-header[panel="${tab.linkedPanel}"]`
    );
    Assert.ok(header, "pane has a header");
    await TestUtils.waitForCondition(() =>
      header.querySelector(".split-pane-url").value.includes("example.com")
    );
  }
  Assert.equal(
    document.querySelectorAll(".split-pane-splitter").length,
    3,
    "one splitter per split"
  );

  // Directional focus follows geometry.
  await BrowserTestUtils.switchTab(gBrowser, c);
  splitView.focusPane("up");
  Assert.equal(gBrowser.selectedTab, b, "C up selects B");
  splitView.focusPane("left");
  Assert.equal(gBrowser.selectedTab, a, "B left selects A");

  // Session state carries the tree.
  const { layout } = splitView.state;
  Assert.equal(layout.version, 1, "layout is versioned");
  Assert.equal(layout.root.axis, "row");

  // Closing a pane keeps the split and selects its neighbor.
  await BrowserTestUtils.switchTab(gBrowser, d);
  BrowserTestUtils.removeTab(d);
  await TestUtils.waitForCondition(() => splitView.tabs.length == 3);
  Assert.ok(splitView.isConnected, "split survives with three panes");
  Assert.equal(gBrowser.selectedTab, c, "neighbor pane selected");
  Assert.equal(
    document.querySelectorAll(".split-pane-splitter").length,
    2,
    "splitters follow the tree"
  );

  // Leaving the split removes all pane chrome.
  const other = await addLoadedTab();
  await BrowserTestUtils.switchTab(gBrowser, other);
  Assert.ok(!document.querySelector(".split-pane-header"), "headers removed");
  Assert.ok(!document.getElementById("split-pane-splitters"), "splitters gone");

  // Returning restores the layout.
  await BrowserTestUtils.switchTab(gBrowser, a);
  Assert.equal(
    document.querySelectorAll(".split-pane-header").length,
    3,
    "headers back"
  );

  BrowserTestUtils.removeTab(other);
  splitView.close();
  await TestUtils.waitForCondition(() => !splitView.isConnected);
  Assert.ok(!document.querySelector(".split-pane"), "no pane state left");
});

add_task(async function test_keyboard_resize_and_restore_layout() {
  const tabs = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
  // Restore a saved layout: 0 | (1 over 2), resized by hand to 0.3.
  const layout = {
    version: 1,
    root: {
      axis: "row",
      ratio: 0.3,
      manual: true,
      first: { id: 0 },
      second: {
        axis: "column",
        ratio: 0.5,
        first: { id: 1 },
        second: { id: 2 },
      },
    },
  };
  const splitView = gBrowser.addTabSplitView(tabs, {
    insertBefore: tabs[0],
    layout,
  });
  await TestUtils.waitForTick();
  Assert.deepEqual(splitView.state.layout, layout, "layout round-trips");
  const [r0, r1, r2] = tabs.map(rect);
  Assert.less(r0.w, r1.w, "saved ratio applied");
  Assert.less(r1.y, r2.y, "nested split restored");

  const splitter = document.querySelector(
    '.split-pane-splitter[data-axis="row"]'
  );
  splitter.focus();
  EventUtils.synthesizeKey("KEY_ArrowRight");
  Assert.greater(rect(tabs[0]).w, r0.w, "arrow key grows the first pane");
  for (let i = 0; i < 100; i++) {
    EventUtils.synthesizeKey("KEY_ArrowRight");
  }
  Assert.greaterOrEqual(rect(tabs[1]).w, 140, "minimum pane width kept");

  // Corrupt layout data falls back to a default layout.
  const fresh = [await addLoadedTab(), await addLoadedTab()];
  const fallback = gBrowser.addTabSplitView(fresh, {
    layout: { version: 99, root: "junk" },
  });
  Assert.equal(fallback.tabs.length, 2, "split still created");
  Assert.equal(fallback.state.layout.root.axis, "row", "default layout used");

  fallback.close();
  splitView.close();
  await TestUtils.waitForCondition(() => !splitView.isConnected);
});

add_task(async function test_split_view_releases_its_objects() {
  const tabs = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  const home = await addLoadedTab();
  const refs = [];
  for (let i = 0; i < 5; i++) {
    await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
    const sv = gBrowser.addTabSplitView(tabs.slice(0, 2), {
      insertBefore: tabs[0],
    });
    sv.splitPane(tabs[1], "down", tabs[2]);
    await TestUtils.waitForTick();
    for (const el of document.querySelectorAll(
      ".split-pane-header, #split-pane-splitters, .split-pane-splitter"
    )) {
      refs.push(Cu.getWeakReference(el));
    }
    refs.push(Cu.getWeakReference(sv));
    // Suspend, resume, then unsplit.
    await BrowserTestUtils.switchTab(gBrowser, home);
    await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
    sv.unsplitTabs();
    await TestUtils.waitForCondition(() => !sv.isConnected);
    await BrowserTestUtils.switchTab(gBrowser, home);
  }
  Assert.greater(refs.length, 20, "tracked pane objects");
  await TestUtils.waitForCondition(() => {
    Cu.forceGC();
    Cu.forceCC();
    return refs.every(r => !r.get());
  }, "every header, splitter, and wrapper is garbage collected");
  Assert.ok(!document.querySelector(".split-pane"), "no pane state left");
  Assert.ok(
    !gBrowser.tabpanels.hasAttribute("splitlayout"),
    "no layout state without a split"
  );
  for (const tab of [...tabs, home]) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_layout_survives_window_close_and_restore() {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  const wb = win.gBrowser;
  const add = async () => {
    const tab = BrowserTestUtils.addTab(wb, PAGE);
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    return tab;
  };
  const [a, b, c] = [await add(), await add(), await add()];
  await BrowserTestUtils.switchTab(wb, a);
  const sv = wb.addTabSplitView([a, b], { insertBefore: a });
  sv.splitPane(b, "down", c);
  sv.setLayoutRatio("", 0.3);
  // Leave a plain tab selected so the split restores as an inactive split.
  await BrowserTestUtils.switchTab(wb, wb.tabs[0]);
  const saved = sv.state.layout;
  await TabStateFlusher.flushWindow(win);
  await BrowserTestUtils.closeWindow(win);

  const restored = SessionStore.undoCloseWindow(0);
  let rsv;
  await TestUtils.waitForCondition(
    () =>
      (rsv = restored.gBrowser?.tabContainer?.querySelector(
        "tab-split-view-wrapper"
      )) && rsv.tabs.length == 3,
    "split view restored in reopened window"
  );
  Assert.ok(rsv, "split view restored");
  Assert.deepEqual(rsv.state.layout, saved, "tree and ratios restored");
  Assert.ok(
    rsv.tabs.every(t => !t.linkedPanel || t.hasAttribute("pending")),
    "inactive split panes stay lazy"
  );
  await BrowserTestUtils.closeWindow(restored);
});

add_task(async function test_pane_navigation_and_location() {
  const [a, b] = [await addLoadedTab(), await addLoadedTab()];
  await BrowserTestUtils.switchTab(gBrowser, a);
  const sv = gBrowser.addTabSplitView([a, b], { insertBefore: a });
  await TestUtils.waitForTick();
  const header = tab =>
    document.querySelector(`.split-pane-header[panel="${tab.linkedPanel}"]`);

  // Pane B's address field opens the command bar over B, which navigates B.
  header(b).querySelector(".split-pane-url").focus();
  await TestUtils.waitForCondition(
    () => commandBarOver(b),
    "command bar over B"
  );
  Assert.equal(gBrowser.selectedTab, b, "B is selected");
  const loaded = BrowserTestUtils.browserLoaded(
    b.linkedBrowser,
    false,
    "https://example.org/"
  );
  gURLBar.value = "https://example.org/";
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
  await TestUtils.waitForCondition(
    () => !commandBarOpen(),
    "the command bar closes after navigating"
  );
  Assert.equal(a.linkedBrowser.currentURI.spec, PAGE, "pane A did not move");
  await TestUtils.waitForCondition(
    () => !header(b).querySelector(".split-pane-back").hasAttribute("disabled"),
    "B back enabled"
  );
  Assert.ok(
    header(a).querySelector(".split-pane-back").hasAttribute("disabled"),
    "A back stays disabled"
  );

  // Back acts on B only.
  // Back may restore from the back-forward cache without a load event.
  header(b).querySelector(".split-pane-back").doCommand();
  await TestUtils.waitForCondition(
    () => b.linkedBrowser.currentURI.spec == PAGE,
    "B went back"
  );
  Assert.equal(
    a.linkedBrowser.currentURI.spec,
    PAGE,
    "pane A unaffected by B's back"
  );
  await TestUtils.waitForCondition(
    () =>
      !header(b).querySelector(".split-pane-forward").hasAttribute("disabled"),
    "B forward enabled"
  );

  // Cmd-L opens the command bar over the selected pane, and Escape closes it.
  await BrowserTestUtils.switchTab(gBrowser, a);
  document.getElementById("Browser:OpenLocation").doCommand();
  await TestUtils.waitForCondition(
    () => commandBarOver(a),
    "location command opens the command bar over A"
  );
  Assert.ok(gURLBar.value.includes("example.com"), "it shows A's address");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen(), "Escape closes it");
  Assert.ok(!gURLBar.focused, "the address bar lost focus");
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
});

add_task(async function test_location_opens_command_bar_on_plain_tab() {
  const tab = await addLoadedTab();
  await BrowserTestUtils.switchTab(gBrowser, tab);
  gURLBar.focus();
  Assert.ok(
    !commandBarOpen(),
    "focusing the toolbar address bar keeps it there"
  );
  gBrowser.selectedBrowser.focus();

  document.getElementById("Browser:OpenLocation").doCommand();
  await TestUtils.waitForCondition(
    () => commandBarOpen() && gURLBar.focused,
    "location command opens the command bar over a plain tab"
  );
  const bar = gURLBar.getBoundingClientRect();
  const page = gBrowser.selectedBrowser.getBoundingClientRect();
  Assert.ok(
    bar.left > page.left && bar.right < page.right && bar.top > page.top,
    "the command bar sits over the page"
  );
  Assert.ok(gURLBar.value.includes("example.com"), "it shows the address");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen(), "Escape closes it");
  Assert.ok(!gURLBar.hasAttribute("popover"), "the bar is back in the toolbar");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_command_bar_results_stay_under_it() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.urlbar.suggest.topsites", true],
      [
        "browser.newtabpage.activity-stream.default.sites",
        "https://example.org/,https://mozilla.org/",
      ],
    ],
  });
  const tab = await addLoadedTab();
  await BrowserTestUtils.switchTab(gBrowser, tab);
  gURLBar.focus();
  EventUtils.sendString("exa");
  await TestUtils.waitForCondition(
    () => gURLBar.view.isOpen,
    "results open in the toolbar first"
  );
  document.getElementById("Browser:OpenLocation").doCommand();
  await TestUtils.waitForCondition(
    () => commandBarOpen() && gURLBar.view.isOpen,
    "the command bar opens with its results"
  );
  await new Promise(r => requestAnimationFrame(r));
  const bar = gURLBar.getBoundingClientRect();
  const results = gURLBar.panel.getBoundingClientRect();
  Assert.lessOrEqual(
    Math.abs(results.left - bar.left) + Math.abs(results.right - bar.right),
    16,
    "the results are as wide as the bar"
  );
  Assert.greaterOrEqual(
    results.top,
    bar.bottom - 8,
    "the results start below the input"
  );

  EventUtils.sendString("typed");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen(), "Escape closes it");
  document.getElementById("Browser:OpenLocation").doCommand();
  await TestUtils.waitForCondition(() => commandBarOpen() && gURLBar.focused);
  Assert.ok(
    gURLBar.value.includes("example.com"),
    "Escape threw away the typed text"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen());
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_new_tab_opens_command_bar() {
  const tab = await addLoadedTab();
  await BrowserTestUtils.switchTab(gBrowser, tab);
  const tabCount = gBrowser.tabs.length;
  const pageURL = tab.linkedBrowser.currentURI.spec;

  EventUtils.synthesizeKey("t", { accelKey: true });
  await TestUtils.waitForCondition(
    () => commandBarOver(tab),
    "Cmd+T opens the command bar over the page"
  );
  Assert.equal(gURLBar.value, "", "the command bar starts empty");
  Assert.equal(gBrowser.tabs.length, tabCount, "no tab opens yet");

  EventUtils.sendString("typed");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen(), "Escape closes it");
  Assert.equal(gBrowser.tabs.length, tabCount, "Escape opens no tab");
  Assert.ok(
    !gURLBar.value.includes("typed"),
    "Escape threw away the typed text"
  );

  EventUtils.synthesizeKey("t", { accelKey: true });
  await TestUtils.waitForCondition(() => commandBarOver(tab));
  const opened = BrowserTestUtils.waitForNewTab(
    gBrowser,
    "https://example.org/",
    true
  );
  EventUtils.sendString("https://example.org/");
  EventUtils.synthesizeKey("KEY_Enter");
  const newTab = await opened;
  Assert.equal(gBrowser.selectedTab, newTab, "Enter opens a new tab");
  Assert.equal(
    tab.linkedBrowser.currentURI.spec,
    pageURL,
    "the page under the command bar stays put"
  );
  await TestUtils.waitForCondition(() => !commandBarOpen());
  Assert.ok(!gURLBar.commandBarNewTab, "the new tab mode ends");

  await BrowserTestUtils.switchTab(gBrowser, tab);
  Assert.ok(
    gURLBar.value.includes(new URL(pageURL).host),
    "the old tab still shows its own address"
  );
  document.getElementById("Browser:OpenLocation").doCommand();
  await TestUtils.waitForCondition(() => commandBarOver(tab));
  Assert.ok(
    gURLBar.value.includes(new URL(pageURL).host),
    "Cmd+L still edits the page address"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen());
  BrowserTestUtils.removeTab(newTab);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_new_tab_command_bar_centers_over_split() {
  const tabs = [await addLoadedTab(), await addLoadedTab()];
  await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
  const sv = gBrowser.addTabSplitView(tabs, { insertBefore: tabs[0] });
  await TestUtils.waitForCondition(() => sv.hasActiveTab);
  gBrowser.selectedBrowser.focus();

  EventUtils.synthesizeKey("t", { accelKey: true });
  await TestUtils.waitForCondition(
    () => commandBarOpen() && gURLBar.focused,
    "Cmd+T opens the command bar"
  );
  const bar = gURLBar.getBoundingClientRect();
  const area = gBrowser.tabpanels.getBoundingClientRect();
  Assert.lessOrEqual(
    Math.abs(bar.left + bar.width / 2 - (area.left + area.width / 2)),
    2,
    "the new-tab command bar centers over the whole window, not a pane"
  );
  Assert.ok(
    !commandBarOver(tabs[0]) && !commandBarOver(tabs[1]),
    "it does not sit inside one pane"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen());
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
});

add_task(async function test_command_bar_autofills_open_tab_site() {
  await PlacesUtils.history.clear();
  const tab = await addLoadedTab();
  const other = BrowserTestUtils.addTab(gBrowser, "about:blank");
  await BrowserTestUtils.switchTab(gBrowser, other);

  EventUtils.synthesizeKey("t", { accelKey: true });
  await TestUtils.waitForCondition(
    () => commandBarOpen() && gURLBar.focused,
    "Cmd+T opens the command bar"
  );
  EventUtils.sendString("examp");
  await TestUtils.waitForCondition(
    () => gURLBar.value == "example.com/",
    "the open tab's site is filled in"
  );
  Assert.equal(gURLBar.selectionStart, 5, "the typed part stays put");
  Assert.equal(
    gURLBar.selectionEnd,
    gURLBar.value.length,
    "the filled-in part is selected"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen());
  BrowserTestUtils.removeTab(other);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_extension_style_move_keeps_large_split() {
  const tabs = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
  const sv = gBrowser.addTabSplitView(tabs, { insertBefore: tabs[0] });
  gBrowser.moveTabToEnd(tabs[1]);
  Assert.equal(sv.tabs.length, 3, "moving one pane moves the whole split");
  Assert.ok(sv.isConnected, "split survives");
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
});

add_task(async function test_accel_shift_c_copies_pane_address() {
  const url = "https://example.com/browser/";
  const tab1 = await addLoadedTab();
  const tab2 = BrowserTestUtils.addTab(gBrowser, url);
  await BrowserTestUtils.browserLoaded(tab2.linkedBrowser);
  const splitview = gBrowser.addTabSplitView([tab1, tab2]);
  gBrowser.selectedTab = tab2;
  await TestUtils.waitForCondition(() => splitview.hasActiveTab);
  const copy = () =>
    AppConstants.platform == "macosx"
      ? EventUtils.synthesizeKey("C", { accelKey: true, shiftKey: true })
      : document.getElementById("Browser:CopyPageLink").doCommand();
  await SimpleTest.promiseClipboardChange(url, copy);
  Assert.ok(true, "The selected pane's address is copied");
  gBrowser.removeTab(tab1);
  gBrowser.removeTab(tab2);
});

function commandBarOpen() {
  return gURLBar.matches(":popover-open");
}

function commandBarOver(tab) {
  if (!commandBarOpen() || !gURLBar.focused) {
    return false;
  }
  const bar = gURLBar.getBoundingClientRect();
  const pane = document.getElementById(tab.linkedPanel).getBoundingClientRect();
  return (
    bar.width > 0 &&
    bar.left >= pane.left &&
    bar.right <= pane.right &&
    bar.top >= pane.top &&
    bar.bottom <= pane.bottom
  );
}

function paneHeader(tab) {
  return document.querySelector(
    `.split-pane-header[panel="${tab.linkedPanel}"]`
  );
}

async function splitFourWays(tab) {
  gBrowser.selectedTab = tab;
  await SimpleTest.promiseFocus(window);
  for (const direction of ["right", "down", "left"]) {
    const count = tab.splitview?.tabs.length ?? 1;
    BrowserCommands.splitPane(direction);
    await TestUtils.waitForCondition(
      () => tab.splitview?.tabs.length == count + 1,
      `split ${direction}`
    );
  }
  return tab.splitview;
}

add_task(async function test_new_pane_is_blank_with_focused_address() {
  const tab = await addLoadedTab();
  gBrowser.selectedTab = tab;
  await SimpleTest.promiseFocus(window);
  BrowserCommands.splitPane("right");
  await TestUtils.waitForCondition(() => tab.splitview, "split created");
  const pane = gBrowser.selectedTab;
  Assert.notEqual(pane, tab, "the new pane is selected");
  Assert.equal(
    pane.linkedBrowser.currentURI.spec,
    "about:blank",
    "the new pane starts blank"
  );
  Assert.ok(
    BookmarkingUI.isSplitOnNewTabPage(tab.splitview),
    "the bookmarks toolbar treats a split with an empty pane as a new tab"
  );
  Assert.ok(
    !BookmarkingUI.isOnNewTabPage(tab.linkedBrowser.currentURI),
    "though its other pane shows a site"
  );
  await TestUtils.waitForCondition(
    () => commandBarOver(pane),
    "the command bar opens over the new pane"
  );
  Assert.equal(gURLBar.value, "", "the command bar starts empty");
  for (const t of [...tab.splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_split_pane_from_plain_tab_builds_once() {
  for (const direction of ["right", "left", "up", "down"]) {
    const tab = await addLoadedTab();
    await BrowserTestUtils.switchTab(gBrowser, tab);
    await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      const sizes = (content.wrappedJSObject.sizes = []);
      content.addEventListener("resize", () =>
        sizes.push(`${content.innerWidth}x${content.innerHeight}`)
      );
    });
    const tabCount = gBrowser.tabs.length;
    let layoutChanges = 0;
    const onLayout = () => layoutChanges++;
    gBrowser.tabContainer.addEventListener("SplitViewLayoutChanged", onLayout);
    BrowserCommands.splitPane(direction);
    await TestUtils.waitForCondition(() => tab.splitview, "split created");
    const splitview = tab.splitview;
    await new Promise(r => requestAnimationFrame(r));
    await TestUtils.waitForTick();
    gBrowser.tabContainer.removeEventListener(
      "SplitViewLayoutChanged",
      onLayout
    );

    is(gBrowser.tabs.length, tabCount + 1, `${direction}: one new tab`);
    is(splitview.tabs.length, 2, `${direction}: two panes`);
    is(layoutChanges, 0, `${direction}: the layout is built once`);
    const pane = splitview.tabs.find(t => t != tab);
    const a = rect(tab);
    const b = rect(pane);
    const placed = {
      right: b.x >= a.x + a.w - 1,
      left: b.x + b.w <= a.x + 1,
      up: b.y + b.h <= a.y + 1,
      down: b.y >= a.y + a.h - 1,
    }[direction];
    ok(placed, `${direction}: the new pane is on that side`);
    for (let i = 0; i < 10; i++) {
      await new Promise(r => requestAnimationFrame(r));
    }
    const sizes = await SpecialPowers.spawn(
      tab.linkedBrowser,
      [],
      () => content.wrappedJSObject.sizes
    );
    is(
      sizes.length,
      1,
      `${direction}: the page resizes once, to its pane (${sizes.join(", ")})`
    );
    for (const t of [...splitview.tabs]) {
      BrowserTestUtils.removeTab(t);
    }
  }
});

add_task(async function test_window_navigation_hidden_while_panes_show() {
  const ids = ["back-button", "forward-button", "urlbar-container"];
  const visible = id =>
    document.getElementById(id).checkVisibility({ visibilityProperty: true });
  const tab = await addLoadedTab();
  const other = await addLoadedTab();
  for (const id of ids) {
    Assert.ok(visible(id), `${id} shows without a split`);
  }
  const sv = gBrowser.addTabSplitView([tab, gBrowser.addTrustedTab(PAGE)], {
    insertBefore: tab,
  });
  await BrowserTestUtils.switchTab(gBrowser, tab);
  for (const id of ids) {
    Assert.ok(!visible(id), `${id} hides while panes show`);
  }
  await BrowserTestUtils.switchTab(gBrowser, other);
  for (const id of ids) {
    Assert.ok(visible(id), `${id} shows again outside the split`);
  }
  sv.close();
  BrowserTestUtils.removeTab(other);
});

add_task(async function test_top_pane_headers_share_the_toolbar_row() {
  const [a, b, c] = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  await BrowserTestUtils.switchTab(gBrowser, a);
  const sv = gBrowser.addTabSplitView([a, b], { insertBefore: a });
  sv.splitPane(b, "down", c);
  await TestUtils.waitForCondition(() => sv.tabs.length == 3);
  await TestUtils.waitForTick();
  await new Promise(r => requestAnimationFrame(r));
  const navbar = document.getElementById("nav-bar");
  const inToolbar = tab => navbar.contains(paneHeader(tab));
  Assert.ok(inToolbar(a), "top-left pane header is in the toolbar row");
  Assert.ok(inToolbar(b), "top-right pane header is in the toolbar row");
  Assert.ok(!inToolbar(c), "lower pane keeps its header in the pane");
  const bar = navbar.getBoundingClientRect();
  const header = paneHeader(b).getBoundingClientRect();
  Assert.greaterOrEqual(header.top, bar.top - 1, "header within the row");
  Assert.lessOrEqual(header.bottom, bar.bottom + 1, "header within the row");
  const menu = document
    .getElementById("PanelUI-menu-button")
    .getBoundingClientRect();
  Assert.lessOrEqual(header.right, menu.left, "menu button stays clear");
  Assert.greater(
    rect(a).h,
    rect(c).h,
    "top pane has no header of its own, so it is taller"
  );
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
  Assert.ok(
    !document.getElementById("split-pane-toolbar"),
    "toolbar row cleaned up"
  );
});

add_task(async function test_pane_reload_and_close_buttons() {
  const [a, b, c] = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  await BrowserTestUtils.switchTab(gBrowser, a);
  const sv = gBrowser.addTabSplitView([a, b, c], { insertBefore: a });
  await TestUtils.waitForTick();

  const reloaded = BrowserTestUtils.browserLoaded(b.linkedBrowser);
  paneHeader(b).querySelector(".split-pane-reload").doCommand();
  await reloaded;
  Assert.ok(true, "Reload reloads its own pane");

  paneHeader(b).querySelector(".split-pane-close").doCommand();
  await TestUtils.waitForCondition(() => !b.isConnected, "pane B closed");
  Assert.deepEqual(sv.tabs, [a, c], "only pane B left the split");
  Assert.ok(gBrowser.selectedTab.linkedBrowser, "selected tab is alive");
  sv.close();
});

add_task(async function test_accel_w_closes_panes_with_animation() {
  // Real windows animate tab closing; the test profile normally does not.
  window.gReduceMotionOverride = false;
  const tab = await addLoadedTab();
  const sv = await splitFourWays(tab);
  for (let remaining = 3; remaining >= 1; remaining--) {
    const closing = gBrowser.selectedTab;
    EventUtils.synthesizeKey("w", { accelKey: true });
    // A click on the closing pane must not select it again.
    const panel = document.getElementById(closing.linkedPanel);
    if (panel?.isConnected) {
      EventUtils.synthesizeMouseAtCenter(panel.querySelector("browser"), {});
    }
    await TestUtils.waitForCondition(
      () => !closing.isConnected,
      `Accel+W closes the pane (${remaining} left)`
    );
    const selected = gBrowser.selectedTab;
    Assert.ok(!selected.closing && selected.linkedBrowser, "selection alive");
    if (remaining > 1) {
      Assert.equal(selected.splitview, sv, "a pane of the split is selected");
      Assert.equal(sv.tabs.length, remaining, "one pane fewer");
    }
  }
  Assert.ok(!gBrowser.selectedTab.splitview, "the last pane is a normal tab");
  window.gReduceMotionOverride = null;
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

add_task(async function test_accel_w_after_clicking_a_pane() {
  window.gReduceMotionOverride = false;
  const tab = await addLoadedTab();
  const sv = await splitFourWays(tab);
  for (const target of [tab, sv.tabs.find(t => t != tab)]) {
    await EventUtils.synthesizeMouseAtCenter(
      document.getElementById(target.linkedPanel).querySelector("browser"),
      {}
    );
    await TestUtils.waitForCondition(
      () => gBrowser.selectedTab == target,
      "clicking a pane selects it"
    );
    EventUtils.synthesizeKey("w", { accelKey: true });
    await TestUtils.waitForCondition(
      () => !target.isConnected,
      "Accel+W closes the clicked pane"
    );
    Assert.ok(gBrowser.selectedTab.linkedBrowser, "selection alive");
  }
  window.gReduceMotionOverride = null;
  for (const t of [...sv.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

async function dragHeader(
  tab,
  target,
  fx,
  fy,
  part = ".split-pane-url",
  beforeDrop = null
) {
  // Every part of the pane bar is a drag handle.
  gBrowser.selectedBrowser.focus();
  const handle = paneHeader(tab).querySelector(part);
  const panel = document.getElementById(target.linkedPanel);
  const from = handle.getBoundingClientRect();
  const to = panel.getBoundingClientRect();
  const start = {
    x: from.left + from.width / 2,
    y: from.top + from.height / 2,
  };
  const end = { x: to.left + to.width * fx, y: to.top + to.height * fy };
  const at = (x, y, type) =>
    EventUtils.synthesizeMouseAtPoint(
      x,
      y,
      { type, buttons: type == "mouseup" ? 0 : 1 },
      window
    );
  at(start.x, start.y, "mousedown");
  for (let i = 1; i <= 5; i++) {
    at(
      start.x + ((end.x - start.x) * i) / 5,
      start.y + ((end.y - start.y) * i) / 5,
      "mousemove"
    );
    await TestUtils.waitForTick();
  }
  await beforeDrop?.();
  at(end.x, end.y, "mouseup");
  await TestUtils.waitForTick();
}

add_task(async function test_drag_pane_header_moves_pane() {
  const tab = await addLoadedTab();
  const sv = await splitFourWays(tab);
  const M = ChromeUtils.importESModule(
    "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
  );
  const before = M.leafIds(sv.layout);
  const [a, , , d] = before;

  await dragHeader(a, d, 0.5, 0.5, undefined, async () => {
    const indicator = document.querySelector(".split-pane-drop");
    Assert.equal(indicator.getAttribute("zone"), "swap", "a center drop swaps");
    const swap = indicator.querySelector(".split-pane-drop-swap");
    await TestUtils.waitForCondition(() => swap.textContent, "swap text");
    Assert.ok(swap.getBoundingClientRect().width, "the swap label shows");
    Assert.equal(swap.textContent, "Swap panes", "and says it swaps");
  });
  Assert.deepEqual(
    M.leafIds(sv.layout),
    before.map(
      t => ({ [a.linkedPanel]: d, [d.linkedPanel]: a })[t.linkedPanel] ?? t
    ),
    "dropping on a pane's center swaps the two panes"
  );

  const order = M.leafIds(sv.layout);
  const [first, second] = order;
  await dragHeader(first, second, 0.95, 0.5);
  const after = M.leafIds(sv.layout);
  Assert.equal(after.length, 4, "no pane lost");
  Assert.equal(
    after.indexOf(first),
    after.indexOf(second) + 1,
    "dropping on a pane's right edge places the pane after it"
  );
  const rf = rect(first);
  const rs = rect(second);
  Assert.greater(rf.x, rs.x, "the moved pane sits to the right");

  // Off center, a drop splits the pane rather than swapping with it.
  const [g, h] = M.leafIds(sv.layout);
  await dragHeader(g, h, 0.5, 0.65, undefined, () => {
    const indicator = document.querySelector(".split-pane-drop");
    Assert.equal(indicator.getAttribute("zone"), "down", "near center splits");
    Assert.equal(
      indicator.querySelector(".split-pane-drop-swap").getBoundingClientRect()
        .width,
      0,
      "and shows no swap label"
    );
  });
  Assert.equal(M.leafIds(sv.layout).length, 4, "no pane lost on a split");
  Assert.ok(
    !document.querySelector(".split-pane-drop"),
    "the drop indicator is removed"
  );

  // A drag that starts on a button moves the pane and does not press it.
  const [p, q] = M.leafIds(sv.layout);
  let closed = false;
  const onClose = () => (closed = true);
  gBrowser.tabContainer.addEventListener("TabClose", onClose);
  await dragHeader(p, q, 0.5, 0.5, ".split-pane-close");
  gBrowser.tabContainer.removeEventListener("TabClose", onClose);
  Assert.ok(!closed && p.isConnected, "the close button was not pressed");
  Assert.equal(M.leafIds(sv.layout)[1], p, "dragging from a button swaps");

  // A plain click on a pane bar button still presses it.
  const victim = sv.tabs.find(t => !t.selected);
  EventUtils.synthesizeMouseAtCenter(
    paneHeader(victim).querySelector(".split-pane-close"),
    {}
  );
  await TestUtils.waitForCondition(
    () => !victim.isConnected,
    "a click on Close closes the pane"
  );

  // A click without movement on the address field opens the command bar.
  const other = sv.tabs.find(t => !t.selected);
  const input = paneHeader(other).querySelector(".split-pane-url");
  EventUtils.synthesizeMouseAtCenter(input, {});
  await TestUtils.waitForCondition(
    () => commandBarOver(other),
    "a click opens the command bar over the pane"
  );
  Assert.equal(gBrowser.selectedTab, other, "and selects the pane");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !commandBarOpen());

  for (const t of [...sv.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_panes_resize_evenly() {
  const tab = await addLoadedTab();
  gBrowser.selectedTab = tab;
  await SimpleTest.promiseFocus(window);
  for (let i = 0; i < 2; i++) {
    const count = tab.splitview?.tabs.length ?? 1;
    BrowserCommands.splitPane("right");
    await TestUtils.waitForCondition(
      () => tab.splitview?.tabs.length == count + 1
    );
  }
  const sv = tab.splitview;
  await TestUtils.waitForTick();
  const widths = () => sv.tabs.map(t => Math.round(rect(t).w));
  const [w0, w1, w2] = widths();
  Assert.lessOrEqual(Math.max(w0, w1, w2) - Math.min(w0, w1, w2), 2, "thirds");
  BrowserTestUtils.removeTab(sv.tabs[2]);
  await TestUtils.waitForCondition(() => sv.tabs.length == 2);
  await TestUtils.waitForTick();
  const [h0, h1] = widths();
  Assert.lessOrEqual(Math.abs(h0 - h1), 2, "back to halves after a close");
  Assert.greater(h0, w0 * 1.3, "the remaining panes grew");
  gBrowser.selectedBrowser.focus();
  Assert.equal(
    paneHeader(tab).querySelector(".split-pane-url").value,
    "example.com",
    "an unfocused address field shows only the site"
  );
  for (const t of [...sv.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_collapsed_sidebar_folds_large_splits() {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  SidebarController._state.launcherExpanded = false;
  await TestUtils.waitForCondition(
    () => !gBrowser.tabContainer.hasAttribute("expanded")
  );
  const tabs = [];
  for (let i = 0; i < 4; i++) {
    tabs.push(await addLoadedTab());
  }
  const [a, b, c, d] = tabs;
  await BrowserTestUtils.switchTab(gBrowser, a);
  const sv = gBrowser.addTabSplitView([a, b], { insertBefore: a });
  sv.splitPane(b, "right", c);
  sv.splitPane(c, "right", d);
  await TestUtils.waitForCondition(() => sv.tabs.length == 4);
  await BrowserTestUtils.switchTab(gBrowser, c);
  const shown = () => sv.tabs.filter(t => t.getBoundingClientRect().height);

  await TestUtils.waitForCondition(() => shown().length == 1);
  Assert.deepEqual(shown(), [c], "a folded split shows only its pane");
  Assert.equal(sv.getAttribute("hiddenpanes"), "+3", "and a pane count");

  const r = sv.getBoundingClientRect();
  const count = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
  Assert.equal(count, sv, "the pane count is part of the split");
  EventUtils.synthesizeMouseAtPoint(r.left + r.width / 2, r.bottom - 6, {});
  await TestUtils.waitForCondition(() => shown().length == 4);
  Assert.ok(sv.hasAttribute("unfolded"), "clicking the count unfolds");
  Assert.equal(gBrowser.selectedTab, c, "and keeps the selected pane");

  const other = await addLoadedTab();
  await BrowserTestUtils.switchTab(gBrowser, other);
  Assert.ok(!sv.hasAttribute("unfolded"), "leaving the split folds it");
  Assert.deepEqual(shown(), [c], "a folded split keeps its last pane");

  SidebarController._state.launcherExpanded = true;
  await TestUtils.waitForCondition(() =>
    gBrowser.tabContainer.hasAttribute("expanded")
  );
  Assert.equal(shown().length, 4, "four panes fit in one expanded row");

  const e = await addLoadedTab();
  const f = await addLoadedTab();
  sv.splitPane(d, "right", e);
  sv.splitPane(e, "right", f);
  await TestUtils.waitForCondition(() => sv.tabs.length == 6);
  await TestUtils.waitForCondition(() => shown().length == 1);
  Assert.deepEqual(shown(), [c], "six panes fold in the expanded sidebar");
  Assert.equal(sv.getAttribute("hiddenpanes"), "+5", "with a pane count");
  const row = sv.getBoundingClientRect();
  EventUtils.synthesizeMouseAtPoint(
    row.right - 8,
    row.top + row.height / 2,
    {}
  );
  await TestUtils.waitForCondition(() => shown().length == 6);
  const tops = shown().map(t => Math.round(t.getBoundingClientRect().top));
  Assert.equal(new Set(tops).size, 6, "an unfolded split lists one per row");

  for (const tab of [...sv.tabs, other]) {
    BrowserTestUtils.removeTab(tab);
  }
  await SpecialPowers.popPrefEnv();
});

add_task(
  async function test_empty_command_bar_lists_recent_tabs_and_searches() {
    const { FormHistory } = ChromeUtils.importESModule(
      "resource://gre/modules/FormHistory.sys.mjs"
    );
    const { UrlbarTestUtils } = ChromeUtils.importESModule(
      "resource://testing-common/UrlbarTestUtils.sys.mjs"
    );
    const { UrlbarShared } = ChromeUtils.importESModule(
      "chrome://browser/content/urlbar/UrlbarShared.mjs"
    );
    const { SearchService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/search/SearchService.sys.mjs"
    );
    UrlbarTestUtils.init(this);
    const engine = await SearchService.getDefault();
    const now = Date.now() * 1000;
    await FormHistory.update(
      ["one", "two", "three"].map((value, i) => ({
        op: "add",
        fieldname: "searchbar-history",
        value: `recent ${value}`,
        source: engine.name,
        firstUsed: now - (3 - i) * 1000,
        lastUsed: now - (3 - i) * 1000,
      }))
    );
    const tabs = [];
    for (const path of ["a", "b", "c", "d"]) {
      const tab = BrowserTestUtils.addTab(gBrowser, `${PAGE}?${path}`);
      await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
      await BrowserTestUtils.switchTab(gBrowser, tab);
      tabs.push(tab);
    }

    EventUtils.synthesizeKey("t", { accelKey: true });
    await TestUtils.waitForCondition(() => commandBarOpen());
    await UrlbarTestUtils.promiseSearchComplete(window);
    const results = [];
    for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
      results.push(await UrlbarTestUtils.getDetailsOfResultAt(window, i));
    }
    Assert.deepEqual(
      results.slice(0, 3).map(r => r.url),
      [`${PAGE}?c`, `${PAGE}?b`, `${PAGE}?a`],
      "The three most recent other tabs come first, newest first"
    );
    Assert.ok(
      results
        .slice(0, 3)
        .every(r => r.type == UrlbarShared.RESULT_TYPE.TAB_SWITCH),
      "They switch to the tab"
    );
    Assert.deepEqual(
      results.slice(3).map(r => r.searchParams?.suggestion),
      ["recent three", "recent two"],
      "Then the two most recent searches, and nothing else"
    );

    EventUtils.synthesizeKey("KEY_ArrowDown");
    EventUtils.synthesizeKey("KEY_Enter");
    await TestUtils.waitForCondition(
      () => gBrowser.selectedTab == tabs[2],
      "Arrow down and Enter switch to the most recent tab"
    );
    await TestUtils.waitForCondition(() => !commandBarOpen());

    for (const tab of tabs) {
      BrowserTestUtils.removeTab(tab);
    }
    await FormHistory.update({ op: "remove", fieldname: "searchbar-history" });
  }
);

add_task(async function test_icon_only_panes_center_their_icon() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
  await TestUtils.waitForCondition(
    () => gBrowser.tabContainer.verticalMode,
    "Tabs are vertical"
  );
  SidebarController._state.launcherExpanded = true;
  SidebarController._state.expandedLauncherWidth = 160;
  const tabs = [
    await addLoadedTab(),
    await addLoadedTab(),
    await addLoadedTab(),
  ];
  gBrowser.addTabSplitView(tabs);
  await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
  await TestUtils.waitForCondition(() =>
    tabs.every(
      tab =>
        getComputedStyle(tab.querySelector(".tab-label-container")).display ==
        "none"
    )
  );
  for (const tab of tabs) {
    const pane = tab.querySelector(".tab-background").getBoundingClientRect();
    const icon = tab.querySelector(".tab-icon-image").getBoundingClientRect();
    Assert.less(
      Math.abs(icon.left + icon.width / 2 - (pane.left + pane.width / 2)),
      1,
      "The icon sits in the center of its pane"
    );
  }
  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_split_row_matches_a_tab_row() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
  await TestUtils.waitForCondition(
    () => gBrowser.tabContainer.verticalMode,
    "Tabs are vertical"
  );
  SidebarController._state.launcherExpanded = true;
  await TestUtils.waitForCondition(() =>
    gBrowser.tabContainer.hasAttribute("expanded")
  );
  const before = await addLoadedTab();
  const single = await addLoadedTab();
  const tabs = [await addLoadedTab(), await addLoadedTab()];
  gBrowser.addTabSplitView(tabs);
  const splitview = tabs[0].splitview;
  await TestUtils.waitForCondition(
    () => splitview.getBoundingClientRect().height
  );
  const tab = single.querySelector(".tab-background").getBoundingClientRect();
  const row = splitview.getBoundingClientRect();
  for (const [name, a, b] of [
    ["left edge", row.left, tab.left],
    ["right edge", row.right, tab.right],
    ["height", row.height, tab.height],
  ]) {
    Assert.less(Math.abs(a - b), 1, `The split row has a tab's ${name}`);
  }
  const above = before.querySelector(".tab-background").getBoundingClientRect();
  const tabGap = tab.top - above.bottom;
  Assert.lessOrEqual(tabGap, 6, "Tab rows sit close together");
  Assert.less(
    Math.abs(row.top - tab.bottom - tabGap),
    1,
    "A split row keeps the same gap as a tab row"
  );
  for (const t of [before, single, ...tabs]) {
    BrowserTestUtils.removeTab(t);
  }
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_split_pinned_tab() {
  const tab = await addLoadedTab();
  gBrowser.pinTab(tab);
  await BrowserTestUtils.switchTab(gBrowser, tab);
  const browser = tab.linkedBrowser;
  const pinnedBefore = gBrowser.pinnedTabCount;
  BrowserCommands.splitPane("right");
  const splitview = tab.splitview;
  Assert.ok(splitview, "The pinned tab's page joins a split");
  Assert.ok(!tab.pinned, "The page moved into the regular tabs");
  Assert.equal(tab.linkedBrowser, browser, "The page did not reload");
  Assert.equal(
    gBrowser.pinnedTabCount,
    pinnedBefore,
    "The pinned tabs keep their count"
  );
  const pinned = gBrowser.tabs.find(t => t.pinned);
  Assert.equal(
    pinned.getAttribute("pinned-url"),
    PAGE,
    "The pinned tab keeps its pinned address"
  );
  await TestUtils.waitForCondition(
    () => !pinned.linkedPanel || pinned.hasAttribute("pending"),
    "The pinned tab that stays behind does not load its page"
  );
  for (const t of [...splitview.tabs, pinned]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_narrow_panes_show_their_title() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
  await TestUtils.waitForCondition(
    () => gBrowser.tabContainer.verticalMode,
    "Tabs are vertical"
  );
  SidebarController._state.launcherExpanded = true;
  SidebarController._state.expandedLauncherWidth = 200;
  const tabs = [await addLoadedTab(), await addLoadedTab()];
  gBrowser.addTabSplitView(tabs);
  await TestUtils.waitForCondition(
    () => tabs[0].getBoundingClientRect().width < 100,
    "The panes are narrow"
  );
  for (const tab of tabs) {
    Assert.notEqual(
      getComputedStyle(tab.querySelector(".tab-label-container")).display,
      "none",
      "A pane under 100 pixels wide still shows its title"
    );
  }
  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_new_tab_button_keeps_the_tab_gap() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
      ["browser.tabs.vertical.newTabButtonAtTop", true],
    ],
  });
  SidebarController._state.launcherExpanded = true;
  await TestUtils.waitForCondition(() =>
    gBrowser.tabContainer.hasAttribute("expanded")
  );
  const extra = await addLoadedTab();
  const button = gBrowser.tabContainer.arrowScrollbox.scrollbox.querySelector(
    "#tabs-list-newtab-button"
  );
  await TestUtils.waitForCondition(
    () => button.getBoundingClientRect().height,
    "The New Tab button shows"
  );
  const bg = tab =>
    tab.querySelector(".tab-background").getBoundingClientRect();
  const [first, second] = gBrowser.visibleTabs.filter(t => !t.pinned);
  const tabGap = bg(second).top - bg(first).bottom;
  const buttonRect = button.getBoundingClientRect();
  info(`tab gap ${tabGap}, button ${buttonRect.top}-${buttonRect.bottom}`);
  Assert.lessOrEqual(tabGap, 5, "Tab rows sit close together");
  Assert.less(
    Math.abs(bg(first).top - buttonRect.bottom - tabGap),
    1,
    "The New Tab button sits one tab gap above the first tab"
  );
  BrowserTestUtils.removeTab(extra);
  await SpecialPowers.popPrefEnv();
});
