/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, gURLBar */

/**
 * Shows the address bar as a command bar: a floating search box centered over
 * the selected page or split pane. It is Firefox's own address bar, lifted
 * into the top layer, so its results and behavior are unchanged. Loaded on
 * first use, and it keeps listeners only while open.
 */

const STYLESHEET = "chrome://browser/content/tabbrowser/command-bar.css";
const MARGIN = 12;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
// Space kept free below the bar for its results, in CSS pixels.
const RESULTS_ROOM = 380;
// How far down the page the bar sits, as a fraction of the page height.
const TOP_FRACTION = 0.35;
// Share of the page width the bar takes, up to MAX_WIDTH.
const WIDTH_FRACTION = 0.8;
const PROPERTIES = ["left", "top", "width"];

let sheetLoaded = false;
// The tab a new-tab command bar was opened over, while it is open.
let newTabOwner = null;

export function isOpen() {
  return gURLBar.hasAttribute("commandbar");
}

/** Opens the command bar over the selected page. */
export function show() {
  if (!sheetLoaded) {
    window.windowUtils.loadSheetUsingURIString(
      STYLESHEET,
      window.windowUtils.AUTHOR_SHEET
    );
    sheetLoaded = true;
  }
  if (gBrowser.selectedTab != newTabOwner) {
    leaveNewTab();
  }
  position();
  if (isOpen()) {
    return;
  }
  gURLBar.setAttribute("commandbar", "");
  gURLBar.setAttribute("popover", "manual");
  gURLBar.showPopover();
  // The results anchor to the bar, so they must sit above it in the top layer.
  if (gURLBar.panel.matches(":popover-open")) {
    gURLBar.panel.hidePopover();
    gURLBar.panel.showPopover();
  }
  gURLBar.inputField.addEventListener("blur", handler);
  gURLBar.inputField.addEventListener("keydown", handler);
  window.addEventListener("resize", handler);
}

/**
 * Opens an empty command bar over the selected page. What it loads opens in a
 * new tab, so closing it leaves the page untouched.
 *
 * @param {Event} event The command that asked for a new tab.
 * @returns {boolean} Whether the command bar opened.
 */
export function showNewTab(event) {
  newTabOwner = gBrowser.selectedTab;
  gURLBar.commandBarNewTab = true;
  gURLBar.focus();
  if (!gURLBar.focused) {
    leaveNewTab();
    return false;
  }
  gURLBar.value = "";
  show();
  gURLBar.view.autoOpen({ event });
  return true;
}

/** Returns the command bar to editing the selected page's address. */
export function leaveNewTab() {
  if (!gURLBar.commandBarNewTab) {
    return;
  }
  gURLBar.commandBarNewTab = false;
  if (gBrowser.selectedTab == newTabOwner) {
    gURLBar.handleRevert();
  } else if (newTabOwner?.linkedBrowser) {
    newTabOwner.linkedBrowser.userTypedValue = null;
  }
  newTabOwner = null;
}

/** Centers the open command bar over the selected page. */
export function position() {
  const area = gBrowser.selectedBrowser.getBoundingClientRect();
  const width = Math.max(
    Math.min(
      area.width - 2 * MARGIN,
      Math.max(MIN_WIDTH, area.width * WIDTH_FRACTION),
      MAX_WIDTH
    ),
    Math.min(MIN_WIDTH, window.innerWidth - 2 * MARGIN)
  );
  const left = Math.max(
    MARGIN,
    Math.min(
      area.left + (area.width - width) / 2,
      window.innerWidth - MARGIN - width
    )
  );
  const offset = Math.max(
    MARGIN,
    Math.min(area.height * TOP_FRACTION, area.height - RESULTS_ROOM)
  );
  const style = document.documentElement.style;
  style.setProperty("--commandbar-left", left + "px");
  style.setProperty("--commandbar-top", area.top + offset + "px");
  style.setProperty("--commandbar-width", width + "px");
}

export function hide() {
  if (!isOpen()) {
    return;
  }
  gURLBar.inputField.removeEventListener("blur", handler);
  gURLBar.inputField.removeEventListener("keydown", handler);
  window.removeEventListener("resize", handler);
  leaveNewTab();
  gURLBar.hidePopover();
  gURLBar.removeAttribute("popover");
  gURLBar.removeAttribute("commandbar");
  for (const property of PROPERTIES) {
    document.documentElement.style.removeProperty("--commandbar-" + property);
  }
}

const handler = {
  handleEvent(event) {
    switch (event.type) {
      case "blur":
        if (!gURLBar.view.isResultMenuOpen()) {
          hide();
        }
        break;
      case "keydown":
        if (event.key == "Escape") {
          gURLBar.handleRevert();
          gBrowser.selectedBrowser.focus();
        }
        break;
      case "resize":
        position();
        break;
    }
  },
};
