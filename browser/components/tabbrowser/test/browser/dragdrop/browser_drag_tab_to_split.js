/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
});

/**
 * Drags `tab` half its own height toward `target`, with the pointer over the
 * `side` half of `target`. Waits until the split preview shows, then drops.
 *
 * @param {MozTabbrowserTab} tab
 * @param {Element} target A tab or split view next to `tab`.
 * @param {"left"|"right"} side
 */
async function dragOntoForSplit(tab, target, side) {
  let from = tab.getBoundingClientRect();
  let to = target.getBoundingClientRect();
  let step = (to.top > from.top ? 1 : -1) * from.height * 0.5;
  let event = {
    clientX: to.left + to.width * (side == "left" ? 0.25 : 0.75),
    clientY: from.top + from.height / 2 + step,
    dropEffect: "move",
  };
  await customDragAndDrop(
    tab,
    target,
    TestUtils.waitForCondition(
      () =>
        target.getAttribute("dragover-splitTarget") == side &&
        tab.getAttribute("dragover-splitSource") == side,
      `Target previews a split with the tab on the ${side}`
    ),
    null,
    event
  );
}

function panelRect(tab) {
  return document.getElementById(tab.linkedPanel).getBoundingClientRect();
}

add_task(async function test_drop_tab_on_tab_splits() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  let tab3 = await addTab("data:text/html,three");
  try {
    await dragOntoForSplit(tab1, tab2, "left");
    let splitview = tab1.splitview;
    Assert.ok(splitview, "Dropping a tab on a tab makes a split view");
    Assert.equal(splitview, tab2.splitview, "Both tabs are in the split");
    Assert.equal(splitview.tabs.length, 2, "The split has two panes");
    Assert.equal(gBrowser.selectedTab, tab1, "The dropped tab is selected");
    Assert.ok(
      !gBrowser.tabContainer.hasAttribute("movingtab-split") &&
        !document.querySelector(
          "[dragover-splitTarget], [dragover-splitSource]"
        ),
      "The split target mark is cleared"
    );
    await TestUtils.waitForCondition(
      () => panelRect(tab1).right <= panelRect(tab2).left,
      "The dragged tab lands on the left half it was held over"
    );

    await dragOntoForSplit(tab3, splitview, "right");
    Assert.equal(
      tab3.splitview,
      splitview,
      "A tab dropped on a split joins it"
    );
    Assert.equal(splitview.tabs.length, 3, "The split has three panes");
    Assert.equal(gBrowser.selectedTab, tab3, "The joined tab is selected");
    await TestUtils.waitForCondition(
      () => panelRect(tab2).right <= panelRect(tab3).left,
      "The joined tab lands at the right edge of the split"
    );
  } finally {
    for (let tab of [tab1, tab2, tab3]) {
      BrowserTestUtils.removeTab(tab);
    }
  }
});

add_task(async function test_drop_on_right_half_splits_right() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  try {
    await dragOntoForSplit(tab1, tab2, "right");
    Assert.equal(tab1.splitview, tab2.splitview, "The tabs are split");
    await TestUtils.waitForCondition(
      () => panelRect(tab2).right <= panelRect(tab1).left,
      "The dragged tab lands on the right half it was held over"
    );
  } finally {
    BrowserTestUtils.removeTab(tab1);
    BrowserTestUtils.removeTab(tab2);
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
