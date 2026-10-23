/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const LIST_PREF = "browser.spaces.list";
const { gSpaces } = window;
const URL1 = "https://example.com/browser/?first";
const URL2 = "https://example.org/browser/?second";

function setSpaces(list) {
  Services.prefs.setStringPref(LIST_PREF, JSON.stringify(list));
}

const TWO_SPACES = [
  { id: "a", name: "A", icon: "circle", color: "blue" },
  { id: "b", name: "B", icon: "briefcase", color: "red" },
];

function visibleSpaces() {
  return new Set(gBrowser.visibleTabs.map(t => gSpaces.spaceOf(t)));
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(LIST_PREF);
    Services.prefs.clearUserPref("browser.spaces.active");
    for (let tab of gBrowser.tabs.slice(1)) {
      BrowserTestUtils.removeTab(tab);
    }
    gBrowser.showTab(gBrowser.tabs[0]);
  });
});

add_task(async function test_switch_spaces() {
  setSpaces(TWO_SPACES);
  let first = gBrowser.selectedTab;
  Assert.equal(
    gSpaces.getActiveId(),
    "a",
    "Existing tabs are in the first space"
  );
  let bar = document.getElementById("spaces-bar");
  Assert.equal(
    bar.querySelectorAll(".space-button").length,
    2,
    "Bar shows both spaces"
  );

  let pinned = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  gBrowser.pinTab(pinned);
  let tabA = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL2);
  Assert.equal(gSpaces.spaceOf(tabA), "a", "New tabs join the shown space");

  let opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  bar.querySelector('[data-space-id="b"]').doCommand();
  await opened;
  Assert.equal(gSpaces.getActiveId(), "b", "Space B is shown");
  let tabB = gBrowser.selectedTab;
  Assert.equal(gSpaces.spaceOf(tabB), "b", "An empty space gets a new tab");
  Assert.ok(
    pinned.hidden && tabA.hidden && first.hidden,
    "Space A tabs are hidden, pinned too"
  );
  Assert.deepEqual(
    [...visibleSpaces()],
    ["b"],
    "Only space B tabs are visible"
  );
  Assert.ok(
    bar.querySelector('[data-space-id="b"]').hasAttribute("checked"),
    "Bar marks space B"
  );
  let pinnedArea = gBrowser.pinnedTabsContainer;
  await TestUtils.waitForCondition(
    () => !pinnedArea.getBoundingClientRect().height,
    "A space without pinned tabs shows no pinned area"
  );
  Assert.ok(
    !document
      .getElementById("vertical-pinned-tabs-splitter")
      .getBoundingClientRect().height,
    "nor the line under it"
  );

  gSpaces.switchTo("a");
  Assert.equal(gBrowser.selectedTab, tabA, "Space A reselects its last tab");
  Assert.ok(!pinned.hidden, "Pinned tab of space A is shown again");
  await TestUtils.waitForCondition(
    () => pinnedArea.getBoundingClientRect().height > 0,
    "The pinned area returns with space A"
  );
  Assert.ok(tabB.hidden, "Space B tab is hidden");
  Assert.deepEqual(
    [...visibleSpaces()],
    ["a"],
    "Only space A tabs are visible"
  );

  gBrowser.selectedTab = tabB;
  Assert.equal(gSpaces.getActiveId(), "b", "Selecting a tab shows its space");
  Assert.ok(tabA.hidden && pinned.hidden, "Space A is hidden again");

  gSpaces.switchTo("a");
  gBrowser.moveTabToEnd(tabA);
  gSpaces.moveTabs([tabA], "b");
  Assert.ok(tabA.selected, "The moved tab stays selected");
  Assert.equal(
    gSpaces.getActiveId(),
    "b",
    "Moving the selected tab follows it"
  );
  Assert.equal(
    gBrowser.visibleTabs.find(t => !t.pinned),
    tabA,
    "A moved tab goes to the top of the space's tabs"
  );

  let state = JSON.parse(SessionStore.getTabState(tabA));
  Assert.equal(state.attributes.space, "b", "The space is saved with the tab");

  gSpaces.switchTo("a");
  gSpaces.removeSpace("b");
  Assert.equal(gSpaces.getSpaces().length, 1, "Space B is removed");
  Assert.ok(!tabA.hidden && !tabB.hidden, "Its tabs move to space A");

  BrowserTestUtils.removeTab(tabA);
  BrowserTestUtils.removeTab(tabB);
  BrowserTestUtils.removeTab(pinned);
});

