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

async function nextFrames() {
  await new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

/**
 * Drags `src` through `points` with events sent to whatever is under each
 * point, as a real pointer would, then drops at the last point.
 *
 * @param {Element} src
 * @param {{x: number, y: number}[]} points
 * @param {Function} [whileDragging] Called before the drop.
 */
async function dragThrough(src, points, whileDragging) {
  EventUtils.startDragSession(window, "move");
  let [first] = points;
  let [result, dataTransfer] = EventUtils.synthesizeDragOver(
    src,
    document.elementFromPoint(first.x, first.y),
    null,
    "move",
    window,
    window,
    { clientX: first.x, clientY: first.y, dropEffect: "move" }
  );
  for (let { x, y } of points) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    let target = document.elementFromPoint(x, y);
    EventUtils.sendDragEvent(
      EventUtils.createDragEventObject(
        "dragover",
        target,
        window,
        dataTransfer,
        {
          clientX: x,
          clientY: y,
        }
      ),
      target,
      window
    );
  }
  await whileDragging?.();
  let last = points.at(-1);
  EventUtils.synthesizeDropAfterDragOver(
    result,
    dataTransfer,
    document.elementFromPoint(last.x, last.y),
    window,
    { clientX: last.x, clientY: last.y }
  );
  EventUtils._getDOMWindowUtils(window).dragSession.endDragSession(true, 0);
  await dropDone();
}

function pathDown(from, toY) {
  let points = [];
  for (let y = from.y; y < toY; y += 6) {
    points.push({ x: from.x, y });
  }
  points.push({ x: from.x, y: toY });
  return points;
}

async function pinTiles(count) {
  let tiles = [];
  for (let i = 0; i < count; i++) {
    let tile = await addTab(`https://example.org/?tile${i}`);
    gBrowser.pinTab(tile);
    testTabs.add(tile);
    tiles.push(tile);
  }
  await TestUtils.waitForCondition(
    () =>
      gBrowser.pinnedTabsContainer.hasAttribute("tile-layout") &&
      tiles[0].getBoundingClientRect().height > 40 &&
      !gBrowser.tabContainer.hasAttribute("movingtab"),
    "The pinned tabs show as tiles"
  );
  await nextFrames();
  return tiles;
}

