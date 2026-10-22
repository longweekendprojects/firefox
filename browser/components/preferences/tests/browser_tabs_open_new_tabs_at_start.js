/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PREF_NAME = "browser.tabs.insertAtStart";
const TABS_PANE = SRD_PREF_VALUE ? "paneTabsBrowsing" : "paneGeneral";

add_task(async function test_default_is_on() {
  Assert.ok(
    Services.prefs.getDefaultBranch("").getBoolPref(PREF_NAME),
    "new tabs open at the top of the tab list by default"
  );
});

add_task(async function test_open_new_tabs_at_start_checkbox() {
  await SpecialPowers.pushPrefEnv({ set: [[PREF_NAME, false]] });
  await openPreferencesViaOpenPreferencesAPI(TABS_PANE, { leaveOpen: true });

  const doc = gBrowser.contentDocument;
  await TestUtils.waitForCondition(
    () => doc.getElementById("openNewTabsAtStart"),
    "openNewTabsAtStart checkbox rendered"
  );
  const checkbox = doc.getElementById("openNewTabsAtStart");
  Assert.ok(!checkbox.checked, "checkbox is unchecked when the pref is off");

  let becameChecked = BrowserTestUtils.waitForAttribute("checked", checkbox);
  checkbox.click();
  await becameChecked;
  Assert.ok(Services.prefs.getBoolPref(PREF_NAME), "checking turns pref on");

  let becameUnchecked = BrowserTestUtils.waitForAttributeRemoval(
    "checked",
    checkbox
  );
  checkbox.click();
  await becameUnchecked;
  Assert.ok(!Services.prefs.getBoolPref(PREF_NAME), "unchecking turns it off");

  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(gBrowser.selectedTab, { animate: false });
});
