/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Recursive split view: N visible panes, pane chrome, close, focus, state.

const PAGE = "https://example.com/";

const { TabStateFlusher } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs"
);

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