add_task(async function test_tile_dragged_under_the_tiles_joins_empty_list() {
  let tabs = await openTabs(2);
  let tiles = await pinTiles(3);
  tabs.push(...tiles);
  try {
    let tile = tiles[1];
    let rect = tile.getBoundingClientRect();
    let pinnedBottom =
      gBrowser.pinnedTabsContainer.getBoundingClientRect().bottom;
    let row = rowRect();
    Assert.greater(row.top, pinnedBottom + 6, "A gap sits above the row");
    let dropY = pinnedBottom + 6;
    let ghost;
    let rowShift;
    await dragThrough(
      tile,
      pathDown({ x: rect.left + rect.width / 2, y: rect.top + 10 }, dropY),
      async () => {
        await TestUtils.waitForCondition(
          () => newTabRow().getBoundingClientRect().top > row.top + 10,
          "The New Tab row moves down to open a gap in the list"
        );
        ghost = document.getElementById("unpin-drag-row");
        rowShift = newTabRow().getBoundingClientRect().top - row.top;
      }
    );
    Assert.ok(ghost, "The tile follows the pointer as a tab row");
    Assert.greater(rowShift, 20, "The gap is a row tall");
    Assert.ok(!document.getElementById("unpin-drag-row"), "The row ghost goes");
    Assert.ok(!tile.pinned, "The tile is unpinned");
    Assert.ok(tile.hasAttribute("pinned-list"), "and joins the list");
    Assert.equal(
      tile.getAttribute("pinned-url"),
      "https://example.org/?tile1",
      "It keeps its pinned address"
    );
    Assert.equal(unpinnedOrder()[0], tile, "It is the first unpinned tab");
    Assert.ok(!newTabRow().style.transform, "The New Tab row is back");
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_tile_dragged_below_the_row_joins_other_tabs() {
  let tabs = await openTabs(3);
  let tiles = await pinTiles(2);
  tabs.push(...tiles);
  try {
    gPinnedList.setInList(tabs[0], true);
    gPinnedList.normalize();
    await nextFrames();
    let tile = tiles[0];
    let rect = tile.getBoundingClientRect();
    let target = tabs[2].getBoundingClientRect();
    await dragThrough(
      tile,
      pathDown(
        { x: rect.left + rect.width / 2, y: rect.top + 10 },
        target.top + 4
      )
    );
    Assert.ok(!tile.pinned, "The tile is unpinned");
    Assert.ok(!tile.hasAttribute("pinned-list"), "outside the list");
    Assert.ok(!tile.hasAttribute("pinned-url"), "without a pinned address");
    Assert.deepEqual(
      unpinnedOrder(),
      [tabs[0], tabs[1], tile, tabs[2]],
      "It lands where the gap showed, among the other tabs"
    );
  } finally {
    cleanUp(tabs);
  }
});

add_task(async function test_tile_dragged_back_up_stays_pinned() {
  let tabs = await openTabs(1);
  let tiles = await pinTiles(3);
  tabs.push(...tiles);
  try {
    let tile = tiles[0];
    let rect = tile.getBoundingClientRect();
    let row = rowRect();
    let points = pathDown(
      { x: rect.left + rect.width / 2, y: rect.top + 10 },
      row.top + 4
    );
    points.push(...points.slice(0, -1).reverse());
    await dragThrough(tile, points);
    Assert.ok(tile.pinned, "A tile dropped back on the tiles stays pinned");
    Assert.ok(!document.getElementById("unpin-drag-row"), "No row ghost stays");
    Assert.ok(
      !gBrowser.tabContainer.arrowScrollbox.hasAttribute("unpin-preview"),
      "The tab list leaves the preview"
    );
  } finally {
    cleanUp(tabs);
  }
});

function foldButton(section) {
  return document.querySelector(`#pinned-${section}-fold`);
}

async function clickFold(section) {
  let button = foldButton(section);
  await TestUtils.waitForCondition(
    () => BrowserTestUtils.isVisible(button),
    `The ${section} fold button shows`
  );
  button.click();
}

add_task(async function test_fold_tiles_and_list_independently() {
  await SpecialPowers.pushPrefEnv({ set: [["ui.prefersReducedMotion", 1]] });
  let tabs = await openTabs(3);
  let tiles = await pinTiles(2);
  tabs.push(...tiles);
  let container = gBrowser.pinnedTabsContainer;
  try {
    gPinnedList.setInList(tabs[0], true);
    gPinnedList.setInList(tabs[1], true);
    gPinnedList.normalize();
    gBrowser.selectedTab = tabs[2];
    await nextFrames();

    let layout = () =>
      [newTabRow(), gBrowser.tabContainer.arrowScrollbox].map(
        el => el.getBoundingClientRect().top
      );
    let withButtons = layout();
    for (let anchor of document.querySelectorAll(".pinned-fold-anchor")) {
      anchor.style.display = "none";
    }
    Assert.deepEqual(layout(), withButtons, "The fold buttons take no room");
    for (let anchor of document.querySelectorAll(".pinned-fold-anchor")) {
      anchor.style.display = "";
    }

    await clickFold("tiles");
    await TestUtils.waitForCondition(
      () => container.hasAttribute("folded"),
      "The tiles fold"
    );
    Assert.ok(BrowserTestUtils.isHidden(container), "The tiles are hidden");
    Assert.ok(
      Services.prefs.getBoolPref("browser.tabs.pinnedTiles.folded"),
      "The fold is saved"
    );
    Assert.ok(
      BrowserTestUtils.isVisible(tabs[0]) &&
        BrowserTestUtils.isVisible(tabs[1]),
      "The list stays open"
    );
    let tilesButton = foldButton("tiles");
    Assert.equal(
      tilesButton.querySelector(".pinned-fold-count").textContent,
      "2",
      "The folded tiles show their count"
    );
    Assert.equal(tilesButton.getAttribute("aria-expanded"), "false");

    await clickFold("list");
    await TestUtils.waitForCondition(
      () => tabs[0].hasAttribute("folded-away"),
      "The list folds"
    );
    Assert.ok(
      BrowserTestUtils.isHidden(tabs[0]) && BrowserTestUtils.isHidden(tabs[1]),
      "The list tabs are hidden"
    );
    Assert.ok(
      !gBrowser.tabContainer.dragAndDropElements.includes(tabs[0]),
      "Hidden list tabs are left out of drag and drop"
    );

    gBrowser.selectedTab = tabs[1];
    await TestUtils.waitForCondition(
      () => BrowserTestUtils.isVisible(tabs[1]),
      "The folded list shows the selected tab"
    );
    Assert.ok(BrowserTestUtils.isHidden(tabs[0]), "but not the others");

    await clickFold("tiles");
    await TestUtils.waitForCondition(
      () => !container.hasAttribute("folded"),
      "The tiles unfold"
    );
    Assert.ok(BrowserTestUtils.isVisible(tiles[0]), "The tiles show again");
    Assert.ok(
      BrowserTestUtils.isHidden(tabs[0]),
      "The list stays folded on its own"
    );

    gPinnedList.applyDrop([tabs[2]], true);
    await TestUtils.waitForCondition(
      () => BrowserTestUtils.isVisible(tabs[0]),
      "Dropping a tab into the folded list unfolds it"
    );
    Assert.ok(
      !Services.prefs.getBoolPref("browser.tabs.pinnedList.folded"),
      "The unfold is saved"
    );
  } finally {
    Services.prefs.clearUserPref("browser.tabs.pinnedTiles.folded");
    Services.prefs.clearUserPref("browser.tabs.pinnedList.folded");
    cleanUp(tabs);
    await SpecialPowers.popPrefEnv();
  }
});
