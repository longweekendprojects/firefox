/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const URL1 = "https://example.com/browser/?undo-open-1";
const URL2 = "https://example.org/browser/?undo-open-2";

function pressUndo() {
  gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey("z", { accelKey: true });
}

add_task(async function test_undo_closes_tab_just_opened() {
  let first = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  let accidental = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL2);
  let closedCount = SessionStore.getClosedTabCountForWindow(window);

  let closed = BrowserTestUtils.waitForEvent(accidental, "TabClose");
  pressUndo();
  await closed;
  Assert.ok(!accidental.isConnected, "Accel+Z closes the tab just opened");
  Assert.equal(
    SessionStore.getClosedTabCountForWindow(window),
    closedCount,
    "An undone open is not a closed tab to reopen"
  );

  closed = BrowserTestUtils.waitForEvent(first, "TabClose");
  pressUndo();
  await closed;
  Assert.ok(!first.isConnected, "Accel+Z again undoes the open before it");
});

add_task(async function test_undo_follows_order_of_open_and_close() {
  let opened = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL1);
  let other = await BrowserTestUtils.openNewForegroundTab(gBrowser, URL2);
  // Closes are newer than the opens, so Accel+Z reopens first.
  await TestUtils.waitForTick();
  BrowserTestUtils.removeTab(other);
  await TestUtils.waitForCondition(
    () => SessionStore.getClosedTabCountForWindow(window) > 0
  );

  let restored = BrowserTestUtils.waitForEvent(
    gBrowser.tabContainer,
    "SSTabRestored"
  );
  pressUndo();
  let reopened = (await restored).target;
  Assert.equal(
    reopened.linkedBrowser.currentURI.spec,
    URL2,
    "A close newer than the last open is undone first"
  );

  // The reopened tab keeps its original open time, so its open is next.
  let closed = BrowserTestUtils.waitForEvent(reopened, "TabClose");
  pressUndo();
  await closed;
  Assert.ok(!reopened.isConnected, "Then the reopened tab's open is undone");
  Assert.ok(opened.isConnected, "Older opens stay until undone in turn");

  closed = BrowserTestUtils.waitForEvent(opened, "TabClose");
  pressUndo();
  await closed;
  Assert.ok(!opened.isConnected, "And then the open before it");
});

add_task(async function test_undo_keeps_last_tab() {
  let win = await BrowserTestUtils.openNewBrowserWindow();
  let before = win.gBrowser.tabs.length;
  win.gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey("z", { accelKey: true }, win);
  await TestUtils.waitForTick();
  Assert.equal(win.gBrowser.tabs.length, before, "The only tab is kept");
  await BrowserTestUtils.closeWindow(win);
});
