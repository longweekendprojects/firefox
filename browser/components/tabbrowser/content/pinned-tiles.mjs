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
 * rows of small icon tiles, and -2 keeps the stock pinned tabs. A small
 * button under the grid opens a menu with these layouts and an item that
 * hides the sidebar.
 *
 * With browser.tabs.vertical.newTabButtonAtTop, the vertical tab strip's New
 * Tab button sits above the other tabs, as in Arc.
 */

const COLUMNS_PREF = "browser.tabs.pinnedTiles.columns";
const NEW_TAB_AT_TOP_PREF = "browser.tabs.vertical.newTabButtonAtTop";
const MAX_AUTO_COLUMNS = 4;
const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabShow",
  "TabHide",
  "TabOpen",
  "TabClose",
];

const LAYOUTS = [0, 2, 3, 4, 5, 6, -1];

let container = null;
let bar = null;
let menu = null;
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
  Services.prefs.addObserver(NEW_TAB_AT_TOP_PREF, scheduleUpdate);
  window.addEventListener("unload", uninit, { once: true });
  buildBar();
  update();
}

function buildBar() {
  bar = document.createXULElement("hbox");
  bar.id = "pinned-tiles-bar";
  bar.hidden = true;
  let button = document.createXULElement("toolbarbutton");
  button.id = "pinned-tiles-menu-button";
  document.l10n.setAttributes(button, "pinned-tiles-menu-button");
  button.addEventListener("command", () =>
    getMenu().openPopup(button, "after_end")
  );
  bar.append(button);
  let splitter = document.getElementById("vertical-pinned-tabs-splitter");
  (splitter ?? container).after(bar);
}

function getMenu() {
  if (menu) {
    return menu;
  }
  menu = document.createXULElement("menupopup");
  menu.id = "pinned-tiles-menu";
  for (let value of LAYOUTS) {
    if (value < 0) {
      menu.append(document.createXULElement("menuseparator"));
    }
    let item = document.createXULElement("menuitem");
    item.setAttribute("type", "radio");
    item.setAttribute("name", "pinnedTilesLayout");
    item.setAttribute("value", String(value));
    if (value == 0) {
      document.l10n.setAttributes(item, "tab-context-pinned-layout-auto");
    } else if (value < 0) {
      document.l10n.setAttributes(item, "tab-context-pinned-layout-icons");
    } else {
      document.l10n.setAttributes(item, "tab-context-pinned-layout-columns", {
        columns: value,
      });
    }
    menu.append(item);
  }
  menu.append(document.createXULElement("menuseparator"));
  let hide = document.createXULElement("menuitem");
  hide.id = "pinned-tiles-hide-sidebar";
  document.l10n.setAttributes(hide, "pinned-tiles-hide-sidebar");
  menu.append(hide);
  menu.addEventListener("command", event => {
    if (event.target == hide) {
      hideSidebar();
    } else {
      setColumns(event.target.value);
    }
  });
  menu.addEventListener("popupshowing", () => {
    let setting = String(Services.prefs.getIntPref(COLUMNS_PREF, 0));
    for (let item of menu.querySelectorAll("menuitem[value]")) {
      item.toggleAttribute("checked", item.getAttribute("value") == setting);
    }
  });
  document.getElementById("mainPopupSet").append(menu);
  return menu;
}

/**
 * Hides the whole sidebar, tabs included. The sidebar button and the
 * toggle sidebar shortcut show it again.
 */
export async function hideSidebar() {
  let controller = window.SidebarController;
  if (
    Services.prefs.getStringPref("sidebar.visibility", "") != "hide-sidebar"
  ) {
    Services.prefs.setStringPref("sidebar.visibility", "hide-sidebar");
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  }
  if (!controller.sidebarContainer.hidden) {
    await controller.handleToolbarButtonClick();
  }
}

function uninit() {
  Services.prefs.removeObserver(COLUMNS_PREF, scheduleUpdate);
  Services.prefs.removeObserver(NEW_TAB_AT_TOP_PREF, scheduleUpdate);
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
  if (bar) {
    bar.hidden = !count;
  }
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
