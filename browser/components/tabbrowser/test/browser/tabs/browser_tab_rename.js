/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE = "https://example.com/browser/";
const OTHER = "https://example.org/browser/";

async function renameFromMenu(tab) {
  const menu = await openTabContextMenu(tab);
  const item = document.getElementById("context_renameTab");
  Assert.ok(!item.hidden, "Rename Tab shows in the tab context menu");
  const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.activateItem(item);
  await hidden;
  await TestUtils.waitForCondition(
    () =>
      document.getElementById("tab-rename-input") &&
      document.activeElement == document.getElementById("tab-rename-input"),
    "The name editor opens with focus"
  );
  return document.getElementById("tab-rename-input");
}

function typeName(name, key = "KEY_Enter") {
  const input = document.getElementById("tab-rename-input");
  input.select();
  if (name) {
    EventUtils.sendString(name);
  } else {
    EventUtils.synthesizeKey("KEY_Backspace");
  }
  EventUtils.synthesizeKey(key);
}

add_task(async function test_rename_tab() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  const pageTitle = tab.label;
  try {
    let input = await renameFromMenu(tab);
    Assert.equal(input.value, pageTitle, "The editor starts with the title");
    typeName("My docs");
    Assert.ok(!document.getElementById("tab-rename-input"), "Enter closes it");
    Assert.equal(tab.label, "My docs", "The tab shows its new name");

    BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, OTHER);
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    Assert.equal(tab.label, "My docs", "The name stays across page loads");

    const state = JSON.parse(SessionStore.getTabState(tab));
    Assert.equal(
      state.attributes["custom-label"],
      "My docs",
      "The name is saved with the session"
    );
    const copy = gBrowser.duplicateTab(tab);
    await BrowserTestUtils.waitForEvent(copy, "SSTabRestored");
    Assert.equal(copy.label, "My docs", "A restored tab keeps the name");
    BrowserTestUtils.removeTab(copy);

    await renameFromMenu(tab);
    typeName("Not this", "KEY_Escape");
    Assert.equal(tab.label, "My docs", "Escape keeps the old name");

    await renameFromMenu(tab);
    typeName("");
    Assert.ok(!tab.hasAttribute("custom-label"), "An empty name clears it");
    Assert.notEqual(tab.label, "My docs", "The tab shows its page title again");
    Assert.equal(
      tab.label,
      tab.linkedBrowser.contentTitle || tab.label,
      "which is the current page's title"
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_rename_hidden_for_multiselection() {
  const tab1 = await BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
  const tab2 = await BrowserTestUtils.openNewForegroundTab(gBrowser, OTHER);
  gBrowser.selectedTabs = [tab1, tab2];
  const menu = await openTabContextMenu(tab2);
  Assert.ok(
    document.getElementById("context_renameTab").hidden,
    "Rename Tab is hidden for several selected tabs"
  );
  await closeTabContextMenu(menu);
  gBrowser.clearMultiSelectedTabs();
  BrowserTestUtils.removeTab(tab1);
  BrowserTestUtils.removeTab(tab2);
});
