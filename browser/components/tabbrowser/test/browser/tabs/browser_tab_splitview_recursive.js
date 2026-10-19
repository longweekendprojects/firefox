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
    const header = document
      .getElementById(tab.linkedPanel)
      .querySelector(".split-pane-header");
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
  // Restore a saved layout: 0 | (1 over 2), ratio 0.3.
  const layout = {
    version: 1,
    root: {
      axis: "row",
      ratio: 0.3,
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
    document
      .getElementById(tab.linkedPanel)
      .querySelector(".split-pane-header");

  // Navigate pane B from its own address field.
  const input = header(b).querySelector(".split-pane-url");
  input.focus();
  input.value = "https://example.org/";
  const loaded = BrowserTestUtils.browserLoaded(
    b.linkedBrowser,
    false,
    "https://example.org/"
  );
  EventUtils.synthesizeKey("KEY_Enter");
  await loaded;
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

  // Cmd-L targets the selected pane's field. Navigating focused pane B,
  // which already selected it.
  if (gBrowser.selectedTab != b) {
    await BrowserTestUtils.switchTab(gBrowser, b);
  }
  document.getElementById("Browser:OpenLocation").doCommand();
  Assert.equal(
    document.activeElement,
    header(b).querySelector(".split-pane-url"),
    "location command focuses the pane field"
  );
  sv.close();
  await TestUtils.waitForCondition(() => !sv.isConnected);
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

function paneHeader(tab) {
  return document
    .getElementById(tab.linkedPanel)
    .querySelector(".split-pane-header");
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
  await TestUtils.waitForCondition(
    () =>
      document.activeElement ==
      paneHeader(pane).querySelector(".split-pane-url"),
    "the new pane's address field has focus"
  );
  for (const t of [...tab.splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
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

async function dragHeader(tab, target, fx, fy, part = ".split-pane-url") {
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

  await dragHeader(a, d, 0.5, 0.5);
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

  // A click without movement still focuses the pane's address field.
  const other = sv.tabs.find(t => !t.selected);
  const input = paneHeader(other).querySelector(".split-pane-url");
  EventUtils.synthesizeMouseAtCenter(input, {});
  await TestUtils.waitForCondition(
    () => document.activeElement == input,
    "a click focuses the address field"
  );
  Assert.equal(gBrowser.selectedTab, other, "and selects the pane");

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
