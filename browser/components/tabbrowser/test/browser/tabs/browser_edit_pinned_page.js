/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PINNED = "https://example.com/browser/";
const OTHER = "https://example.org/browser/";

async function openPinnedTab() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PINNED);
  gBrowser.pinTab(tab);
  Assert.equal(tab.getAttribute("pinned-url"), PINNED, "Pinned with its URL");
  return tab;
}

async function clickEditPinnedItem(tab, id) {
  const menu = document.getElementById("tabContextMenu");
  const menuShown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  const event = new Event("");
  tab.dispatchEvent(event);
  menu.openPopup(tab, "end_after", 0, 0, true, false, event);
  await menuShown;
  const submenu = document.getElementById("context_editPinnedPage");
  Assert.ok(!submenu.hidden, "Edit Pinned Page shows for a pinned tab");
  const popup = document.getElementById("context_editPinnedPagePopup");
  const shown = BrowserTestUtils.waitForPopupEvent(popup, "shown");
  submenu.openMenu(true);
  await shown;
  const item = document.getElementById(id);
  if (item.disabled) {
    await closeTabContextMenu(menu);
    return false;
  }
  const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  popup.activateItem(item);
  await hidden;
  return true;
}

add_task(async function test_menu_hidden_for_regular_tabs() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, PINNED);
  const menu = await openTabContextMenu(tab);
  Assert.ok(
    document.getElementById("context_editPinnedPage").hidden,
    "Edit Pinned Page is hidden for a tab that is not pinned"
  );
  await closeTabContextMenu(menu);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_replace_with_current() {
  const tab = await openPinnedTab();
  Assert.ok(
    !(await clickEditPinnedItem(tab, "context_replacePinnedURL")),
    "Replace is disabled while the tab shows its pinned URL"
  );
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, OTHER);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, OTHER);
  Assert.ok(
    await clickEditPinnedItem(tab, "context_replacePinnedURL"),
    "Replace is enabled once the tab shows another page"
  );
  Assert.equal(
    tab.getAttribute("pinned-url"),
    OTHER,
    "The pinned URL is now the current page"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_edit_dialog() {
  const tab = await openPinnedTab();
  await clickEditPinnedItem(tab, "context_editPinnedURL");
  const panel = document.getElementById("pinned-url-panel");
  await TestUtils.waitForCondition(
    () => panel.state == "open",
    "The edit dialog opens"
  );
  const input = document.getElementById("pinned-url-input");
  Assert.equal(input.value, PINNED, "The dialog shows the pinned URL");
  Assert.equal(document.activeElement, input, "The URL field has focus");
  const rect = panel.getBoundingClientRect();
  Assert.less(
    Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
    40,
    "The dialog is centered over the window"
  );

  input.select();
  EventUtils.sendString("example.org/browser/");
  let hidden = BrowserTestUtils.waitForPopupEvent(panel, "hidden");
  EventUtils.synthesizeKey("KEY_Escape");
  await hidden;
  Assert.equal(
    tab.getAttribute("pinned-url"),
    PINNED,
    "Escape leaves the pinned URL as it was"
  );

  window.gPinnedTiles.openPinnedURLDialog(tab);
  await BrowserTestUtils.waitForPopupEvent(panel, "shown");
  Assert.equal(input.value, PINNED, "Reopening shows the pinned URL again");
  input.select();
  EventUtils.sendString(OTHER);
  hidden = BrowserTestUtils.waitForPopupEvent(panel, "hidden");
  EventUtils.synthesizeKey("KEY_Enter");
  await hidden;
  Assert.equal(
    tab.getAttribute("pinned-url"),
    OTHER,
    "Enter saves the edited URL"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_unloaded_tab_follows_new_url() {
  const tab = await openPinnedTab();
  const other = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:robots"
  );
  await gBrowser.explicitUnloadTabs([tab]);
  Assert.ok(!tab.linkedPanel, "The pinned tab is unloaded");
  gBrowser.setPinnedURL(tab, OTHER);
  gBrowser.selectedTab = tab;
  await TestUtils.waitForCondition(
    () => tab.linkedBrowser.currentURI.spec == OTHER,
    "The tab loads the new pinned URL"
  );
  Assert.equal(
    tab.linkedBrowser.currentURI.spec,
    OTHER,
    "Selecting the unloaded tab opens the new pinned URL"
  );
  BrowserTestUtils.removeTab(other);
  BrowserTestUtils.removeTab(tab);
});
