/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Taking a pane out of a split: from its bar's context menu, or by dragging
// its bar onto the tab strip.

const PAGE = "https://example.com/";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
});

async function addLoadedTab() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

async function makeSplit(count) {
  const tabs = [];
  for (let i = 0; i < count; i++) {
    tabs.push(await addLoadedTab());
  }
  gBrowser.addTabSplitView(tabs.slice(0, 2), { insertBefore: tabs[0] });
  for (const tab of tabs.slice(2)) {
    tabs[0].splitview.splitPane(tabs[0], "right", tab);
  }
  gBrowser.selectedTab = tabs[0];
  await TestUtils.waitForCondition(
    () => paneHeader(tabs[0]),
    "pane bars are shown"
  );
  return tabs;
}

function paneHeader(tab) {
  return document.querySelector(
    `.split-pane-header[panel="${tab.linkedPanel}"]`
  );
}

async function dragHeaderTo(tab, x, y, beforeDrop) {
  gBrowser.selectedBrowser.focus();
  const handle = paneHeader(tab).querySelector(".split-pane-url");
  const from = handle.getBoundingClientRect();
  const start = {
    x: from.left + from.width / 2,
    y: from.top + from.height / 2,
  };
  const at = (px, py, type) =>
    EventUtils.synthesizeMouseAtPoint(
      px,
      py,
      { type, buttons: type == "mouseup" ? 0 : 1 },
      window
    );
  at(start.x, start.y, "mousedown");
  for (let i = 1; i <= 6; i++) {
    at(
      start.x + ((x - start.x) * i) / 6,
      start.y + ((y - start.y) * i) / 6,
      "mousemove"
    );
    await TestUtils.waitForTick();
  }
  await beforeDrop?.();
  at(x, y, "mouseup");
  await TestUtils.waitForTick();
}

add_task(async function test_context_menu_separates_pane() {
  const [a, b, c] = await makeSplit(3);
  const menu = document.getElementById("split-view-menu");
  const shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  EventUtils.synthesizeMouseAtCenter(
    paneHeader(b).querySelector(".split-pane-url"),
    { type: "contextmenu", button: 2 }
  );
  await shown;
  const item = document.getElementById("split-view-menu-separate-pane");
  Assert.ok(!item.hidden, "A pane bar offers to separate the pane");
  const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.activateItem(item);
  await hidden;

  await TestUtils.waitForCondition(() => !b.splitview, "B left the split");
  Assert.equal(a.splitview.tabs.length, 2, "A and C stay split");
  Assert.equal(gBrowser.selectedTab, b, "The separated page is selected");
  Assert.equal(
    a.splitview.nextElementSibling,
    b,
    "It sits right after the split"
  );
  gBrowser.removeTabs([a, b, c]);
});

add_task(async function test_drag_pane_to_strip_makes_a_tab() {
  const [a, b] = await makeSplit(2);
  const other = await addLoadedTab();
  const target = other.getBoundingClientRect();
  await dragHeaderTo(b, target.left + 20, target.bottom - 2, () => {
    const indicator = document.querySelector(".split-pane-strip-drop");
    Assert.equal(
      indicator?.getAttribute("mode"),
      "insert",
      "Near a tab edge, the pane becomes a tab there"
    );
  });
  await TestUtils.waitForCondition(() => !b.splitview && !a.splitview);
  Assert.equal(other.nextElementSibling, b, "Dropped after the tab");
  Assert.ok(
    !document.querySelector(".split-pane-strip-drop"),
    "The indicator is removed"
  );
  gBrowser.removeTabs([a, b, other]);
});

add_task(async function test_drag_pane_onto_tab_splits_with_it() {
  const [a, b, c] = await makeSplit(3);
  const other = await addLoadedTab();
  const target = other.getBoundingClientRect();
  await dragHeaderTo(
    c,
    target.left + target.width / 2,
    target.top + target.height / 2,
    () => {
      Assert.equal(
        document.querySelector(".split-pane-strip-drop")?.getAttribute("mode"),
        "split",
        "Over the middle of a tab, the pane splits with it"
      );
    }
  );
  await TestUtils.waitForCondition(() => c.splitview && other.splitview);
  Assert.equal(c.splitview, other.splitview, "C split with the other tab");
  Assert.equal(a.splitview.tabs.length, 2, "A and B stay split");
  Assert.equal(gBrowser.selectedTab, c, "The moved page is selected");
  gBrowser.removeTabs([a, b, c, other]);
});