add_task(async function test_close_last_tab_of_space() {
  setSpaces(TWO_SPACES);
  gSpaces.switchTo("b");
  let only = gBrowser.selectedTab;
  Assert.equal(gSpaces.spaceOf(only), "b", "Space B has one tab");
  await BrowserTestUtils.removeTab(only);
  Assert.equal(gSpaces.getActiveId(), "b", "Space B stays shown");
  Assert.equal(gSpaces.spaceOf(gBrowser.selectedTab), "b", "with a new tab");
  gSpaces.switchTo("a");
  for (let tab of gBrowser.tabs.filter(t => gSpaces.spaceOf(t) == "b")) {
    await BrowserTestUtils.removeTab(tab);
  }
  Services.prefs.clearUserPref(LIST_PREF);
});

add_task(async function test_tab_context_menu() {
  setSpaces(TWO_SPACES);
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  let menu = document.getElementById("tabContextMenu");
  let shown = BrowserTestUtils.waitForEvent(menu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(tab, { type: "contextmenu", button: 2 });
  await shown;
  let item = document.querySelector(
    '#moveTabOptionsMenu menuitem[spaceid="b"]'
  );
  Assert.ok(item, "Move Tab lists the other space");
  Assert.ok(
    !document.querySelector('#moveTabOptionsMenu menuitem[spaceid="a"]'),
    "Move Tab leaves out the tab's own space"
  );
  item.doCommand();
  let hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.hidePopup();
  await hidden;
  Assert.equal(gSpaces.spaceOf(tab), "b", "The tab moved to space B");
  Assert.equal(gSpaces.getActiveId(), "b", "Space B is shown");
  gSpaces.switchTo("a");
  for (let tabB of gBrowser.tabs.filter(t => gSpaces.spaceOf(t) == "b")) {
    BrowserTestUtils.removeTab(tabB);
  }
  Services.prefs.clearUserPref(LIST_PREF);
});

add_task(async function test_container_space() {
  let identity = ContextualIdentityService.create(
    "Spaces test",
    "fence",
    "green"
  );
  setSpaces([
    TWO_SPACES[0],
    { ...TWO_SPACES[1], userContextId: identity.userContextId },
  ]);
  gSpaces.switchTo("b");
  await TestUtils.waitForCondition(
    () => gSpaces.spaceOf(gBrowser.selectedTab) == "b",
    "Space B shows its new tab"
  );
  Assert.equal(
    gBrowser.selectedTab.userContextId,
    identity.userContextId,
    "The new tab of a space with separate logins uses its container"
  );
  let newTab = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  BrowserCommands.openTab();
  let tab = (await newTab).target;
  Assert.equal(
    tab.userContextId,
    identity.userContextId,
    "Later new tabs use it too"
  );

  gSpaces.switchTo("a");
  let plain = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  BrowserCommands.openTab();
  let plainTab = (await plain).target;
  Assert.equal(plainTab.userContextId, 0, "Other spaces open plain tabs");

  BrowserTestUtils.removeTab(plainTab);
  for (let tabB of gBrowser.tabs.filter(t => gSpaces.spaceOf(t) == "b")) {
    BrowserTestUtils.removeTab(tabB);
  }
  Services.prefs.clearUserPref(LIST_PREF);
  ContextualIdentityService.remove(identity.userContextId);
});

add_task(async function test_close_resets_pinned_tab() {
  let pinned = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  gBrowser.pinTab(pinned);
  Assert.equal(
    pinned.getAttribute("pinned-url"),
    URL1,
    "Pinning saves the address"
  );

  let loaded = BrowserTestUtils.browserLoaded(
    pinned.linkedBrowser,
    false,
    URL2
  );
  BrowserTestUtils.startLoadingURIString(pinned.linkedBrowser, URL2);
  await loaded;

  let unpinned = gBrowser.tabs.find(t => !t.pinned && !t.hidden);
  EventUtils.synthesizeKey("w", { accelKey: true });
  Assert.equal(
    gBrowser.selectedTab,
    unpinned,
    "Accel+W selects an unpinned tab"
  );
  await TestUtils.waitForCondition(
    () => pinned.hasAttribute("pending") && !pinned.linkedPanel,
    "The pinned tab is unloaded"
  );
  await TestUtils.waitForCondition(
    () => pinned.linkedBrowser.currentURI.spec == URL1,
    "The pinned tab points at its pinned address"
  );
  Assert.ok(pinned.isConnected, "The pinned tab is kept");
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 500));
  Assert.ok(!pinned.linkedPanel, "It stays unloaded until selected");

  let restored = BrowserTestUtils.waitForEvent(pinned, "SSTabRestored");
  gBrowser.selectedTab = pinned;
  await restored;
  Assert.equal(
    pinned.linkedBrowser.currentURI.spec,
    URL1,
    "It loads its pinned address"
  );
  let state = JSON.parse(SessionStore.getTabState(pinned));
  Assert.equal(state.entries.length, 1, "Its later history is dropped");
  Assert.equal(
    state.attributes["pinned-url"],
    URL1,
    "The address is saved with the tab"
  );

  gBrowser.unpinTab(pinned);
  Assert.ok(
    !pinned.hasAttribute("pinned-url"),
    "Unpinning forgets the address"
  );
  BrowserTestUtils.removeTab(pinned);
});

