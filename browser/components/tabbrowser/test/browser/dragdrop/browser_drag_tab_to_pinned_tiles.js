/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.verticalTabs", true],
      ["browser.tabs.pinnedTiles.columns", 0],
    ],
  });
  if (!gBrowser.tabContainer.hasAttribute("expanded")) {
    window.SidebarController._state.launcherExpanded = true;
    await TestUtils.waitForCondition(() =>
      gBrowser.tabContainer.hasAttribute("expanded")
    );
  }
});

function visiblePinned() {
  return gBrowser.visibleTabs.filter(t => t.pinned);
}

add_task(async function test_drag_tab_into_pinned_tiles() {
  let pinned = [];
  for (let i = 0; i < 3; i++) {
    let tab = await addTab(`data:text/html,pinned${i}`);
    gBrowser.pinTab(tab);
    pinned.push(tab);
  }
  let tab = await addTab("data:text/html,unpinned");
  let container = gBrowser.pinnedTabsContainer;
  await TestUtils.waitForCondition(() => container.hasAttribute("tile-layout"));
  let target = pinned[1];
  let rect = target.getBoundingClientRect();
  let tileRect = pinned[0].getBoundingClientRect();
  let shifted;
  try {
    await customDragAndDrop(
      tab,
      target,
      TestUtils.waitForCondition(() => {
        let floating = document.getElementById("pin-drag-tile");
        if (
          !floating ||
          !tab.hasAttribute("pinpreview") ||
          !pinned[1].style.transform ||
          !pinned[2].style.transform ||
          pinned[0].style.transform
        ) {
          return false;
        }
        shifted = {
          floatingWidth: parseFloat(floating.style.width),
          floatingHeight: parseFloat(floating.style.height),
        };
        return true;
      }, "The tab shows as a tile and the tiles from the drop slot move aside"),
      null,
      {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        dropEffect: "move",
      }
    );
    Assert.less(
      Math.abs(shifted.floatingWidth - tileRect.width),
      0.01,
      "The dragged tile is as wide as a pinned tile"
    );
    Assert.less(
      Math.abs(shifted.floatingHeight - tileRect.height),
      0.01,
      "The dragged tile is as tall as a pinned tile"
    );
    Assert.ok(tab.pinned, "Dropping on the tiles pins the tab");
    Assert.deepEqual(
      visiblePinned(),
      [pinned[0], tab, pinned[1], pinned[2]],
      "The tab is pinned in the slot it was dropped on"
    );
    Assert.ok(
      !document.getElementById("pin-drag-tile") &&
        !tab.hasAttribute("pinpreview") &&
        !container.hasAttribute("pin-preview"),
      "The preview is cleared"
    );
    Assert.ok(
      visiblePinned().every(t => !t.style.transform),
      "No tile keeps a shift"
    );
  } finally {
    for (let t of [...pinned, tab]) {
      BrowserTestUtils.removeTab(t);
    }
  }
});

add_task(async function test_drag_tab_to_end_of_pinned_tiles() {
  let pinned = [];
  for (let i = 0; i < 4; i++) {
    let tab = await addTab(`data:text/html,pinned${i}`);
    gBrowser.pinTab(tab);
    pinned.push(tab);
  }
  let tab = await addTab("data:text/html,unpinned");
  let container = gBrowser.pinnedTabsContainer;
  await TestUtils.waitForCondition(() => container.hasAttribute("tile-layout"));
  let last = pinned.at(-1).getBoundingClientRect();
  let first = pinned[0].getBoundingClientRect();
  let lastRowY = last.top + last.height / 2;
  let sameRow = Math.abs(last.top - first.top) < 1;
  // With one full row, the slot after the last tile starts a new row.
  let point = sameRow
    ? { clientX: first.left + first.width / 2, clientY: last.bottom + 7 }
    : { clientX: last.right - 2, clientY: lastRowY };
  try {
    await customDragAndDrop(
      tab,
      pinned.at(-1),
      TestUtils.waitForCondition(
        () => tab.hasAttribute("pinpreview"),
        "The tab previews as a tile"
      ),
      null,
      { ...point, dropEffect: "move" }
    );
    Assert.ok(tab.pinned, "The tab is pinned");
    Assert.equal(
      visiblePinned().at(-1),
      tab,
      "The tab is pinned after the last tile"
    );
  } finally {
    for (let t of [...pinned, tab]) {
      BrowserTestUtils.removeTab(t);
    }
  }
});

add_task(async function test_drag_pinned_tile_keeps_its_size() {
  let pinned = [];
  for (let i = 0; i < 4; i++) {
    let tab = await addTab(`data:text/html,pinned${i}`);
    gBrowser.pinTab(tab);
    pinned.push(tab);
  }
  let container = gBrowser.pinnedTabsContainer;
  await TestUtils.waitForCondition(() => container.hasAttribute("tile-layout"));
  let size = pinned[0].getBoundingClientRect();
  let target = pinned[2].getBoundingClientRect();
  let dragged;
  try {
    await customDragAndDrop(
      pinned[0],
      pinned[2],
      TestUtils.waitForCondition(() => {
        if (!pinned[0].hasAttribute("dragtarget")) {
          return false;
        }
        dragged = pinned[0].getBoundingClientRect();
        return true;
      }, "The tile is being dragged"),
      null,
      {
        clientX: target.left + target.width / 2,
        clientY: target.top + target.height / 2,
        dropEffect: "move",
      }
    );
    Assert.less(
      Math.abs(dragged.width - size.width),
      1,
      "A dragged tile keeps its width"
    );
    Assert.less(
      Math.abs(dragged.height - size.height),
      1,
      "A dragged tile keeps its height"
    );
    Assert.ok(pinned[0].pinned, "The tile stays pinned");
    Assert.notEqual(
      gBrowser.visibleTabs.filter(t => t.pinned)[0],
      pinned[0],
      "The tile moves to where it was dropped"
    );
  } finally {
    for (let t of pinned) {
      BrowserTestUtils.removeTab(t);
    }
  }
});
