/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PREF = "browser.tabs.pinnedTiles.columns";
const { autoColumns } = window.gPinnedTiles;

function columnsShown() {
  let container = gBrowser.pinnedTabsContainer;
  let tops = new Map();
  for (let tab of gBrowser.visibleTabs.filter(t => t.pinned)) {
    let top = Math.round(tab.getBoundingClientRect().top);
    tops.set(top, (tops.get(top) ?? 0) + 1);
  }
  return {
    rows: tops.size,
    columns: Math.max(...tops.values()),
    attr: container.getAttribute("tile-layout"),
  };
}

async function settle() {
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.verticalTabs", true],
      [PREF, 0],
    ],
  });
  if (!gBrowser.tabContainer.hasAttribute("expanded")) {
    window.SidebarController._state.launcherExpanded = true;
    await TestUtils.waitForCondition(() =>
      gBrowser.tabContainer.hasAttribute("expanded")
    );
  }
});

add_task(function test_auto_columns() {
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13];
  Assert.deepEqual(
    counts.map(n => autoColumns(n, 220)),
    [1, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4, 4],
    "A narrow grid fits rows of up to four, spread evenly"
  );
  Assert.deepEqual(
    counts.map(n => autoColumns(n, 340)),
    [1, 2, 3, 4, 5, 6, 4, 4, 5, 5, 6, 5],
    "A wider grid fits rows of up to six"
  );
  Assert.equal(autoColumns(5, 100), 2, "A very narrow grid fits two");
});