add_task(async function test_restore_keeps_other_spaces_hidden_and_unloaded() {
  setSpaces(TWO_SPACES);
  let win = await BrowserTestUtils.openNewBrowserWindow();
  let entry = url => ({
    url,
    triggeringPrincipal_base64: E10SUtils.SERIALIZED_SYSTEMPRINCIPAL,
  });
  let hiddenInB = {
    hidden: true,
    extData: { hiddenBy: "spaces" },
  };
  let state = {
    windows: [
      {
        tabs: [
          {
            entries: [entry(URL1)],
            pinned: true,
            ...hiddenInB,
            attributes: { space: "b", "pinned-url": URL1 },
          },
          { entries: [entry(URL2)], attributes: { space: "a" } },
          {
            entries: [entry(URL1 + "&b")],
            ...hiddenInB,
            attributes: { space: "b" },
          },
        ],
        selected: 2,
      },
    ],
  };
  let restored = BrowserTestUtils.waitForEvent(win, "SSWindowRestored");
  SessionStore.setWindowState(win, JSON.stringify(state), true);
  await restored;

  let [pinnedB, tabA, tabB] = win.gBrowser.tabs;
  Assert.equal(
    win.gSpaces.getActiveId(),
    "a",
    "The selected tab's space is shown"
  );
  Assert.ok(
    pinnedB.pinned && pinnedB.hidden,
    "The pinned tab of space B is hidden"
  );
  Assert.ok(!pinnedB.linkedPanel, "and not loaded");
  Assert.ok(tabB.hidden && !tabA.hidden, "Only space A tabs are shown");

  let loaded = BrowserTestUtils.waitForEvent(pinnedB, "SSTabRestored");
  win.gBrowser.selectedTab = pinnedB;
  await loaded;
  Assert.equal(win.gSpaces.getActiveId(), "b", "Selecting it shows space B");
  Assert.ok(!tabB.hidden && tabA.hidden, "Space B tabs are shown");

  await BrowserTestUtils.closeWindow(win);
  Services.prefs.clearUserPref(LIST_PREF);
});

add_task(async function test_swipe_keys_and_tint() {
  setSpaces(TWO_SPACES);
  let start = gBrowser.selectedTab;
  let pageA = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  let container = document.getElementById("sidebar-container");
  Assert.ok(container.hasAttribute("space-tint"), "The sidebar is tinted");
  let tintA = container.style.getPropertyValue("--space-tint-color");

  let switched = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "TabOpen"
  );
  for (let i = 0; i < 3; i++) {
    EventUtils.synthesizeWheel(gBrowser.tabContainer, 20, 20, {
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: 40,
      deltaY: 0,
    });
  }
  await switched;
  Assert.equal(gSpaces.getActiveId(), "b", "Swiping left shows the next space");
  Assert.notEqual(
    container.style.getPropertyValue("--space-tint-color"),
    tintA,
    "The tint follows the space color"
  );
  let tabB = gBrowser.selectedTab;

  // Wait for the swipe to end before the next one.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 300));
  for (let i = 0; i < 3; i++) {
    EventUtils.synthesizeWheel(gBrowser.tabContainer, 20, 20, {
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: -40,
      deltaY: 0,
    });
  }
  await TestUtils.waitForCondition(
    () => gSpaces.getActiveId() == "a",
    "Swiping right shows the previous space"
  );

  if (AppConstants.platform == "macosx") {
    pageA.linkedBrowser.focus();
    EventUtils.synthesizeKey("2", { ctrlKey: true });
    Assert.equal(gSpaces.getActiveId(), "b", "Ctrl+2 shows the second space");
    EventUtils.synthesizeKey("1", { ctrlKey: true });
    Assert.equal(gSpaces.getActiveId(), "a", "Ctrl+1 shows the first space");
  }

  BrowserTestUtils.removeTab(pageA);
  gBrowser.selectedTab = start;
  setSpaces([TWO_SPACES[0]]);
  BrowserTestUtils.removeTab(tabB);
  Assert.ok(
    !container.hasAttribute("space-tint"),
    "A single space leaves the sidebar untinted"
  );
  Services.prefs.clearUserPref(LIST_PREF);
});

