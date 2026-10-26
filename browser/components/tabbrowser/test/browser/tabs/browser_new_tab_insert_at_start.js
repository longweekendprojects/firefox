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

function nextTabOpen() {
  return BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen").then(
    event => event.target
  );
}

async function openFromCommandBar() {
  let opened = nextTabOpen();
  EventUtils.synthesizeKey("t", { accelKey: true });
  await TestUtils.waitForCondition(() => gURLBar.focused);
  EventUtils.sendString("https://example.org/");
  EventUtils.synthesizeKey("KEY_Enter");
  return opened;
}

async function openFromButton() {
  let opened = nextTabOpen();
  let button = document.getElementById("vertical-tabs-newtab-button");
  if (button?.checkVisibility()) {
    button.doCommand();
  } else {
    BrowserCommands.openTab();
  }
  let tab = await opened;
  if (gURLBar.focused) {
    EventUtils.synthesizeKey("KEY_Escape");
  }
  return tab;
}

add_task(async function test_new_tab_paths_open_at_start() {
  let tabs = [];
  for (let i = 0; i < 4; i++) {
    let tab = BrowserTestUtils.addTab(gBrowser, "https://example.com/");
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    gBrowser.moveTabToEnd(tab);
    tabs.push(tab);
  }
  let opened = [];
  for (let split of [false, true]) {
    let splitview = split && gBrowser.addTabSplitView([tabs[2], tabs[3]]);
    for (let open of [openFromCommandBar, openFromButton]) {
      await BrowserTestUtils.switchTab(gBrowser, split ? tabs[3] : tabs[1]);
      let tab = await open();
      opened.push(tab);
      Assert.equal(
        tab.index,
        0,
        `${open.name} opens at the top${split ? " from a split" : ""}`
      );
    }
    if (splitview) {
      splitview.unsplitTabs();
    }
  }
  for (let tab of [...tabs, ...opened]) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_new_tab_opens_at_top_with_hidden_pinned_tabs() {
  const LIST_PREF = "browser.spaces.list";
  Services.prefs.setStringPref(
    LIST_PREF,
    JSON.stringify([
      { id: "a", name: "A", icon: "circle", color: "blue" },
      { id: "b", name: "B", icon: "briefcase", color: "red" },
    ])
  );
  let hiddenPins = [1, 2, 3].map(() =>
    BrowserTestUtils.addTab(gBrowser, "about:blank", { pinned: true })
  );
  window.gSpaces.moveTabs(hiddenPins, "b");
  window.gSpaces.switchTo("a");
  let shownPin = BrowserTestUtils.addTab(gBrowser, "about:blank", {
    pinned: true,
  });
  let tabs = [1, 2, 3, 4].map(() =>
    BrowserTestUtils.addTab(gBrowser, "about:blank")
  );
  Assert.equal(
    gBrowser.tabContainer.visiblePinnedTabCount,
    1,
    "Only 1 pinned tab is in the shown space"
  );

  let newTab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  Assert.equal(
    gBrowser.visibleTabs.indexOf(newTab),
    1,
    "New tab opens right after the shown pinned tab"
  );

  for (let tab of [newTab, ...tabs, shownPin, ...hiddenPins]) {
    BrowserTestUtils.removeTab(tab);
  }
  Services.prefs.clearUserPref(LIST_PREF);
  Services.prefs.clearUserPref("browser.spaces.active");
});
