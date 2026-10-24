/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, BrowserCommands, MozXULElement, TabContextMenu */

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
 * Tab button sits above the other tabs, as in Arc. In the expanded sidebar it
 * is the first row of the scrolled tab list, so it scrolls with the tabs. It
 * lives in the tab list's shadow tree, so tab code that walks the list's
 * children never sees it.
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
let listButton = null;

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
  new MutationObserver(scheduleUpdate).observe(gBrowser.tabContainer, {
    attributes: true,
    attributeFilter: ["orient", "expanded"],
  });
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
  let newTabAtTop = Services.prefs.getBoolPref(NEW_TAB_AT_TOP_PREF, false);
  gBrowser.tabContainer.toggleAttribute("newtab-at-top", newTabAtTop);
  let tabs = gBrowser.tabContainer;
  if (newTabAtTop && tabs.verticalMode) {
    ensureListButton();
    tabs.arrowScrollbox.setAttribute(
      "newtab-row",
      tabs.hasAttribute("expanded") ? "expanded" : "collapsed"
    );
  } else {
    tabs.arrowScrollbox.removeAttribute("newtab-row");
  }
  let setting = Services.prefs.getIntPref(COLUMNS_PREF, 0);
  let count = gBrowser.visibleTabs.filter(tab => tab.pinned).length;
  // Pinned tabs of other spaces are hidden, not removed, so :empty misses them.
  container.toggleAttribute("no-visible-pins", !count);
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

/** Adds the New Tab row at the start of the scrolled tab list. */
function ensureListButton() {
  if (listButton) {
    return;
  }
  let scrollbox = gBrowser.tabContainer.arrowScrollbox.scrollbox;
  let link = document.createElementNS("http://www.w3.org/1999/xhtml", "link");
  link.rel = "stylesheet";
  link.href = "chrome://browser/content/tabbrowser/newtab-in-list.css";
  listButton = document.createXULElement("toolbarbutton");
  listButton.id = "tabs-list-newtab-button";
  listButton.className = "toolbarbutton-1";
  listButton.setAttribute("part", "list-newtab-button");
  listButton.addEventListener("command", event =>
    BrowserCommands.openTab({ event })
  );
  scrollbox.prepend(link, listButton);
  let source = document.getElementById("vertical-tabs-newtab-button");
  let copyLabel = () => {
    listButton.setAttribute("label", source.getAttribute("label") ?? "");
    listButton.setAttribute(
      "tooltiptext",
      source.getAttribute("tooltiptext") ?? ""
    );
  };
  copyLabel();
  new MutationObserver(copyLabel).observe(source, {
    attributes: true,
    attributeFilter: ["label", "tooltiptext"],
  });
}

/**
 * Shows the layout submenu in the tab context menu for pinned tabs.
 *
 * @param {MozTabbrowserTab} contextTab
 */
