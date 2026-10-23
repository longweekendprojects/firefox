/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// macOS split view shortcuts: Ctrl+Cmd+I/J/K/L split, Cmd+Shift+I/J/K/L and
// Ctrl+Cmd+Shift+I/J/K/L move between panes.

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

add_task(async function test_ctrl_cmd_letters_split_from_a_text_field() {
  const tab = await addTabWithTextField();
  await focusTextField(tab);

  const before = gBrowser.tabs.length;
  EventUtils.synthesizeKey("KEY_ArrowRight", { accelKey: true });
  await settle();
  Assert.ok(!tab.splitview, "Cmd+Right in a text field does not split");
  is(gBrowser.tabs.length, before, "Cmd+Right opens no tab");

  EventUtils.synthesizeKey("l", { accelKey: true, ctrlKey: true });
  await TestUtils.waitForCondition(() => tab.splitview, "Ctrl+Cmd+L splits");
  const splitview = tab.splitview;
  const pane = splitview.tabs.find(t => t != tab);
  const a = document.getElementById(tab.linkedPanel).getBoundingClientRect();
  const b = document.getElementById(pane.linkedPanel).getBoundingClientRect();
  Assert.greaterOrEqual(b.x, a.right - 1, "the new pane is on the right");

  EventUtils.synthesizeKey("KEY_Escape");
  await focusTextField(tab);
  EventUtils.synthesizeKey("k", { accelKey: true, ctrlKey: true });
  await TestUtils.waitForCondition(
    () => splitview.tabs.length == 3,
    "Ctrl+Cmd+K splits from a text field"
  );
  const below = gBrowser.selectedTab;
  const c = document.getElementById(below.linkedPanel).getBoundingClientRect();
  Assert.greaterOrEqual(c.y, a.y + 1, "the new pane is below");

  EventUtils.synthesizeKey("KEY_Escape");
  for (const t of [...splitview.tabs]) {
    BrowserTestUtils.removeTab(t);
  }
});

add_task(async function test_cmd_shift_letters_move_between_panes() {
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
  is(gBrowser.selectedTab, left, "a site that uses Cmd+Shift+L keeps it");

  EventUtils.synthesizeKey("L", {
    accelKey: true,
    ctrlKey: true,
    shiftKey: true,
  });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == right,
    "Ctrl+Cmd+Shift+L always moves to the right pane"
  );

  await focusTextField(right);
  EventUtils.synthesizeKey("J", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == left,
    "Cmd+Shift+J moves to the left pane when the site does not use it"
  );

  await SpecialPowers.pushPrefEnv({ set: [[OVERRIDE_PREF, true]] });
  is(
    document.getElementById("key_focusPaneRight").getAttribute("reserved"),
    "true",
    "the setting reserves Cmd+Shift+L for the browser"
  );
  await focusTextField(left);
  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == right,
    "with the setting on, Cmd+Shift+L wins over the site"
  );
  await SpecialPowers.popPrefEnv();
  ok(
    !document.getElementById("key_focusPaneRight").hasAttribute("reserved"),
    "turning the setting off gives sites the keys first again"
  );
  await focusTextField(left);
  EventUtils.synthesizeKey("L", { accelKey: true, shiftKey: true });
  await settle();
  is(gBrowser.selectedTab, left, "the site keeps Cmd+Shift+L again");

  for (const t of [...splitview.tabs]) {
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
        "key_focusPaneDownAlways",
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
