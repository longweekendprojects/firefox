/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE =
  "data:text/html,<a id='l' href='https://example.org/browser/?peek' style='display:block;height:200px'>link</a>";
const LINK = "https://example.org/browser/?peek";

async function openPage() {
  return BrowserTestUtils.openNewForegroundTab(gBrowser, PAGE);
}

async function shiftClickLink(tab) {
  let opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#l",
    { shiftKey: true },
    tab.linkedBrowser
  );
  let peekTab = (await opened).target;
  await BrowserTestUtils.browserLoaded(peekTab.linkedBrowser, false, LINK);
  return peekTab;
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["browser.peek.enabled", true]] });
});

add_task(async function test_shift_click_opens_peek() {
  let tab = await openPage();
  let tabCount = gBrowser.visibleTabs.length;
  let peekTab = await shiftClickLink(tab);

  Assert.ok(window.gPeek.isOpen(), "Shift+click opens a Peek card");
  Assert.equal(window.gPeek.getTab(), peekTab, "The card shows the new tab");
  Assert.ok(peekTab.hidden, "The Peek tab is not in the tab strip");
  Assert.equal(gBrowser.visibleTabs.length, tabCount, "No visible tab added");
  Assert.equal(gBrowser.selectedTab, tab, "The page underneath stays selected");
  Assert.equal(
    BrowserWindowTracker.orderedWindows.length,
    1,
    "Shift+click no longer opens a window"
  );

  let panel = document.getElementById(peekTab.linkedPanel);
  Assert.ok(panel.classList.contains("peek-panel"), "Panel is drawn as a card");
  Assert.equal(getComputedStyle(panel).visibility, "visible", "Card shows");
  let card = panel.getBoundingClientRect();
  let area = gBrowser.tabpanels.getBoundingClientRect();
  Assert.greater(card.width, area.width / 2, "Card is wide");
  Assert.less(card.width, area.width, "Card leaves the page edges visible");
  Assert.ok(peekTab.linkedBrowser.docShellIsActive, "Card page is active");
  Assert.equal(
    document.querySelector("#peek-layer .peek-host").textContent,
    "example.org",
    "Bar shows the site"
  );

  let closed = BrowserTestUtils.waitForEvent(peekTab, "TabClose");
  document.querySelector("#peek-layer .peek-close").doCommand();
  await closed;
  Assert.ok(!window.gPeek.isOpen(), "Close button closes the card");
  Assert.ok(!document.getElementById("peek-layer"), "Card chrome is removed");
  Assert.ok(!panel.isConnected, "The Peek tab is closed");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_close_keys_and_backdrop() {
  let tab = await openPage();

  let peekTab = await shiftClickLink(tab);
  let closed = BrowserTestUtils.waitForEvent(peekTab, "TabClose");
  EventUtils.synthesizeKey("w", { accelKey: true });
  await closed;
  Assert.ok(!window.gPeek.isOpen(), "Accel+W closes the card");
  Assert.ok(tab.isConnected && !tab.closing, "Accel+W keeps the page tab");

  peekTab = await shiftClickLink(tab);
  closed = BrowserTestUtils.waitForEvent(peekTab, "TabClose");
  peekTab.linkedBrowser.focus();
  EventUtils.synthesizeKey("KEY_Escape");
  await closed;
  Assert.ok(!window.gPeek.isOpen(), "Escape closes the card");

  peekTab = await shiftClickLink(tab);
  closed = BrowserTestUtils.waitForEvent(peekTab, "TabClose");
  let backdrop = document.querySelector("#peek-layer .peek-backdrop");
  EventUtils.synthesizeMouse(backdrop, 5, 5, {});
  await closed;
  Assert.ok(!window.gPeek.isOpen(), "A click beside the card closes it");

  let other = BrowserTestUtils.addTab(gBrowser, "about:blank");
  peekTab = await shiftClickLink(tab);
  closed = BrowserTestUtils.waitForEvent(peekTab, "TabClose");
  gBrowser.selectedTab = other;
  await closed;
  Assert.ok(!window.gPeek.isOpen(), "Switching tabs closes the card");

  BrowserTestUtils.removeTab(other);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_expand_and_split() {
  let tab = await openPage();

  let peekTab = await shiftClickLink(tab);
  EventUtils.synthesizeKey("o", { accelKey: true });
  await TestUtils.waitForCondition(
    () => !window.gPeek.isOpen(),
    "Accel+O ends the card"
  );
  Assert.ok(!peekTab.hidden, "The page is now a tab in the tab strip");
  Assert.equal(gBrowser.selectedTab, peekTab, "The new tab is selected");
  Assert.equal(
    peekTab.linkedBrowser.currentURI.spec,
    LINK,
    "The page did not reload elsewhere"
  );
  Assert.ok(
    !document
      .getElementById(peekTab.linkedPanel)
      .classList.contains("peek-panel"),
    "Panel is no longer a card"
  );
  BrowserTestUtils.removeTab(peekTab);

  gBrowser.selectedTab = tab;
  peekTab = await shiftClickLink(tab);
  document.querySelector("#peek-layer .peek-split").doCommand();
  Assert.ok(!window.gPeek.isOpen(), "Split ends the card");
  Assert.ok(peekTab.splitview, "The page is a split pane");
  Assert.equal(peekTab.splitview, tab.splitview, "Beside the page underneath");
  Assert.equal(gBrowser.selectedTab, peekTab, "The new pane is selected");

  let splitview = peekTab.splitview;
  gBrowser.removeTabs(splitview.tabs);
});

add_task(async function test_little_window_with_page() {
  let opened = BrowserTestUtils.waitForNewWindow({ url: LINK });
  window.openLittleWindow(LINK);
  let win = await opened;

  await TestUtils.waitForCondition(
    () => win.document.getElementById("little-window-open"),
    "Little window is set up"
  );
  let root = win.document.documentElement;
  Assert.ok(root.hasAttribute("little-window"), "Window is a little window");
  Assert.ok(!win.toolbar.visible, "It is a popup window");
  Assert.ok(!win.gURLBar.readOnly, "Its address bar can be edited");
  let back = win.document.getElementById("back-button");
  let forward = win.document.getElementById("forward-button");
  let urlbar = win.document.getElementById("urlbar-container");
  Assert.ok(BrowserTestUtils.isVisible(back), "Back shows");
  Assert.ok(BrowserTestUtils.isVisible(forward), "Forward shows");
  Assert.less(
    back.getBoundingClientRect().left,
    forward.getBoundingClientRect().left,
    "Back comes before Forward"
  );
  Assert.less(
    forward.getBoundingClientRect().left,
    urlbar.getBoundingClientRect().left,
    "Navigation buttons come before the address bar"
  );
  let button = win.document.getElementById("little-window-open");
  Assert.ok(BrowserTestUtils.isVisible(button), "Open in Window shows");
  Assert.less(win.outerWidth, screen.availWidth, "The window is small");
  Assert.notEqual(
    BrowserWindowTracker.getTopWindow(),
    win,
    "Links from other windows never open in a little window"
  );

  let count = gBrowser.tabs.length;
  let closed = BrowserTestUtils.domWindowClosed(win);
  let adopted = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  button.click();
  await adopted;
  await closed;
  Assert.equal(gBrowser.tabs.length, count + 1, "Page moved to this window");
  Assert.equal(
    gBrowser.selectedBrowser.currentURI.spec,
    LINK,
    "The moved page is selected"
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

add_task(async function test_little_window_for_search() {
  let opened = BrowserTestUtils.waitForNewWindow();
  window.openLittleWindow();
  let win = await opened;
  await TestUtils.waitForCondition(
    () => win.gURLBar.focused,
    "Address bar is focused for a search"
  );
  let smallWidth = win.outerWidth;

  let loaded = BrowserTestUtils.browserLoaded(
    win.gBrowser.selectedBrowser,
    false,
    LINK
  );
  win.gURLBar.value = LINK;
  EventUtils.synthesizeKey("KEY_Enter", {}, win);
  await loaded;
  await TestUtils.waitForCondition(
    () => win.outerWidth > smallWidth,
    "The window grows to show the page"
  );
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_context_menu_opens_peek() {
  let tab = await openPage();
  let menu = document.getElementById("contentAreaContextMenu");
  let shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#l",
    { type: "contextmenu", button: 2 },
    tab.linkedBrowser
  );
  await shown;
  let item = document.getElementById("context-openlinkinpeek");
  Assert.ok(!item.hidden, "Open Link in Peek shows for a link");

  let opened = BrowserTestUtils.waitForEvent(gBrowser.tabContainer, "TabOpen");
  menu.activateItem(item);
  let peekTab = (await opened).target;
  await BrowserTestUtils.browserLoaded(peekTab.linkedBrowser, false, LINK);
  Assert.ok(window.gPeek.isOpen(), "The menu item opens a Peek card");
  Assert.equal(gBrowser.selectedTab, tab, "The page stays selected");
  window.gPeek.closeCard();

  await SpecialPowers.pushPrefEnv({ set: [["browser.peek.enabled", false]] });
  shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#l",
    { type: "contextmenu", button: 2 },
    tab.linkedBrowser
  );
  await shown;
  Assert.ok(item.hidden, "The item hides when Peek is off");
  let hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.hidePopup();
  await hidden;
  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_external_links_open_little_window() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.littlewindow.externalLinks", true]],
  });
  let count = gBrowser.tabs.length;
  let opened = BrowserTestUtils.waitForNewWindow({ url: LINK });
  window.browserDOMWindow.openURI(
    Services.io.newURI(LINK),
    null,
    Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW,
    Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
    Services.scriptSecurityManager.getSystemPrincipal()
  );
  let win = await opened;
  Assert.ok(
    win.document.documentElement.hasAttribute("little-window"),
    "A link from another app opens in a little window"
  );
  Assert.equal(gBrowser.tabs.length, count, "No tab opens in this window");
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["browser.littlewindow.closeAfterIdleSeconds", 1]],
  });
  await TestUtils.waitForCondition(
    () => win.gLittleWindow,
    "Little window is set up"
  );
  let closed = BrowserTestUtils.domWindowClosed(win);
  win.dispatchEvent(new win.Event("deactivate"));
  await closed;
  Assert.ok(win.closed, "A little window left in the background closes");
  await SpecialPowers.popPrefEnv();
});