add_task(async function test_bar_shares_the_tools_row_when_expanded() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.visibility", "always-show"],
      ["sidebar.main.tools", "history,bookmarks"],
    ],
  });
  await SidebarController.promiseInitialized;
  setSpaces(TWO_SPACES);
  let bar = document.getElementById("spaces-bar");
  let main = document.querySelector("sidebar-main");
  let container = gBrowser.tabContainer;

  if (!container.hasAttribute("expanded")) {
    SidebarController.handleToolbarButtonClick();
  }
  await BrowserTestUtils.waitForMutationCondition(
    container,
    { attributes: true },
    () => container.hasAttribute("expanded")
  );
  await TestUtils.waitForCondition(
    () => main.shadowRoot.querySelector(".tools-and-extensions moz-button"),
    "Tools are shown"
  );
  Assert.equal(
    bar.parentNode,
    main,
    "The bar sits in the sidebar's bottom row"
  );
  let tools = main.shadowRoot
    .querySelector(".tools-and-extensions")
    .getBoundingClientRect();
  let row = bar.getBoundingClientRect();
  Assert.less(row.top, tools.bottom, "The bar is level with the tools");
  Assert.greater(row.bottom, tools.top, "The bar is level with the tools");
  Assert.greaterOrEqual(row.left, tools.right, "The bar follows the tools");

  SidebarController.handleToolbarButtonClick();
  await BrowserTestUtils.waitForMutationCondition(
    container,
    { attributes: true },
    () => !container.hasAttribute("expanded")
  );
  Assert.equal(
    bar.parentNode,
    container,
    "The bar returns to the tab strip when the sidebar collapses"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_drag_reorders_spaces() {
  setSpaces([
    ...TWO_SPACES,
    { id: "c", name: "C", icon: "fruit", color: "green" },
  ]);
  let active = gSpaces.getActiveId();
  let list = document.getElementById("spaces-list");
  await TestUtils.waitForCondition(
    () => list.querySelectorAll(".space-button").length == 3
  );
  let [first, , last] = list.querySelectorAll(".space-button");
  let from = first.getBoundingClientRect();
  let to = last.getBoundingClientRect();
  let vertical = Math.abs(to.top - from.top) > 1;
  let point = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  let start = point(from);
  let end = vertical
    ? { x: start.x, y: to.bottom + 2 }
    : { x: to.right + 2, y: start.y };
  let mouse = (type, { x, y }) =>
    EventUtils.synthesizeMouseAtPoint(x, y, { type }, window);
  mouse("mousedown", start);
  for (let i = 1; i <= 5; i++) {
    mouse("mousemove", {
      x: start.x + ((end.x - start.x) * i) / 5,
      y: start.y + ((end.y - start.y) * i) / 5,
    });
  }
  Assert.ok(
    first.hasAttribute("dragging") && list.hasAttribute("reordering"),
    "The dragged space follows the pointer"
  );
  mouse("mouseup", end);
  await TestUtils.waitForCondition(
    () =>
      JSON.parse(Services.prefs.getStringPref(LIST_PREF))
        .map(s => s.id)
        .join() == "b,c,a",
    "Dropping after the last space moves the space to the end"
  );
  Assert.equal(
    gSpaces.getActiveId(),
    active,
    "Dragging a space does not switch to it"
  );
  Assert.deepEqual(
    [...list.querySelectorAll(".space-button")].map(b => b.dataset.spaceId),
    ["b", "c", "a"],
    "The buttons show the new order"
  );
  setSpaces(TWO_SPACES);
});
