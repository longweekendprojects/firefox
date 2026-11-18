/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Repairs the toolbar of profiles first started with vertical tabs on by
 * default before bug 1936168 was picked up. Those profiles got the vertical
 * tabs extras as their whole toolbar, so Back and Forward ended up after the
 * address bar in reverse order, and the sidebar and Reload buttons were lost.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
});

const DONE_PREF = "browser.toolbar.navbarRepair.done";
const LEADING = [
  "sidebar-button",
  "back-button",
  "forward-button",
  "stop-reload-button",
];

/**
 * @param {string[]} ids
 *   The widget IDs in the navigation toolbar.
 * @returns {boolean}
 */
export function isBroken(ids) {
  const urlbar = ids.indexOf("urlbar-container");
  return (
    urlbar != -1 &&
    !ids.includes("stop-reload-button") &&
    ids.indexOf("back-button") > urlbar &&
    ids.indexOf("forward-button") > urlbar
  );
}

export const NavbarRepair = {
  run() {
    if (Services.prefs.getBoolPref(DONE_PREF, false)) {
      return;
    }
    Services.prefs.setBoolPref(DONE_PREF, true);
    const CustomizableUI = lazy.CustomizableUI;
    const navbar = CustomizableUI.AREA_NAVBAR;
    const ids = CustomizableUI.getWidgetIdsInArea(navbar);
    if (!isBroken(ids)) {
      return;
    }
    const stray = ids
      .slice(0, ids.indexOf("urlbar-container"))
      .filter(
        id =>
          !LEADING.includes(id) &&
          id != "vertical-spacer" &&
          id != "home-button" &&
          !CustomizableUI.isSpecialWidget(id)
      );
    CustomizableUI.beginBatchUpdate();
    try {
      LEADING.forEach((id, position) => {
        if (CustomizableUI.getPlacementOfWidget(id)?.area == navbar) {
          CustomizableUI.moveWidgetWithinArea(id, position);
        } else {
          CustomizableUI.addWidgetToArea(id, navbar, position);
        }
      });
      for (const id of stray) {
        CustomizableUI.moveWidgetWithinArea(id);
      }
      const placed = CustomizableUI.getWidgetIdsInArea(navbar);
      const spacer = placed.indexOf("vertical-spacer");
      const urlbar = placed.indexOf("urlbar-container");
      if (spacer > urlbar) {
        CustomizableUI.moveWidgetWithinArea("vertical-spacer", urlbar);
      }
    } finally {
      CustomizableUI.endBatchUpdate();
    }
  },
};
