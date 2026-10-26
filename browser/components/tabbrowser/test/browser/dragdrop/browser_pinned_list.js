/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gPinnedList } = window;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.verticalTabs", true],
      ["browser.tabs.pinnedTiles.columns", 0],
      ["browser.tabs.vertical.newTabButtonAtTop", true],
      ["browser.tabs.insertAtStart", true],
    ],
  });
  if (!gBrowser.tabContainer.hasAttribute("expanded")) {
    window.SidebarController._state.launcherExpanded = true;
    await TestUtils.waitForCondition(() =>
      gBrowser.tabContainer.hasAttribute("expanded")
    );
  }
});

function newTabRow() {
  return document.getElementById("tabs-list-newtab-button");
}

function rowRect() {
  return newTabRow().getBoundingClientRect();
}

let testTabs = new Set();

function unpinnedOrder() {
  return gBrowser.visibleTabs.filter(t => !t.pinned && testTabs.has(t));
}

async function openTabs(count) {
  let tabs = [];
  for (let i = 0; i < count; i++) {
    let tab = await addTab(`https://example.com/?tab${i}`);
    gBrowser.moveTabToEnd(tab);
    testTabs.add(tab);
    tabs.push(tab);
  }
  gBrowser.selectedTab = tabs[0];
  return tabs;
}

function dropDone() {
  return TestUtils.waitForCondition(
    () => !gBrowser.tabContainer.hasAttribute("movingtab"),
    "The drop finishes"
  );
}

function cleanUp(tabs) {
  for (let tab of tabs) {
    if (tab.isConnected) {
      BrowserTestUtils.removeTab(tab);
    }
  }
}

