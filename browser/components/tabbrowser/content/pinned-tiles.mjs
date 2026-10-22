/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser */

/**
 * Pinned tiles: in the expanded vertical tab strip, pinned tabs show as a
 * grid of large tiles above the other tabs, like Arc's favorites. The grid
 * has as many rows as its tiles need.
 *
 * The browser.tabs.pinnedTiles.columns pref sets the layout: 0 picks the
 * number of columns from the number of pinned tabs, 2 to 6 fix it, and -1
 * keeps the stock row of small icons.
 */

const COLUMNS_PREF = "browser.tabs.pinnedTiles.columns";
const MAX_AUTO_COLUMNS = 4;
const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabShow",
  "TabHide",
  "TabOpen",
  "TabClose",
];

let container = null;
let pendingFrame = 0;

/**
 * Columns for `count` tiles in automatic layout: rows of up to four, with
 * the tiles spread evenly over the rows.
 *
 * @param {number} count
 * @returns {number}
 */
export function autoColumns(count) {
  if (count <= 1) {
    return 1;
  }
  let rows = Math.ceil(count / MAX_AUTO_COLUMNS);
  return Math.ceil(count / rows);
}

export function init() {
  container = gBrowser.pinnedTabsContainer;
  if (!container) {
    return;
  }
  for (let type of TAB_EVENTS) {
    gBrowser.tabContainer.addEventListener(type, scheduleUpdate);
  }
  Services.prefs.addObserver(COLUMNS_PREF, scheduleUpdate);
  window.addEventListener("unload", uninit, { once: true });
  update();
}

function uninit() {
  Services.prefs.removeObserver(COLUMNS_PREF, scheduleUpdate);
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
  }
}

function scheduleUpdate() {
  if (!pendingFrame) {
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = 0;
      update();
    });
  }
}

/** Applies the layout pref to the pinned tabs container. */
export function update() {
  let setting = Services.prefs.getIntPref(COLUMNS_PREF, 0);
  if (setting < 0) {
    container.removeAttribute("tile-layout");
    container.style.removeProperty("--pinned-tile-columns");
    return;
  }
  let count = gBrowser.visibleTabs.filter(tab => tab.pinned).length;
  let columns = setting
    ? Math.min(Math.max(setting, 2), 6)
    : autoColumns(count);
  container.setAttribute("tile-layout", setting ? "fixed" : "auto");
  container.style.setProperty("--pinned-tile-columns", columns);
}

/**
 * Shows the layout submenu in the tab context menu for pinned tabs.
 *
 * @param {MozTabbrowserTab} contextTab
 */
export function updateTabContextMenu(contextTab) {
  let menu = document.getElementById("context_pinnedTabLayout");
  if (!menu) {
    return;
  }
  menu.hidden = !contextTab.pinned || !gBrowser.tabContainer.verticalMode;
  if (menu.hidden) {
    return;
  }
  if (!menu._pinnedTilesListener) {
    menu._pinnedTilesListener = event => setColumns(event.target.value);
    menu.addEventListener("command", menu._pinnedTilesListener);
  }
  let setting = String(Services.prefs.getIntPref(COLUMNS_PREF, 0));
  for (let item of menu.querySelectorAll("menuitem")) {
    item.toggleAttribute("checked", item.getAttribute("value") == setting);
  }
}

/** Sets the layout from a menu item's value. */
export function setColumns(value) {
  Services.prefs.setIntPref(COLUMNS_PREF, Number(value));
}
