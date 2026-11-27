/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Panes of a split that is no longer on screen must be inactive, so their
// pages are hidden and throttled like any other background tab.

const PAGE = "https://example.com/";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
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
  await BrowserTestUtils.switchTab(gBrowser, tabs[0]);
  return tabs;
}

function visibility(tab) {
  return SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.document.visibilityState
  );
}

async function assertInactive(tab, message) {
  await TestUtils.waitForCondition(
    () => !tab.linkedBrowser.docShellIsActive,
    `${message}: docshell is inactive`
  );
  is(await visibility(tab), "hidden", `${message}: page is hidden`);
}

async function assertActive(tab, message) {
  ok(tab.linkedBrowser.docShellIsActive, `${message}: docshell is active`);
  is(await visibility(tab), "visible", `${message}: page is visible`);
}

add_task(async function test_leaving_split_deactivates_every_pane() {
  const tabs = await makeSplit(3);
  const outside = await addLoadedTab();
  for (const tab of tabs) {
    await assertActive(tab, "split on screen");
  }

  await BrowserTestUtils.switchTab(gBrowser, outside);
  for (const tab of tabs) {
    await assertInactive(tab, "after leaving the split");
  }

  await BrowserTestUtils.switchTab(gBrowser, tabs[1]);
  for (const tab of tabs) {
    await assertActive(tab, "back on the split");
  }
  await BrowserTestUtils.switchTab(gBrowser, outside);
  for (const tab of tabs) {
    await assertInactive(tab, "after leaving the split again");
  }

  for (const tab of [...tabs, outside]) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_pane_leaving_visible_split_is_deactivated() {
  const tabs = await makeSplit(3);
  const splitview = tabs[0].splitview;

  // Move an unselected pane out while the split stays on screen.
  gBrowser.handleTabMove(tabs[2], () =>
    splitview.parentNode.insertBefore(tabs[2], splitview.nextElementSibling)
  );
  await TestUtils.waitForCondition(
    () => !tabs[2].splitview,
    "the pane left the split"
  );
  await assertInactive(tabs[2], "moved-out pane");
  await assertActive(tabs[1], "remaining pane");

  tabs[0].splitview.unsplitTabs();
  await TestUtils.waitForCondition(
    () => !tabs[1].splitview,
    "the split is gone"
  );
  await assertInactive(tabs[1], "unselected tab after unsplit");
  await assertActive(tabs[0], "selected tab after unsplit");

  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
});
