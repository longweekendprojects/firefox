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
    ],
  });
  await openPreferencesViaOpenPreferencesAPI(TABS_PANE, { leaveOpen: true });
  const doc = gBrowser.contentDocument;

  for (let [id, pref] of [
    ["peekLinks", "browser.peek.enabled"],
    ["openAppLinksInLittleWindow", "browser.littlewindow.externalLinks"],
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

add_task(async function test_pinned_tabs_layout_select() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.verticalTabs", true],
      ["browser.tabs.pinnedTiles.columns", 0],
    ],
  });
  await openPreferencesViaOpenPreferencesAPI(TABS_PANE, { leaveOpen: true });
  const doc = gBrowser.contentDocument;
  await TestUtils.waitForCondition(
    () => doc.getElementById("pinnedTabsLayout"),
    "Pinned tabs layout select rendered"
  );
  let select = doc.getElementById("pinnedTabsLayout");
  is_element_visible(select, "The select shows with vertical tabs");
  Assert.equal(select.value, "0", "Automatic is selected");

  await changeMozSelectValue(select, "3");
  Assert.equal(
    Services.prefs.getIntPref("browser.tabs.pinnedTiles.columns"),
    3,
    "Choosing 3 across sets the pref"
  );
  await changeMozSelectValue(select, "-1");
  Assert.equal(
    Services.prefs.getIntPref("browser.tabs.pinnedTiles.columns"),
    -1,
    "Choosing small icons sets the pref"
  );

  Services.prefs.setBoolPref("sidebar.verticalTabs", false);
  await TestUtils.waitForCondition(
    () => BrowserTestUtils.isHidden(select),
    "The select hides with horizontal tabs"
  );

  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(gBrowser.selectedTab, { animate: false });
});