add_task(async function test_list_sits_above_the_new_tab_row() {
  let tabs = await openTabs(3);
  try {
    gPinnedList.setInList(tabs[2], true);
    gPinnedList.normalize();
    Assert.equal(
      unpinnedOrder()[0],
      tabs[2],
      "A tab put in the list moves before the other tabs"
    );
    Assert.equal(
      tabs[2].getAttribute("pinned-url"),
      "https://example.com/?tab2",
      "It keeps the address it was pinned with"
    );
    let row = rowRect();
    Assert.less(
      tabs[2].getBoundingClientRect().bottom,
      row.top,
      "The list tab shows above the New Tab row"
    );
    Assert.greater(
      tabs[0].getBoundingClientRect().top,
      row.bottom,
      "Other tabs show below the New Tab row"
    );
    Assert.ok(
      newTabRow().hasAttribute("after-pinned-list"),
      "The New Tab row draws the line under the list"
    );

    let opened = BrowserTestUtils.waitForEvent(
      gBrowser.tabContainer,
      "TabOpen"
    );
    BrowserCommands.openTab();
    let { target: newTab } = await opened;
    tabs.push(newTab);
    testTabs.add(newTab);
    await TestUtils.waitForCondition(
      () => unpinnedOrder()[1] == newTab,
      "A new tab opens at the top of the other tabs, under the list"
    );
    Assert.ok(!newTab.hasAttribute("pinned-list"), "and not in the list");

    let state = JSON.parse(SessionStore.getTabState(tabs[2]));
    Assert.equal(
      state.attributes["pinned-list"],
      "true",
      "The list is saved with the session"
    );
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_close_key_resets_a_list_tab() {
  let tabs = await openTabs(2);
  try {
    gPinnedList.setInList(tabs[1], true);
    gPinnedList.normalize();
    gBrowser.selectedTab = tabs[1];
    BrowserTestUtils.startLoadingURIString(
      tabs[1].linkedBrowser,
      "https://example.org/elsewhere"
    );
    await BrowserTestUtils.browserLoaded(tabs[1].linkedBrowser);
    EventUtils.synthesizeKey("w", { accelKey: true });
    Assert.ok(tabs[1].isConnected, "Accel+W keeps the list tab");
    Assert.ok(
      gBrowser.selectedTab != tabs[1] &&
        !gBrowser.selectedTab.hasAttribute("pinned-list"),
      "and selects a tab outside the list"
    );
    await TestUtils.waitForCondition(
      () =>
        !tabs[1].linkedPanel &&
        tabs[1].linkedBrowser.currentURI.spec == "https://example.com/?tab1",
      "The list tab unloads and goes back to its pinned address"
    );
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_split_view_joins_the_list_as_one() {
  let tabs = await openTabs(3);
  try {
    gPinnedList.setInList(tabs[1], true);
    gPinnedList.normalize();
    let split = gBrowser.addTabSplitView([tabs[1], tabs[2]]);
    gPinnedList.normalize();
    Assert.ok(
      tabs[2].hasAttribute("pinned-list") && split.hasAttribute("pinned-list"),
      "A split with a list tab is wholly in the list"
    );
    Assert.equal(unpinnedOrder()[0], tabs[1], "and sits before other tabs");
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_drag_tab_into_and_out_of_the_list() {
  let tabs = await openTabs(3);
  try {
    gPinnedList.setInList(tabs[0], true);
    gPinnedList.normalize();
    await TestUtils.waitForCondition(() =>
      newTabRow().hasAttribute("after-pinned-list")
    );
    let row = rowRect();
    let shifted;
    await customDragAndDrop(
      tabs[2],
      tabs[1],
      TestUtils.waitForCondition(() => {
        shifted = newTabRow().style.transform;
        return shifted;
      }, "The New Tab row moves down to make room in the list"),
      dropDone(),
      {
        clientX: row.left + row.width / 2,
        clientY: row.top + 3,
        dropEffect: "move",
      }
    );
    Assert.ok(
      tabs[2].hasAttribute("pinned-list"),
      "A tab dropped above the New Tab row joins the list"
    );
    Assert.deepEqual(
      unpinnedOrder(),
      [tabs[0], tabs[2], tabs[1]],
      "It lands at the end of the list"
    );
    Assert.ok(!newTabRow().style.transform, "The New Tab row is back");

    row = rowRect();
    await customDragAndDrop(tabs[0], tabs[1], null, dropDone(), {
      clientX: row.left + row.width / 2,
      clientY: row.bottom + 3,
      dropEffect: "move",
    });
    Assert.ok(
      !tabs[0].hasAttribute("pinned-list") &&
        !tabs[0].hasAttribute("pinned-url"),
      "A list tab dropped below the New Tab row leaves the list"
    );
    Assert.equal(unpinnedOrder()[0], tabs[2], "The list keeps its other tab");
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_drag_between_tiles_and_list() {
  let tabs = await openTabs(3);
  let tile = await addTab("https://example.org/?tile");
  let otherTile = await addTab("https://example.org/?other");
  tabs.push(tile, otherTile);
  testTabs.add(tile);
  try {
    gBrowser.pinTab(otherTile);
    gBrowser.pinTab(tile);
    gPinnedList.setInList(tabs[0], true);
    gPinnedList.normalize();
    await TestUtils.waitForCondition(
      () =>
        gBrowser.pinnedTabsContainer.hasAttribute("tile-layout") &&
        tile.getBoundingClientRect().height > 40 &&
        !gBrowser.tabContainer.hasAttribute("movingtab"),
      "The pinned tabs show as tiles"
    );
    await new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    let row = rowRect();
    await customDragAndDrop(tile, tabs[0], null, dropDone(), {
      clientX: row.left + row.width / 2,
      clientY: tabs[0].getBoundingClientRect().bottom - 2,
      dropEffect: "move",
    });
    Assert.ok(!tile.pinned, "A tile dropped in the tab list is unpinned");
    Assert.ok(tile.hasAttribute("pinned-list"), "and above the row, listed");
    Assert.equal(
      tile.getAttribute("pinned-url"),
      "https://example.org/?tile",
      "It keeps its pinned address"
    );
    Assert.deepEqual(
      unpinnedOrder().slice(0, 2),
      [tabs[0], tile],
      "It lands where it was dropped in the list"
    );

    let tileRect = gBrowser.pinnedTabsContainer.getBoundingClientRect();
    await customDragAndDrop(
      tabs[0],
      gBrowser.pinnedTabsContainer,
      TestUtils.waitForCondition(() => tabs[0].hasAttribute("pinpreview")),
      dropDone(),
      {
        clientX: tileRect.left + tileRect.width / 2,
        clientY: tileRect.top + tileRect.height / 2,
        dropEffect: "move",
      }
    );
    Assert.ok(tabs[0].pinned, "A list tab dropped on the tiles is pinned");
    Assert.ok(!tabs[0].hasAttribute("pinned-list"), "and leaves the list");
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_split_drop_takes_the_target_section() {
  let tabs = await openTabs(2);
  try {
    gPinnedList.setInList(tabs[0], true);
    gPinnedList.normalize();
    await TestUtils.waitForCondition(() =>
      newTabRow().hasAttribute("after-pinned-list")
    );
    let rect = tabs[1].getBoundingClientRect();
    await customDragAndDrop(
      tabs[0],
      tabs[1],
      TestUtils.waitForCondition(
        () => tabs[1].hasAttribute("dragover-splitTarget"),
        "The split preview shows"
      ),
      dropDone(),
      {
        clientX: rect.left + rect.width * 0.75,
        clientY: rect.top + rect.height * 0.3,
        dropEffect: "move",
      }
    );
    Assert.ok(tabs[0].splitview, "Dropping on a tab splits them");
    Assert.ok(
      !tabs[0].hasAttribute("pinned-list") &&
        !tabs[0].splitview.hasAttribute("pinned-list"),
      "The split stays with the tab it was dropped on, outside the list"
    );
  } finally {
    cleanUp(tabs);
  }
});
