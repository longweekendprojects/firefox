/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

/**
 * Drags `tab` half its own size toward `target`, waits until `target` shows
 * that a drop would split with it, then drops.
 *
 * @param {MozTabbrowserTab} tab
 * @param {Element} target A tab or split view next to `tab`.
 */
async function dragOntoForSplit(tab, target) {
  let vertical = gBrowser.tabContainer.verticalMode;
  let from = tab.getBoundingClientRect();
  let to = target.getBoundingClientRect();
  let forward = vertical ? to.top > from.top : to.left > from.left;
  let step = (forward ? 1 : -1) * (vertical ? from.height : from.width) * 0.5;
  let event = {
    clientX: from.left + from.width / 2 + (vertical ? 0 : step),
    clientY: from.top + from.height / 2 + (vertical ? step : 0),
    dropEffect: "move",
  };
  await customDragAndDrop(
    tab,
    target,
    TestUtils.waitForCondition(
      () => target.hasAttribute("dragover-splitTarget"),
      "Target offers to split"
    ),
    null,
    event
  );
}

add_task(async function test_drop_tab_on_tab_splits() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  let tab3 = await addTab("data:text/html,three");
  try {
    await dragOntoForSplit(tab1, tab2);
    let splitview = tab1.splitview;
    Assert.ok(splitview, "Dropping a tab on a tab makes a split view");
    Assert.equal(splitview, tab2.splitview, "Both tabs are in the split");
    Assert.equal(splitview.tabs.length, 2, "The split has two panes");
    Assert.equal(gBrowser.selectedTab, tab1, "The dropped tab is selected");
    Assert.ok(
      !gBrowser.tabContainer.hasAttribute("movingtab-split") &&
        !document.querySelector("[dragover-splitTarget]"),
      "The split target mark is cleared"
    );
    let panel1 = document.getElementById(tab1.linkedPanel);
    let panel2 = document.getElementById(tab2.linkedPanel);
    await TestUtils.waitForCondition(
      () =>
        panel1.getBoundingClientRect().right <=
        panel2.getBoundingClientRect().left,
      "The dragged tab sits on the side it came from"
    );

    await dragOntoForSplit(tab3, splitview);
    Assert.equal(
      tab3.splitview,
      splitview,
      "A tab dropped on a split joins it"
    );
    Assert.equal(splitview.tabs.length, 3, "The split has three panes");
    Assert.equal(gBrowser.selectedTab, tab3, "The joined tab is selected");
  } finally {
    for (let tab of [tab1, tab2, tab3]) {
      BrowserTestUtils.removeTab(tab);
    }
  }
});

add_task(async function test_quick_drop_reorders() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  try {
    await customDragAndDrop(tab1, tab2, null, waitForTabMove(tab1));
    Assert.ok(
      !tab1.splitview && !tab2.splitview,
      "A drop before the split mark shows only moves the tab"
    );
  } finally {
    BrowserTestUtils.removeTab(tab1);
    BrowserTestUtils.removeTab(tab2);
  }
});