export function updateTabContextMenu(contextTab) {
  updateEditPinnedPageMenu(contextTab);
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

const DIALOG_STYLESHEET =
  "chrome://browser/content/tabbrowser/pinned-url-dialog.css";

/**
 * The URL a pinned tab shows now, or null when it has none worth pinning.
 *
 * @param {MozTabbrowserTab} tab
 * @returns {string|null}
 */
function currentURLOf(tab) {
  let spec = tab.linkedBrowser.currentURI?.spec;
  return spec && spec != "about:blank" ? spec : null;
}

function updateEditPinnedPageMenu(contextTab) {
  let menu = document.getElementById("context_editPinnedPage");
  if (!menu) {
    return;
  }
  menu.hidden = !contextTab.pinned || gBrowser.multiSelectedTabsCount > 0;
  if (menu.hidden) {
    return;
  }
  let replace = document.getElementById("context_replacePinnedURL");
  let current = currentURLOf(contextTab);
  replace.disabled =
    !current || current == contextTab.getAttribute("pinned-url");
  if (!menu._pinnedURLListener) {
    menu._pinnedURLListener = event => {
      let tab = TabContextMenu.contextTab;
      if (event.target.id == "context_replacePinnedURL") {
        gBrowser.setPinnedURL(tab, currentURLOf(tab));
      } else if (event.target.id == "context_editPinnedURL") {
        openPinnedURLDialog(tab);
      }
    };
    menu.addEventListener("command", menu._pinnedURLListener);
  }
}

let dialog = null;

function getDialog() {
  if (dialog) {
    return dialog;
  }
  window.windowUtils.loadSheetUsingURIString(
    DIALOG_STYLESHEET,
    window.windowUtils.AUTHOR_SHEET
  );
  MozXULElement.insertFTLIfNeeded("browser/tabbrowser.ftl");
  let fragment = MozXULElement.parseXULToFragment(`
    <panel id="pinned-url-panel" role="dialog" noautofocus="true"
           aria-labelledby="pinned-url-title"
           aria-describedby="pinned-url-description">
      <html:form id="pinned-url-form">
        <html:img id="pinned-url-icon" alt=""/>
        <html:h1 id="pinned-url-title" data-l10n-id="pinned-url-dialog-title"/>
        <html:p id="pinned-url-description"
                data-l10n-id="pinned-url-dialog-description"/>
        <html:input id="pinned-url-input" type="text" spellcheck="false"
                    data-l10n-id="pinned-url-dialog-input"/>
        <html:moz-button-group>
          <html:moz-button id="pinned-url-cancel">
            <html:span data-l10n-id="pinned-url-dialog-cancel"/>
            <html:kbd>esc</html:kbd>
          </html:moz-button>
          <html:moz-button id="pinned-url-save" type="primary">
            <html:span data-l10n-id="pinned-url-dialog-save"/>
            <html:kbd>↵</html:kbd>
          </html:moz-button>
        </html:moz-button-group>
      </html:form>
    </panel>`);
  dialog = fragment.firstElementChild;
  document.getElementById("mainPopupSet").append(dialog);
  let input = dialog.querySelector("#pinned-url-input");
  let save = dialog.querySelector("#pinned-url-save");
  let parse = () => {
    let text = input.value.trim();
    if (!text) {
      return null;
    }
    try {
      return Services.uriFixup.getFixupURIInfo(
        text,
        Services.uriFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
      ).preferredURI?.spec;
    } catch {
      return null;
    }
  };
  let commit = () => {
    let url = parse();
    if (!url || !dialog._tab?.pinned) {
      return;
    }
    gBrowser.setPinnedURL(dialog._tab, url);
    dialog.hidePopup();
  };
  input.addEventListener("input", () => {
    save.disabled = !parse();
  });
  dialog.querySelector("#pinned-url-form").addEventListener("submit", event => {
    event.preventDefault();
    commit();
  });
  input.addEventListener("keydown", event => {
    if (event.key == "Enter") {
      event.preventDefault();
      commit();
    }
  });
  save.addEventListener("click", commit);
  dialog
    .querySelector("#pinned-url-cancel")
    .addEventListener("click", () => dialog.hidePopup());
  dialog.addEventListener("popupshown", () => {
    input.focus();
    input.select();
  });
  dialog.addEventListener("popuphidden", () => {
    dialog._tab = null;
  });
  return dialog;
}

/**
 * Opens a dialog centered over the window that edits the address a pinned
 * tab resets to.
 *
 * @param {MozTabbrowserTab} tab
 */
export function openPinnedURLDialog(tab) {
  if (!tab?.pinned) {
    return;
  }
  let popup = getDialog();
  popup._tab = tab;
  let input = popup.querySelector("#pinned-url-input");
  input.value = tab.getAttribute("pinned-url") || currentURLOf(tab) || "";
  popup.querySelector("#pinned-url-save").disabled = !input.value;
  let icon = popup.querySelector("#pinned-url-icon");
  let image = gBrowser.getIcon(tab);
  icon.hidden = !image;
  if (image) {
    icon.src = image;
  }
  let width = 400;
  let x = window.mozInnerScreenX + (window.innerWidth - width) / 2;
  let y = window.mozInnerScreenY + window.innerHeight / 4;
  popup.openPopupAtScreen(Math.round(x), Math.round(y), false);
}
