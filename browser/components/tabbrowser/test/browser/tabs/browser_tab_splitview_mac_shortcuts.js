/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// macOS split view shortcuts: Cmd+Shift+I/J/K/L and Ctrl+Cmd+Shift+I/J/K/L
// split, Ctrl+Cmd+I/J/K/L move between panes.

const PAGE = "https://example.com/";
const OVERRIDE_PREF = "browser.tabs.splitview.paneShortcutsOverrideSites";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
});

async function addTabWithTextField() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    const field = content.document.createElement("textarea");
    field.id = "field";
    field.value = "some text";
    content.document.body.prepend(field);
  });
  return tab;
}

async function focusTextField(tab) {
  if (gBrowser.selectedTab != tab) {
    await BrowserTestUtils.switchTab(gBrowser, tab);
  }
  await SimpleTest.promiseFocus(window);
  tab.linkedBrowser.focus();
  await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
    const field = content.document.getElementById("field");
    field.focus();
    await ContentTaskUtils.waitForCondition(
      () => content.document.activeElement == field,
      "text field has focus"
    );
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => requestAnimationFrame(r));
  }
}

add_task(async function test_cmd_shift_letters_split_from_a_text_field() {
  const tab = await addTabWithTextField();
  await focusTextField(tab);

  const before = gBrowser.tabs.length;
  EventUtils.synthesizeKey("KEY_ArrowRight", { accelKey: true });
  await settle();
  Assert.ok(!tab.splitview, "Cmd+Right in a text field does not split");
  is(gBrowser.tabs.length, before, "Cmd+Right opens no tab");

  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(() => tab.splitview, "Cmd+Shift+L splits");
  const splitview = tab.splitview;
  const pane = splitview.tabs.find(t => t != tab);
  const a = document.getElementById(tab.linkedPanel).getBoundingClientRect();
  const b = document.getElementById(pane.linkedPanel).getBoundingClientRect();
  Assert.greaterOrEqual(b.x, a.right - 1, "the new pane is on the right");

  EventUtils.synthesizeKey("KEY_Escape");
  await focusTextField(tab);
  EventUtils.synthesizeKey("K", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(
    () => splitview.tabs.length == 3,
    "Cmd+Shift+K splits from a text field"
  );
  const below = gBrowser.selectedTab;
  const c = document.getElementById(below.linkedPanel).getBoundingClientRect();
  Assert.greaterOrEqual(c.y, a.y + 1, "the new pane is below");

  EventUtils.synthesizeKey("KEY_Escape");
  for (const t of [...splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_site_keys_and_moving_between_panes() {
  const left = await addTabWithTextField();
  const right = await addTabWithTextField();
  const splitview = gBrowser.addTabSplitView([left, right]);
  await SpecialPowers.spawn(left.linkedBrowser, [], () => {
    content.addEventListener("keydown", event => {
      if (
        event.metaKey &&
        !event.ctrlKey &&
        event.shiftKey &&
        event.code == "KeyL"
      ) {
        event.preventDefault();
      }
    });
  });

  await focusTextField(left);
  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await settle();
  is(splitview.tabs.length, 2, "a site that uses Cmd+Shift+L keeps it");

  EventUtils.synthesizeKey("l", { accelKey: true, ctrlKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == right,
    "Ctrl+Cmd+L moves to the right pane from a text field"
  );
  await focusTextField(right);
  EventUtils.synthesizeKey("j", { accelKey: true, ctrlKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == left,
    "Ctrl+Cmd+J moves to the left pane"
  );

  await focusTextField(left);
  EventUtils.synthesizeKey("L", {
    accelKey: true,
    ctrlKey: true,
    shiftKey: true,
  });
  await TestUtils.waitForCondition(
    () => splitview.tabs.length == 3,
    "Ctrl+Cmd+Shift+L always splits"
  );
  EventUtils.synthesizeKey("KEY_Escape");

  await SpecialPowers.pushPrefEnv({ set: [[OVERRIDE_PREF, true]] });
  is(
    document.getElementById("key_splitPaneRight").getAttribute("reserved"),
    "true",
    "the setting reserves Cmd+Shift+L for the browser"
  );
  await focusTextField(left);
  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(
    () => splitview.tabs.length == 4,
    "with the setting on, Cmd+Shift+L wins over the site"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await SpecialPowers.popPrefEnv();
  ok(
    !document.getElementById("key_splitPaneRight").hasAttribute("reserved"),
    "turning the setting off gives sites the keys first again"
  );
  await focusTextField(left);
  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await settle();
  is(splitview.tabs.length, 4, "the site keeps Cmd+Shift+L again");

  for (const t of [...splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

function commandBarOver(tab) {
  if (!gURLBar.matches(":popover-open") || !gURLBar.focused) {
    return false;
  }
  const bar = gURLBar.getBoundingClientRect();
  const pane = document.getElementById(tab.linkedPanel).getBoundingClientRect();
  return (
    bar.width > 0 &&
    bar.left >= pane.left &&
    bar.right <= pane.right &&
    bar.top >= pane.top &&
    bar.bottom <= pane.bottom
  );
}

add_task(async function test_split_opens_command_bar_in_new_pane() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await BrowserTestUtils.switchTab(gBrowser, tab);
  await SimpleTest.promiseFocus(window);
  tab.linkedBrowser.focus();

  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(() => tab.splitview, "Cmd+Shift+L splits");
  const splitview = tab.splitview;
  const first = gBrowser.selectedTab;
  await TestUtils.waitForCondition(
    () => commandBarOver(first),
    "the command bar opens over the first new pane"
  );
  EventUtils.sendString("typed");
  is(gURLBar.value, "typed", "typing goes into the command bar");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !gURLBar.matches(":popover-open"));

  await BrowserTestUtils.switchTab(gBrowser, tab);
  tab.linkedBrowser.focus();
  EventUtils.synthesizeKey("K", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(
    () => splitview.tabs.length == 3,
    "Cmd+Shift+K splits again"
  );
  const second = gBrowser.selectedTab;
  await TestUtils.waitForCondition(
    () => commandBarOver(second),
    "the command bar opens over the second new pane"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !gURLBar.matches(":popover-open"));

  for (const t of [...splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_add_split_view_opens_command_bar() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await BrowserTestUtils.switchTab(gBrowser, tab);

  BrowserCommands.addTabSplitView();
  await TestUtils.waitForCondition(() => tab.splitview, "the tab splits");
  const pane = gBrowser.selectedTab;
  Assert.notEqual(pane, tab, "the new pane is selected");
  await TestUtils.waitForCondition(
    () => commandBarOver(pane),
    "Add Split View opens the command bar over the new pane"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !gURLBar.matches(":popover-open"));

  for (const t of [...tab.splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_shortcuts_are_listed_in_about_keyboard() {
  await BrowserTestUtils.withNewTab("about:keyboard", async browser => {
    await SpecialPowers.spawn(browser, [], async () => {
      await ContentTaskUtils.waitForCondition(
        () => content.document.querySelector(".key"),
        "about:keyboard rendered"
      );
      for (const id of [
        "key_splitPaneUp",
        "key_splitPaneRight",
        "key_focusPaneLeft",
        "key_splitPaneDownAlways",
      ]) {
        Assert.ok(
          content.document.querySelector(`.key[data-id="${id}"]`),
          `${id} can be changed in about:keyboard`
        );
      }
    });
  });
});

add_task(async function test_browser_console_moves_off_cmd_shift_j() {
  const key = document.getElementById("key_browserConsole");
  ok(key, "the Browser Console key exists");
  is(
    key.getAttribute("modifiers"),
    "accel,alt,shift",
    "the Browser Console uses Cmd+Opt+Shift+J on macOS"
  );
});
