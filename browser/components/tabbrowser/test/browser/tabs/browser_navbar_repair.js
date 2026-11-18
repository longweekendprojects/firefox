/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { NavbarRepair, isBroken } = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/NavbarRepair.sys.mjs"
);

const DONE_PREF = "browser.toolbar.navbarRepair.done";
const BROKEN = [
  "sidebar-button",
  "alltabs-button",
  "reset-pbm-toolbar-button",
  "unified-extensions-button",
  "urlbar-container",
  "vertical-spacer",
  "forward-button",
  "back-button",
];

const LEADING_IDS = [
  "sidebar-button",
  "back-button",
  "forward-button",
  "stop-reload-button",
];

function navbarIds() {
  return CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR);
}

function setNavbar(ids) {
  const navbar = CustomizableUI.AREA_NAVBAR;
  for (const id of navbarIds()) {
    if (!ids.includes(id) && CustomizableUI.isWidgetRemovable(id)) {
      CustomizableUI.removeWidgetFromArea(id);
    }
  }
  ids.forEach((id, position) =>
    CustomizableUI.addWidgetToArea(id, navbar, position)
  );
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(DONE_PREF);
    await CustomizableUI.reset();
    await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  });
});

add_task(async function test_default_navbar_order() {
  const ids = navbarIds();
  Assert.ok(!isBroken(ids), "The default toolbar is not broken");
  const urlbar = ids.indexOf("urlbar-container");
  for (const id of LEADING_IDS) {
    const index = ids.indexOf(id);
    Assert.greater(index, -1, `${id} is in the toolbar`);
    Assert.less(index, urlbar, `${id} is before the address bar`);
  }
  Assert.less(
    ids.indexOf("back-button"),
    ids.indexOf("forward-button"),
    "Back comes before Forward"
  );
});

add_task(async function test_repairs_broken_navbar() {
  setNavbar(BROKEN);
  Assert.ok(isBroken(navbarIds()), "The toolbar is in the broken order");
  Services.prefs.clearUserPref(DONE_PREF);
  NavbarRepair.run();
  const ids = navbarIds();
  Assert.deepEqual(
    ids.slice(0, 4),
    LEADING_IDS,
    "Sidebar, Back, Forward and Reload lead the toolbar"
  );
  Assert.deepEqual(
    ids.slice(4),
    [
      "vertical-spacer",
      "urlbar-container",
      "alltabs-button",
      "reset-pbm-toolbar-button",
      "unified-extensions-button",
    ],
    "The other buttons follow the address bar in their old order"
  );
  Assert.ok(Services.prefs.getBoolPref(DONE_PREF), "The repair is recorded");
});

add_task(async function test_runs_once() {
  setNavbar(BROKEN);
  NavbarRepair.run();
  Assert.deepEqual(navbarIds(), BROKEN, "A second run leaves the toolbar");
});

add_task(async function test_broken_without_sidebar_button() {
  setNavbar(BROKEN.slice(1));
  CustomizableUI.removeWidgetFromArea("sidebar-button");
  Services.prefs.clearUserPref(DONE_PREF);
  NavbarRepair.run();
  Assert.deepEqual(
    navbarIds().slice(0, 4),
    LEADING_IDS,
    "A missing sidebar button is added back"
  );
});
