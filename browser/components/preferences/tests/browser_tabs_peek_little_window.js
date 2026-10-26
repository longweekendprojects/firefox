/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const TABS_PANE = SRD_PREF_VALUE ? "paneTabsBrowsing" : "paneGeneral";

add_task(async function test_defaults() {
  let defaults = Services.prefs.getDefaultBranch("");
  Assert.ok(defaults.getBoolPref("browser.peek.enabled"), "Peek is on");
  Assert.ok(
    !defaults.getBoolPref("browser.littlewindow.externalLinks"),
    "Links from other apps open in tabs by default"
  );
});

add_task(async function test_checkboxes() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.peek.enabled", false],
      ["browser.littlewindow.externalLinks", false],
      ["browser.tabs.splitview.paneShortcutsOverrideSites", false],
    ],
  });
  await openPreferencesViaOpenPreferencesAPI(TABS_PANE, { leaveOpen: true });
  const doc = gBrowser.contentDocument;

  for (let [id, pref] of [
    ["peekLinks", "browser.peek.enabled"],
    ["openAppLinksInLittleWindow", "browser.littlewindow.externalLinks"],
    ...(AppConstants.platform == "macosx"
      ? [
          [
            "paneShortcutsOverrideSites",
            "browser.tabs.splitview.paneShortcutsOverrideSites",
          ],
        ]
      : []),
  ]) {
    await TestUtils.waitForCondition(
      () => doc.getElementById(id),
      `${id} checkbox rendered`
    );
    let checkbox = doc.getElementById(id);
    Assert.ok(!checkbox.checked, `${id} is unchecked when the pref is off`);
    let checked = BrowserTestUtils.waitForAttribute("checked", checkbox);
    checkbox.click();
    await checked;
    Assert.ok(Services.prefs.getBoolPref(pref), `${id} turns ${pref} on`);
  }

  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(gBrowser.selectedTab, { animate: false });
});

add_task(async function test_compact_toolbar() {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  const navbar = CustomizableUI.AREA_NAVBAR;
  const hidden = ["fxa-toolbar-menu-button", "new-tab-button", "alltabs-button"];
  for (const id of hidden) {
    CustomizableUI.addWidgetToArea(id, navbar);
  }
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { browser_action: { default_area: "navbar" } },
  });
  await extension.startup();
  const widgetId = `${extension.id
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")}-browser-action`;
  // The extension starts after the extensions button, as pinning used to put
  // it.
  CustomizableUI.moveWidgetWithinArea(widgetId);

  await openPreferencesViaOpenPreferencesAPI(TABS_PANE, { leaveOpen: true });
  const doc = gBrowser.contentDocument;
  await TestUtils.waitForCondition(
    () => doc.getElementById("compactToolbar"),
    "Compact toolbar checkbox rendered"
  );
  const checkbox = doc.getElementById("compactToolbar");
  is_element_visible(checkbox, "The checkbox shows with vertical tabs");
  ok(!checkbox.checked, "It is off while the buttons are in the toolbar");

  checkbox.click();
  await TestUtils.waitForCondition(
    () => !CustomizableUI.getWidgetIdsInArea(navbar).includes(hidden[0]),
    "The buttons leave the toolbar"
  );
  let ids = CustomizableUI.getWidgetIdsInArea(navbar);
  for (const id of hidden) {
    ok(!ids.includes(id), `${id} is hidden`);
  }
  is(
    ids.at(-1),
    "unified-extensions-button",
    "The extensions button is last, next to the menu button"
  );
  is(ids.at(-2), widgetId, "The extension sits just before it");

  checkbox.click();
  await TestUtils.waitForCondition(
    () => CustomizableUI.getWidgetIdsInArea(navbar).includes(hidden[0]),
    "The buttons come back"
  );
  ids = CustomizableUI.getWidgetIdsInArea(navbar);
  for (const id of hidden) {
    ok(
      ids.indexOf(id) < ids.indexOf(widgetId),
      `${id} comes back before the extension buttons`
    );
  }

  Services.prefs.setBoolPref("sidebar.verticalTabs", false);
  await TestUtils.waitForCondition(
    () => BrowserTestUtils.isHidden(checkbox),
    "The checkbox hides with horizontal tabs"
  );

  BrowserTestUtils.removeTab(gBrowser.selectedTab, { animate: false });
  await extension.unload();
  await SpecialPowers.popPrefEnv();
  await CustomizableUI.reset();
});
