/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The pinned tab layout is chosen in the Customize sidebar panel, under the
// vertical tabs setting.

const PINNED_LAYOUT_PREF = "browser.tabs.pinnedTiles.columns";

async function showCustomizePanel() {
  await SidebarController.show("viewCustomizeSidebar");
  if (SidebarController.browser.contentDocument.readyState != "complete") {
    await BrowserTestUtils.waitForEvent(
      SidebarController.browser,
      "load",
      true
    );
  }
  const customize =
    SidebarController.browser.contentDocument.querySelector(
      "sidebar-customize"
    );
  await TestUtils.waitForCondition(
    () => customize.positionInput,
    "Customize panel rendered"
  );
  return customize;
}

add_setup(async () => {
  await SpecialPowers.pushPrefEnv({
    set: [
      [VERTICAL_TABS_PREF, true],
      [PINNED_LAYOUT_PREF, 0],
    ],
  });
  await SidebarTestUtils.waitForTabstripOrientation(window, "vertical");
});

add_task(async function test_pinned_layout_select() {
  const customize = await showCustomizePanel();
  await TestUtils.waitForCondition(
    () => customize.pinnedLayoutInput,
    "Pinned tabs layout select rendered"
  );
  const select = customize.pinnedLayoutInput;
  Assert.ok(BrowserTestUtils.isVisible(select), "The select is visible");
  Assert.equal(select.value, "0", "Automatic is selected");
  Assert.equal(select.options.length, 7, "All layouts are offered");

  select.value = "3";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  Assert.equal(
    Services.prefs.getIntPref(PINNED_LAYOUT_PREF),
    3,
    "Choosing 3 across sets the layout"
  );
  Assert.ok(
    Services.prefs.getBoolPref(VERTICAL_TABS_PREF),
    "Changing the layout leaves vertical tabs on"
  );

  Services.prefs.setIntPref(PINNED_LAYOUT_PREF, -1);
  await TestUtils.waitForCondition(
    () => select.value == "-1",
    "The select follows the pref"
  );

  await SpecialPowers.pushPrefEnv({ set: [[VERTICAL_TABS_PREF, false]] });
  await TestUtils.waitForCondition(
    () => !customize.pinnedLayoutInput,
    "The select is removed with horizontal tabs"
  );
  await SpecialPowers.popPrefEnv();
  SidebarController.hide();
});