add_task(async function test_tiles_grid() {
  let pinned = [];
  for (let i = 0; i < 11; i++) {
    let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
    gBrowser.pinTab(tab);
    pinned.push(tab);
  }
  await settle();

  let layout = columnsShown();
  Assert.equal(layout.attr, "auto", "Pinned tabs show as tiles");
  let expected = autoColumns(11, window.gPinnedTiles.gridWidth());
  Assert.equal(layout.columns, expected, "Eleven tiles fill the rows");
  Assert.equal(layout.rows, Math.ceil(11 / expected), "with enough rows");
  let container = gBrowser.pinnedTabsContainer;
  let wrapper = container.shadowRoot.querySelector("[part=items-wrapper]");
  Assert.greaterOrEqual(
    Math.ceil(container.getBoundingClientRect().height),
    Math.floor(wrapper.getBoundingClientRect().height),
    "Every row shows without scrolling"
  );
  let tile = pinned[0].getBoundingClientRect();
  Assert.greater(tile.width, tile.height, "Tiles are wider than tall");

  Services.prefs.setIntPref(PREF, 2);
  await settle();
  layout = columnsShown();
  Assert.equal(layout.columns, 2, "Two across");
  Assert.equal(layout.rows, 6, "with as many rows as needed");

  Services.prefs.setIntPref(PREF, 3);
  await settle();
  Assert.equal(columnsShown().columns, 3, "Three across");

  Services.prefs.setIntPref(PREF, -1);
  await settle();
  Assert.equal(
    container.getAttribute("tile-layout"),
    "icons",
    "Small icons are small tiles"
  );
  let small = pinned[0].getBoundingClientRect();
  Assert.less(small.height, tile.height, "Small icon tiles are smaller");
  Assert.greater(columnsShown().columns, 4, "More small icons fit per row");

  Services.prefs.setIntPref(PREF, -2);
  await settle();
  Assert.ok(!container.hasAttribute("tile-layout"), "-2 keeps the stock look");

  Services.prefs.setIntPref(PREF, 0);
  for (let tab of pinned) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_context_menu_sets_layout() {
  let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(tab);
  await settle();

  let menu = document.getElementById("tabContextMenu");
  let shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  EventUtils.synthesizeMouseAtCenter(tab, { type: "contextmenu", button: 2 });
  await shown;
  let layoutMenu = document.getElementById("context_pinnedTabLayout");
  Assert.ok(!layoutMenu.hidden, "Pinned tabs offer a layout menu");
  let auto = layoutMenu.querySelector("menuitem[value='0']");
  Assert.ok(auto.hasAttribute("checked"), "The current layout is checked");

  let popup = layoutMenu.menupopup;
  let subShown = BrowserTestUtils.waitForPopupEvent(popup, "shown");
  layoutMenu.openMenu(true);
  await subShown;
  let hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  popup.activateItem(layoutMenu.querySelector("menuitem[value='3']"));
  await hidden;
  Assert.equal(Services.prefs.getIntPref(PREF), 3, "Choosing 3 Across");

  Services.prefs.setIntPref(PREF, 0);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_auto_layout_follows_sidebar_width() {
  Assert.ok(
    !document.getElementById("pinned-tiles-menu-button"),
    "No layout button sits under the tiles"
  );
  let pinned = [];
  for (let i = 0; i < 12; i++) {
    let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
    gBrowser.pinTab(tab);
    pinned.push(tab);
  }
  let state = SidebarController._state;
  let oldWidth = state.expandedLauncherWidth;

  state.expandedLauncherWidth = 240;
  await settle();
  await settle();
  let narrow = columnsShown().columns;

  state.expandedLauncherWidth = 420;
  await settle();
  await TestUtils.waitForCondition(
    () => columnsShown().columns > narrow,
    "A wider sidebar fits more tiles in each row"
  );
  Assert.equal(
    columnsShown().columns,
    autoColumns(12, window.gPinnedTiles.gridWidth()),
    "The columns match the new width"
  );

  state.expandedLauncherWidth = 240;
  await TestUtils.waitForCondition(
    () => columnsShown().columns == narrow,
    "Narrowing the sidebar goes back to fewer tiles per row"
  );

  Services.prefs.setIntPref(PREF, 3);
  state.expandedLauncherWidth = 420;
  await settle();
  await settle();
  Assert.equal(columnsShown().columns, 3, "A fixed layout ignores the width");

  Services.prefs.setIntPref(PREF, 0);
  state.expandedLauncherWidth = oldWidth;
  for (let tab of pinned) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_new_tab_button_at_top() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.vertical.newTabButtonAtTop", true]],
  });
  let pinnedTab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(pinnedTab);
  await settle();
  let button = document.getElementById("tabs-list-newtab-button");
  Assert.ok(BrowserTestUtils.isVisible(button), "New Tab shows above the tabs");
  let firstTab = gBrowser.visibleTabs.find(t => !t.pinned);
  Assert.lessOrEqual(
    button.getBoundingClientRect().bottom,
    firstTab.getBoundingClientRect().top + 1,
    "It sits above the first tab"
  );
  Assert.greater(
    button.getBoundingClientRect().top,
    pinnedTab.getBoundingClientRect().bottom,
    "and below the pinned tabs"
  );
  Assert.ok(
    !BrowserTestUtils.isVisible(document.getElementById("tabs-newtab-button")),
    "The New Tab button after the tabs is not shown"
  );
  Assert.ok(
    !BrowserTestUtils.isVisible(
      document.getElementById("vertical-tabs-newtab-button")
    ),
    "The New Tab button outside the tab list is not shown"
  );

  Assert.less(
    parseFloat(
      getComputedStyle(button.querySelector(".toolbarbutton-text")).opacity
    ),
    1,
    "The New Tab row is dimmer than the tabs"
  );
  let opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  EventUtils.synthesizeMouseAtCenter(button, {});
  let { target: newTab } = await opened;
  Assert.ok(true, "Clicking the New Tab row opens a tab");
  BrowserTestUtils.removeTab(newTab);

  let extra = [];
  for (let i = 0; i < 40; i++) {
    extra.push(BrowserTestUtils.addTab(gBrowser, "about:blank"));
  }
  await TestUtils.waitForCondition(
    () => gBrowser.tabContainer.arrowScrollbox.hasAttribute("overflowing"),
    "The tab list overflows"
  );
  await settle();
  let scrollbox = gBrowser.tabContainer.arrowScrollbox.scrollbox;
  scrollbox.scrollTo({ top: 0, behavior: "instant" });
  await settle();
  let before = button.getBoundingClientRect().top;
  await TestUtils.waitForCondition(() => {
    scrollbox.scrollTo({ top: 100, behavior: "instant" });
    return button.getBoundingClientRect().top < before - 50;
  }, "The New Tab row scrolls with the tabs");
  let list = gBrowser.tabContainer.arrowScrollbox.scrollbox;
  Assert.notEqual(
    getComputedStyle(list).scrollbarWidth,
    "none",
    "The tab list shows a scrollbar"
  );
  let scrollbarStart =
    list.getBoundingClientRect().left + list.clientLeft + list.clientWidth;
  if (scrollbarStart < list.getBoundingClientRect().right - 1) {
    let row = extra[0].querySelector(".tab-background").getBoundingClientRect();
    Assert.lessOrEqual(
      scrollbarStart - row.right,
      4,
      "A tab row reaches close to a classic scrollbar"
    );
  }
  scrollbox.scrollTo({ top: 0, behavior: "instant" });
  for (let tab of extra) {
    BrowserTestUtils.removeTab(tab);
  }
  BrowserTestUtils.removeTab(pinnedTab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_tile_close_button() {
  let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  let keep = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(keep);
  gBrowser.pinTab(tab);
  await settle();
  let button = tab.querySelector(".tab-close-button");
  Assert.equal(
    getComputedStyle(button).visibility,
    "hidden",
    "The close button is hidden until the pointer rests on the tile"
  );
  EventUtils.synthesizeMouseAtCenter(tab, { type: "mousemove" });
  await TestUtils.waitForCondition(
    () => getComputedStyle(button).visibility == "visible",
    "Resting on the tile shows the close button"
  );
  let tile = tab.getBoundingClientRect();
  let rect = button.getBoundingClientRect();
  Assert.less(
    rect.left + rect.width / 2,
    tile.left + tile.width / 2,
    "The close button sits on the left of the tile"
  );
  Assert.less(
    rect.top + rect.height / 2,
    tile.top + tile.height / 2,
    "The close button sits at the top of the tile"
  );
  for (
    let node = button.flattenedTreeParentNode;
    node && node.nodeType == Node.ELEMENT_NODE;
    node = node.flattenedTreeParentNode
  ) {
    let style = getComputedStyle(node);
    if (style.overflowX == "visible" && style.overflowY == "visible") {
      continue;
    }
    let box = node.getBoundingClientRect();
    let margin =
      style.overflowX == "clip" ? parseFloat(style.overflowClipMargin) || 0 : 0;
    Assert.ok(
      rect.left >= box.left - margin && rect.top >= box.top - margin,
      `The close button is not cut off by ${node.localName}#${node.id}.${node.className}`
    );
  }
  let resting = getComputedStyle(button).backgroundColor;
  Assert.notEqual(
    resting,
    "rgba(0, 0, 0, 0)",
    "The close button has a solid circle behind it"
  );
  EventUtils.synthesizeMouseAtCenter(button, { type: "mousemove" });
  await TestUtils.waitForCondition(
    () => getComputedStyle(button).backgroundColor != resting,
    "The close button lightens under the pointer"
  );
  let closed = BrowserTestUtils.waitForTabClosing(tab);
  EventUtils.synthesizeMouseAtCenter(button, {});
  await closed;
  Assert.ok(keep.pinned, "Other pinned tabs stay");
  BrowserTestUtils.removeTab(keep);
});

add_task(async function test_line_under_tiles_is_centered() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.vertical.newTabButtonAtTop", true]],
  });
  let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(tab);
  await settle();
  let tile = tab.getBoundingClientRect();
  let line = document
    .getElementById("vertical-pinned-tabs-splitter")
    .getBoundingClientRect();
  let lineY = line.top + line.height / 2;
  let button = document
    .getElementById("tabs-list-newtab-button")
    .getBoundingClientRect();
  let above = lineY - tile.bottom;
  let below = button.top - lineY;
  info(`above ${above}, below ${below}`);
  Assert.less(Math.abs(above - below), 1, "The line sits midway");
  Assert.lessOrEqual(above, 8, "The line sits close to the tiles");
  let shadowTop =
    gBrowser.tabContainer.arrowScrollbox.getBoundingClientRect().top;
  Assert.lessOrEqual(
    shadowTop - lineY,
    2,
    "The tab list and its scroll shadow start right under the line"
  );
  Assert.equal(
    getComputedStyle(gBrowser.tabContainer, "::after").display,
    "none",
    "No extra solid line is drawn"
  );
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});
