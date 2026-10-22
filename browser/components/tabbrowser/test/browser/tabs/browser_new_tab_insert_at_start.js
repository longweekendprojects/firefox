"use strict";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.insertAtStart", true]],
  });
});

add_task(async function test_new_tab_opens_after_pinned_tabs() {
  let pinned = BrowserTestUtils.addTab(gBrowser, "about:blank", {
    pinned: true,
  });
  let tabA = BrowserTestUtils.addTab(gBrowser, "about:blank");
  let tabB = BrowserTestUtils.addTab(gBrowser, "about:blank");

  Assert.equal(pinned.index, 0, "Pinned tab stays first");
  Assert.equal(tabB.index, 1, "Newest tab opens right after pinned tabs");
  Assert.equal(tabA.index, 2, "Older tab moves down");

  BrowserTestUtils.removeTab(tabA);
  BrowserTestUtils.removeTab(tabB);
  BrowserTestUtils.removeTab(pinned);
});

add_task(async function test_new_tab_opens_before_split_view() {
  let tab1 = BrowserTestUtils.addTab(gBrowser, "about:blank");
  let tab2 = BrowserTestUtils.addTab(gBrowser, "about:blank");
  let splitview = gBrowser.addTabSplitView([tab2, tab1]);
  let splitStart = Math.min(...splitview.tabs.map(t => t.index));

  let newTab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  Assert.equal(newTab.index, 0, "New tab opens at the start");
  Assert.equal(
    Math.min(...splitview.tabs.map(t => t.index)),
    splitStart + 1,
    "Split view moves down by one"
  );
  Assert.ok(!newTab.splitview, "New tab is not part of the split view");
  Assert.equal(splitview.tabs.length, 2, "Split view keeps its tabs");

  splitview.close();
  BrowserTestUtils.removeTab(newTab);
});

add_task(async function test_new_tab_opens_before_tab_group() {
  let tab1 = BrowserTestUtils.addTab(gBrowser, "about:blank");
  let group = gBrowser.addTabGroup([tab1]);

  let newTab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  Assert.equal(newTab.index, 0, "New tab opens before the tab group");
  Assert.ok(!newTab.group, "New tab is not added to the tab group");

  await gBrowser.removeTabGroup(group);
  BrowserTestUtils.removeTab(newTab);
});

add_task(async function test_bulk_open_keeps_order_at_start() {
  let tabs = gBrowser.loadTabs(["about:blank", "about:blank", "about:blank"], {
    inBackground: true,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });

  Assert.deepEqual(
    tabs.map(t => t.index),
    [0, 1, 2],
    "Bulk opened tabs open at the start in order"
  );

  for (let tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_related_tab_follows_opener() {
  let opener = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.moveTabToEnd(opener);
  let related = BrowserTestUtils.addTab(gBrowser, "about:blank", {
    openerBrowser: opener.linkedBrowser,
  });
  Assert.equal(
    related.index,
    opener.index + 1,
    "Related tab still opens next to its opener"
  );

  BrowserTestUtils.removeTab(related);
  BrowserTestUtils.removeTab(opener);
});
