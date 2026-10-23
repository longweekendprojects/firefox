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
 * number of columns from the number of pinned tabs, 2 to 6 fix it, -1 shows
 * rows of small icon tiles, and -2 keeps the stock pinned tabs. The layout
 * is chosen in Settings or from the pinned tab context menu.
 *
 * With browser.tabs.vertical.newTabButtonAtTop, the vertical tab strip's New
 * Tab button sits above the other tabs, as in Arc.
 */

const COLUMNS_PREF = "browser.tabs.pinnedTiles.columns";
const NEW_TAB_AT_TOP_PREF = "browser.tabs.vertical.newTabButtonAtTop";
const MIN_AUTO_TILE_WIDTH = 44;
const TILE_GAP = 8;
const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabShow",
  "TabHide",
  "TabOpen",
  "TabClose",
];

let container = null;
let resizeObserver = null;
let lastWidth = 0;
let pendingFrame = 0;

/**
 * Columns for `count` tiles in automatic layout: as many tiles per row as
 * fit in `width`, with the tiles spread evenly over the rows.
 *
 * @param {number} count
 * @param {number} width - Width available to the grid, in CSS pixels.
 * @returns {number}
 */
export function autoColumns(count, width) {
  if (count <= 1) {
    return 1;
  }
  let maxColumns = Math.max(
    1,
    Math.floor((width + TILE_GAP) / (MIN_AUTO_TILE_WIDTH + TILE_GAP))
  );
  let rows = Math.ceil(count / maxColumns);
  return Math.ceil(count / rows);
}

/** Width available to the tile grid inside the pinned tabs container. */
export function gridWidth() {
  let inner =
    parseFloat(
      window
        .getComputedStyle(container)
        .getPropertyValue("--tab-inner-inline-margin")
    ) || 0;
  return container.getBoundingClientRect().width - 2 * (inner + 2);
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
  Services.prefs.addObserver(NEW_TAB_AT_TOP_PREF, scheduleUpdate);
  window.addEventListener("unload", uninit, { once: true });
  resizeObserver = new ResizeObserver(([entry]) => {
    let width = Math.round(entry.contentRect.width);
    if (width != lastWidth) {
      lastWidth = width;
      if (Services.prefs.getIntPref(COLUMNS_PREF, 0) == 0) {
        scheduleUpdate();
      }
    }
  });
  resizeObserver.observe(container);
  update();
}

function uninit() {
  Services.prefs.removeObserver(COLUMNS_PREF, scheduleUpdate);
  Services.prefs.removeObserver(NEW_TAB_AT_TOP_PREF, scheduleUpdate);
  resizeObserver?.disconnect();
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
  gBrowser.tabContainer.toggleAttribute(
    "newtab-at-top",
    Services.prefs.getBoolPref(NEW_TAB_AT_TOP_PREF, false)
  );
  let setting = Services.prefs.getIntPref(COLUMNS_PREF, 0);
  let count = gBrowser.visibleTabs.filter(tab => tab.pinned).length;
  if (setting < -1) {
    container.removeAttribute("tile-layout");
    container.style.removeProperty("--pinned-tile-columns");
    return;
  }
  if (setting == -1) {
    container.setAttribute("tile-layout", "icons");
    container.style.removeProperty("--pinned-tile-columns");
    return;
  }
  let columns = setting
    ? Math.min(Math.max(setting, 2), 6)
    : autoColumns(count, gridWidth());
  container.setAttribute("tile-layout", setting ? "fixed" : "auto");
  container.style.setProperty("--pinned-tile-columns", columns);
}

/**
 * Shows the layout submenu in the tab context menu for pinned tabs.
 *
 * @param {MozTabbrowserTab} contextTab
 */
export function updateTabContextMenu(contextTab) {
  let layoutMenu = document.getElementById("context_pinnedTabLayout");
  if (!layoutMenu) {
    return;
  }
  layoutMenu.hidden = !contextTab.pinned || !gBrowser.tabContainer.verticalMode;
  if (layoutMenu.hidden) {
    return;
  }
  if (!layoutMenu._pinnedTilesListener) {
    layoutMenu._pinnedTilesListener = event => setColumns(event.target.value);
    layoutMenu.addEventListener("command", layoutMenu._pinnedTilesListener);
  }
  let setting = String(Services.prefs.getIntPref(COLUMNS_PREF, 0));
  for (let item of layoutMenu.querySelectorAll("menuitem")) {
    item.toggleAttribute("checked", item.getAttribute("value") == setting);
  }
}

/** Sets the layout from a menu item's value. */
export function setColumns(value) {
  Services.prefs.setIntPref(COLUMNS_PREF, Number(value));
}
