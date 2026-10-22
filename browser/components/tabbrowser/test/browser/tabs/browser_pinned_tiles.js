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
  Assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].map(autoColumns),
    [1, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4, 4],
    "Rows of up to four, spread evenly"
  );
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
  Assert.equal(layout.columns, 4, "Eleven tiles fill rows of four");
  Assert.equal(layout.rows, 3, "in three rows");
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
  Assert.ok(
    BrowserTestUtils.isVisible(
      document.getElementById("pinned-tiles-menu-button")
    ),
    "The layout button stays for small icons"
  );

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

add_task(async function test_layout_button_and_hide_sidebar() {
  await SpecialPowers.pushPrefEnv({
    set: [["sidebar.visibility", "always-show"]],
  });
  let tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(tab);
  await settle();
  let button = document.getElementById("pinned-tiles-menu-button");
  Assert.ok(
    BrowserTestUtils.isVisible(button),
    "A layout button shows under the tiles"
  );

  let shown = BrowserTestUtils.waitForEvent(
    document,
    "popupshown",
    false,
    e => e.target.id == "pinned-tiles-menu"
  );
  button.doCommand();
  let menu = (await shown).target;
  let hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.activateItem(menu.querySelector("menuitem[value='2']"));
  await hidden;
  Assert.equal(Services.prefs.getIntPref(PREF), 2, "The menu sets the layout");

  shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  button.doCommand();
  await shown;
  hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.activateItem(document.getElementById("pinned-tiles-hide-sidebar"));
  await hidden;
  await TestUtils.waitForCondition(
    () => SidebarController.sidebarContainer.hidden,
    "Hide Sidebar hides the whole sidebar"
  );
  await TestUtils.waitForCondition(
    () =>
      !SidebarController._state.launcherVisible &&
      !SidebarController.sidebarContainer.hasAttribute(
        "sidebar-ongoing-animations"
      )
  );
  await SidebarController.handleToolbarButtonClick();
  await TestUtils.waitForCondition(
    () => !SidebarController.sidebarContainer.hidden,
    "The sidebar button shows it again"
  );

  Services.prefs.setIntPref(PREF, 0);
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_new_tab_button_at_top() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.vertical.newTabButtonAtTop", true]],
  });
  let pinnedTab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gBrowser.pinTab(pinnedTab);
  await settle();
  let button = document.getElementById("vertical-tabs-newtab-button");
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
  BrowserTestUtils.removeTab(pinnedTab);
  await SpecialPowers.popPrefEnv();
});
