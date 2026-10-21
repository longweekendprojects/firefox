/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, isBlankPageURL, openTrustedLinkIn, UrlbarUtils, BrowserUtils,
   updateBookmarkToolbarVisibility */

/**
 * Renders the active split view as a recursive layout of panes.
 *
 * Loaded into a browser window on its first split view. Browser panels stay
 * direct children of tabpanels; this module only positions them, adds a small
 * header (Back, Forward, Reload, address, Close) to each visible pane, and
 * draws one splitter per split. While panes are shown, the window's own
 * navigation controls are hidden, because each pane has its own. Panes along
 * the top edge show their header in the toolbar row, in the space those
 * controls leave, so the window keeps a single row of controls. Everything it
 * adds is removed when the split view is hidden, so a window without a
 * visible split view keeps no listeners, observers, or DOM.
 */

const M = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
);

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PANEL_EVENTS = [
  "command",
  "contextmenu",
  "mousedown",
  "keydown",
  "focusin",
  "focusout",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
];
const STYLESHEET = "chrome://browser/content/tabbrowser/splitview-panes.css";

export const MIN_PANE_WIDTH = 140;
export const MIN_PANE_HEIGHT = 120;

// Space around and between panes, in CSS pixels.
const GAP = 6;
// Ratio change for one splitter arrow key press.
const KEY_STEP = 0.02;
// Pointer travel (px) before a splitter press counts as a resize.
const DRAG_SLOP = 3;
// Pointer travel, in CSS pixels, before a pane bar press becomes a drag.
const DRAG_THRESHOLD = 5;
// Half-size of the central drop zone that swaps two panes, as a fraction.
const SWAP_ZONE = 0.2;
// Narrowest header the toolbar row takes; narrower ones stay in their pane.
const MIN_TOOLBAR_HEADER = 120;
// Window controls hidden while panes are shown; pane headers use their space.
const HIDDEN_NAV_IDS = new Set([
  "back-button",
  "forward-button",
  "stop-reload-button",
  "home-button",
  "urlbar-container",
]);

/** The split view wrapper currently rendered in this window, if any. */
let current = null;
let splitterBox = null;
/** Box in the toolbar row that holds the headers of top-edge panes. */
let toolbarBox = null;
/** Header of each pane being shown, by tab. */
const headers = new Map();
let resizeObserver = null;
let pendingFrame = 0;
let sheetLoaded = false;
let drag = null;
/** A press on a pane bar that may become a pane drag. */
let grab = null;

const progressListener = {
  onLocationChange(browser, webProgress) {
    if (webProgress?.isTopLevel) {
      const tab = gBrowser.getTabForBrowser(browser);
      updateHeader(tab);
      // The bookmarks toolbar depends on every visible pane, and the window
      // only updates it for the selected one.
      if (current && tab?.splitview === current && !tab.selected) {
        updateBookmarkToolbarVisibility();
      }
    }
  },
};

const handler = {
  handleEvent(event) {
    switch (event.type) {
      case "command":
        onCommand(event);
        break;
      case "mousedown":
        onHeaderMouseDown(event);
        break;
      case "contextmenu":
        // The toolbar's own context menu does not apply to pane headers.
        if (event.currentTarget === toolbarBox) {
          event.stopPropagation();
          if (!event.target.classList?.contains("split-pane-url")) {
            event.preventDefault();
          }
        }
        break;
      case "keydown":
        if (event.target.classList?.contains("split-pane-url")) {
          onUrlKeyDown(event);
        } else if (event.target.classList?.contains("split-pane-splitter")) {
          onSplitterKeyDown(event);
        }
        break;
      case "focusin":
      case "focusout":
        if (event.target.classList?.contains("split-pane-url")) {
          const tab = event.target.closest(".split-pane-header")._tab;
          event.target.value = displayURL(tab, event.type == "focusin");
          if (event.type == "focusin") {
            event.target.select();
          }
        }
        break;
      case "pointerdown":
        if (event.currentTarget === splitterBox) {
          onSplitterPointerDown(event);
        } else {
          onHeaderPointerDown(event);
        }
        break;
      case "pointermove":
        if (event.currentTarget === splitterBox) {
          onSplitterPointerMove(event);
        } else {
          onHeaderPointerMove(event);
        }
        break;
      case "pointerup":
      case "pointercancel":
        if (event.currentTarget === splitterBox) {
          onSplitterPointerUp(event);
        } else {
          onHeaderPointerUp(event);
        }
        break;
    }
  },
};

/**
 * Lays out every pane of `wrapper` and shows its headers and splitters.
 *
 * @param {MozTabSplitViewWrapper} wrapper
 */
export function render(wrapper) {
  if (current && current !== wrapper) {
    teardown();
  }
  if (!current) {
    attach();
  }
  current = wrapper;

  const layout = wrapper.layout;
  const area = contentRect();
  const { leaves, splitters } = M.computeLayout(layout, area, GAP);
  const slot = toolbarSlot();
  const panels = slot && gBrowser.tabpanels.getBoundingClientRect();
  for (const { id: tab, x, y, width, height } of leaves) {
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel) {
      continue;
    }
    panel.classList.add("split-pane");
    let header = headers.get(tab);
    if (!header) {
      header = createHeader(tab);
      headers.set(tab, header);
      panel.prepend(header);
      updateHeader(tab);
    }
    // A top-edge pane shows its header in the toolbar row, over its own
    // columns and clear of the toolbar's remaining buttons.
    let start = 0;
    let end = 0;
    if (slot && y <= area.y + 0.5) {
      start = Math.max(panels.left + x, slot.left) - slot.origin;
      end = Math.min(panels.left + x + width, slot.right) - slot.origin;
    }
    if (end - start >= MIN_TOOLBAR_HEADER) {
      if (header.parentNode !== toolbarBox) {
        toolbarBox.append(header);
      }
      header.style.left = start + "px";
      header.style.width = end - start + "px";
    } else if (header.parentNode !== panel) {
      header.style.removeProperty("left");
      header.style.removeProperty("width");
      panel.prepend(header);
    }
    const style = panel.style;
    style.left = x + "px";
    style.top = y + "px";
    style.width = width + "px";
    style.height = height + "px";
  }
  layoutSplitters(layout, splitters);
}

/**
 * Removes pane chrome for `tabs`, and all window-level state when `wrapper`
 * is the split view being shown.
 *
 * @param {MozTabSplitViewWrapper} wrapper
 * @param {MozTabbrowserTab[]} tabs
 */
export function detach(wrapper, tabs) {
  clear(tabs);
  if (current === wrapper) {
    teardown();
  }
}

/**
 * Removes pane chrome and geometry from the panels of `tabs`.
 *
 * @param {MozTabbrowserTab[]} tabs
 */
export function clear(tabs) {
  for (const tab of tabs) {
    headers.get(tab)?.remove();
    headers.delete(tab);
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel?.classList.contains("split-pane")) {
      continue;
    }
    panel.classList.remove("split-pane");
    for (const property of ["left", "top", "width", "height"]) {
      panel.style.removeProperty(property);
    }
  }
}

/**
 * Focuses the address field of the pane showing `tab`.
 *
 * @param {MozTabbrowserTab} tab
 * @param {string} [text] Text to type into the field instead of selecting it.
 * @returns {boolean} Whether a pane address field took focus.
 */
export function focusLocation(tab, text = "") {
  const input = headerFor(tab)?.querySelector(".split-pane-url");
  if (!input) {
    return false;
  }
  input.focus();
  if (text) {
    input.value = text;
  } else {
    input.select();
  }
  return true;
}

function attach() {
  if (!sheetLoaded) {
    window.windowUtils.loadSheetUsingURIString(
      STYLESHEET,
      window.windowUtils.AUTHOR_SHEET
    );
    sheetLoaded = true;
  }
  const tabpanels = gBrowser.tabpanels;
  tabpanels.setAttribute("splitlayout", "");
  document.documentElement.setAttribute("splitpanes", "");
  for (const type of PANEL_EVENTS) {
    tabpanels.addEventListener(type, handler);
  }
  gBrowser.addTabsProgressListener(progressListener);

  splitterBox = document.createElementNS(HTML_NS, "div");
  splitterBox.id = "split-pane-splitters";
  for (const type of [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "keydown",
  ]) {
    splitterBox.addEventListener(type, handler);
  }
  gBrowser.tabbox.append(splitterBox);

  const navbar = document.getElementById("nav-bar");
  if (navbar) {
    toolbarBox = document.createElementNS(HTML_NS, "div");
    toolbarBox.id = "split-pane-toolbar";
    for (const type of PANEL_EVENTS) {
      toolbarBox.addEventListener(type, handler);
    }
    navbar.append(toolbarBox);
  }

  resizeObserver = new ResizeObserver(scheduleRender);
  resizeObserver.observe(tabpanels);
  if (navbar) {
    resizeObserver.observe(navbar);
  }
}

function teardown() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
  grab?.header.removeAttribute("dragging");
  grab = null;
  splitterBox?.remove();
  splitterBox = null;
  toolbarBox?.remove();
  toolbarBox = null;
  for (const header of headers.values()) {
    header.remove();
  }
  headers.clear();
  drag = null;
  gBrowser.removeTabsProgressListener(progressListener);
  const tabpanels = gBrowser.tabpanels;
  for (const type of PANEL_EVENTS) {
    tabpanels.removeEventListener(type, handler);
  }
  tabpanels.removeAttribute("splitlayout");
  document.documentElement.removeAttribute("splitpanes");
  current = null;
}

function scheduleRender() {
  if (pendingFrame) {
    return;
  }
  pendingFrame = window.requestAnimationFrame(() => {
    pendingFrame = 0;
    if (current) {
      render(current);
    }
  });
}

/** Area inside tabpanels available to panes. */
function contentRect() {
  const { clientWidth, clientHeight } = gBrowser.tabpanels;
  return {
    x: GAP,
    y: GAP,
    width: Math.max(0, clientWidth - 2 * GAP),
    height: Math.max(0, clientHeight - 2 * GAP),
  };
}

/**
 * Free span of the toolbar row, in window coordinates: the span of the hidden
 * window controls, widened up to the nearest visible control on each side.
 * Null when the toolbar row is not shown.
 */
function toolbarSlot() {
  const navbar = document.getElementById("nav-bar");
  if (!toolbarBox || !navbar) {
    return null;
  }
  const bar = navbar.getBoundingClientRect();
  if (!bar.width || !bar.height) {
    return null;
  }
  let hiddenStart = Infinity;
  let hiddenEnd = -Infinity;
  for (const id of HIDDEN_NAV_IDS) {
    const rect = document.getElementById(id)?.getBoundingClientRect();
    if (rect?.width) {
      hiddenStart = Math.min(hiddenStart, rect.left);
      hiddenEnd = Math.max(hiddenEnd, rect.right);
    }
  }
  if (hiddenStart >= hiddenEnd) {
    return null;
  }
  let left = bar.left;
  let right = bar.right;
  const items = navbar.querySelectorAll(
    ":scope > *, #nav-bar-customization-target > *"
  );
  for (const item of items) {
    if (
      item === toolbarBox ||
      item.id == "nav-bar-customization-target" ||
      HIDDEN_NAV_IDS.has(item.id)
    ) {
      continue;
    }
    const rect = item.getBoundingClientRect();
    if (!rect.width || !item.checkVisibility({ visibilityProperty: true })) {
      continue;
    }
    if (rect.right <= hiddenStart + 1) {
      left = Math.max(left, rect.right);
    } else if (rect.left >= hiddenEnd - 1) {
      right = Math.min(right, rect.left);
    }
    // Items between the hidden controls, such as spacers, are covered.
  }
  return { left: left + GAP, right: right - GAP, origin: bar.left };
}

function headerFor(tab) {
  return headers.get(tab);
}

function createButton(className, image, l10nId) {
  const button = document.createXULElement("toolbarbutton");
  // Keyboard users reach pane buttons with Tab, like the address field.
  button.className = className + " tabbable";
  button.setAttribute("image", image);
  document.l10n.setAttributes(button, l10nId);
  return button;
}

function createHeader(tab) {
  const header = document.createXULElement("hbox");
  header.className = "split-pane-header";
  header.setAttribute("panel", tab.linkedPanel);
  header.setAttribute("role", "toolbar");
  header._tab = tab;

  const input = document.createElementNS(HTML_NS, "input");
  input.className = "split-pane-url";
  input.setAttribute("spellcheck", "false");
  document.l10n.setAttributes(input, "tab-splitview-pane-address");

  header.append(
    createButton(
      "split-pane-back",
      "chrome://browser/skin/back.svg",
      "tab-splitview-pane-back"
    ),
    createButton(
      "split-pane-forward",
      "chrome://browser/skin/forward.svg",
      "tab-splitview-pane-forward"
    ),
    createButton(
      "split-pane-reload",
      "chrome://global/skin/icons/reload.svg",
      "tab-splitview-pane-reload"
    ),
    input,
    createButton(
      "split-pane-menu",
      "chrome://global/skin/icons/more.svg",
      "tab-splitview-pane-menu"
    ),
    createButton(
      "split-pane-close",
      "chrome://global/skin/icons/close.svg",
      "tab-splitview-pane-close"
    )
  );
  return header;
}

function updateHeader(tab) {
  const header = tab && headerFor(tab);
  if (!header) {
    return;
  }
  const browser = tab.linkedBrowser;
  let canGoBack = false;
  let canGoForward = false;
  try {
    canGoBack = browser.canGoBack;
    canGoForward = browser.canGoForward;
  } catch (e) {
    // The browser has no session history yet.
  }
  header
    .querySelector(".split-pane-back")
    .toggleAttribute("disabled", !canGoBack);
  header
    .querySelector(".split-pane-forward")
    .toggleAttribute("disabled", !canGoForward);
  const input = header.querySelector(".split-pane-url");
  if (document.activeElement !== input) {
    input.value = displayURL(tab, false);
  }
}

/**
 * Address of `tab` taken from browser state, never from page content, with
 * any credentials removed. Unfocused fields show only the site, such as
 * "example.com"; a focused field shows the full address for editing.
 */
function displayURL(tab, full) {
  const uri = tab.linkedBrowser.currentURI;
  if (!uri || isBlankPageURL(uri.spec)) {
    return "";
  }
  try {
    const exposable = Services.io.createExposableURI(uri);
    return full
      ? exposable.displaySpec
      : BrowserUtils.formatURIForDisplay(exposable, { onlyBaseDomain: true });
  } catch (e) {
    return uri.spec;
  }
}

function onCommand(event) {
  const header = event.target.closest?.(".split-pane-header");
  if (!header) {
    return;
  }
  const tab = header._tab;
  const classes = event.target.classList;
  if (classes.contains("split-pane-back")) {
    tab.linkedBrowser.goBack();
  } else if (classes.contains("split-pane-forward")) {
    tab.linkedBrowser.goForward();
  } else if (classes.contains("split-pane-reload")) {
    gBrowser.reloadTab(tab);
  } else if (classes.contains("split-pane-close")) {
    gBrowser.removeTab(tab);
  } else if (classes.contains("split-pane-menu")) {
    gBrowser.selectedTab = tab;
    gBrowser.openSplitViewMenu(event.target);
  }
}

function onHeaderMouseDown(event) {
  const header = event.target.closest?.(".split-pane-header");
  if (!header) {
    return;
  }
  if (grab?.header === header) {
    // A pane bar press keeps focus and text selection where they are; the
    // address field takes focus on release if the press did not drag.
    event.preventDefault();
    return;
  }
  if (header._tab.selected) {
    return;
  }
  gBrowser.selectedTab = header._tab;
  if (event.target.classList.contains("split-pane-url")) {
    // Tab switching moves focus; give it back to the address field after.
    const input = event.target;
    gBrowser.addEventListener("TabSwitchDone", () => input.focus(), {
      once: true,
    });
  }
}

function onUrlKeyDown(event) {
  const input = event.target;
  const tab = input.closest(".split-pane-header")._tab;
  if (event.key == "Enter") {
    event.preventDefault();
    navigate(tab, input.value);
  } else if (event.key == "Escape") {
    event.preventDefault();
    input.value = displayURL(tab, true);
    tab.linkedBrowser.focus();
  }
}

async function navigate(tab, text) {
  text = text.trim();
  if (!text) {
    return;
  }
  const browser = tab.linkedBrowser;
  const { url, postData, mayInheritPrincipal } =
    await UrlbarUtils.getShortcutOrURIAndPostData(text);
  // The pane may have closed or changed while the lookup ran.
  if (!tab.isConnected || tab.closing || tab.linkedBrowser !== browser) {
    return;
  }
  if (/^\s*javascript:/i.test(url)) {
    return;
  }
  openTrustedLinkIn(url, "current", {
    targetBrowser: browser,
    postData,
    allowInheritPrincipal: mayInheritPrincipal,
    allowThirdPartyFixup: true,
  });
  browser.focus();
}

/**
 * Starts a pane bar press. Every part of the bar except a focused address
 * field is a drag handle. A press that does not move acts as a click on the
 * button or address field under it.
 */
function onHeaderPointerDown(event) {
  const header = event.target.closest?.(".split-pane-header");
  if (!header || event.button != 0 || !current) {
    return;
  }
  const input = event.target.classList.contains("split-pane-url")
    ? event.target
    : null;
  if (input && document.activeElement === input) {
    return;
  }
  // Capture at once, so a fast drag keeps reporting while over a page.
  header.setPointerCapture(event.pointerId);
  const g = {
    button: event.target.closest("toolbarbutton"),
    header,
    tab: header._tab,
    input,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    drop: null,
    indicator: null,
    switching: false,
    focusOnSwitch: false,
  };
  grab = g;
  if (!g.tab.selected) {
    g.switching = true;
    gBrowser.addEventListener(
      "TabSwitchDone",
      () => {
        g.switching = false;
        if (g.focusOnSwitch) {
          g.input.focus();
        }
      },
      { once: true }
    );
    gBrowser.selectedTab = g.tab;
  }
}

function onHeaderPointerMove(event) {
  if (!grab || !current || !splitterBox) {
    return;
  }
  if (!(event.buttons & 1)) {
    // The button was released where this window could not see it.
    onHeaderPointerUp({ type: "pointercancel", pointerId: event.pointerId });
    return;
  }
  if (!grab.moved) {
    const distance = Math.hypot(event.clientX - grab.x, event.clientY - grab.y);
    if (distance < DRAG_THRESHOLD) {
      return;
    }
    grab.moved = true;
    grab.header.setAttribute("dragging", "");
    grab.indicator = document.createElementNS(HTML_NS, "div");
    grab.indicator.className = "split-pane-drop";
    grab.indicator.hidden = true;
    splitterBox.append(grab.indicator);
  }
  grab.drop = dropTarget(event.clientX, event.clientY);
  showDropIndicator(grab.indicator, grab.drop);
}

function onHeaderPointerUp(event) {
  const g = grab;
  if (!g) {
    return;
  }
  grab = null;
  if (g.header.hasPointerCapture?.(event.pointerId)) {
    g.header.releasePointerCapture(event.pointerId);
  }
  g.header.removeAttribute("dragging");
  g.indicator?.remove();
  if (!g.moved) {
    // Capture sends the click to the bar, so press the button here.
    if (g.button && !g.button.disabled && event.type == "pointerup") {
      const r = g.button.getBoundingClientRect();
      if (
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      ) {
        g.button.doCommand();
      }
      return;
    }
    if (g.input && event.type == "pointerup") {
      if (g.switching) {
        g.focusOnSwitch = true;
      } else {
        g.input.focus();
      }
    }
    return;
  }
  if (event.type == "pointerup" && g.drop && current) {
    current.movePane(g.tab, g.drop.tab, g.drop.zone);
  }
}

/**
 * Pane under the point, other than the dragged one, and where the dragged
 * pane would land: an edge ("left", "right", "up", "down") or "swap".
 */
function dropTarget(x, y) {
  for (const tab of current.tabs) {
    if (tab === grab.tab) {
      continue;
    }
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel?.classList.contains("split-pane")) {
      continue;
    }
    const rect = panel.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      continue;
    }
    const dx = (x - rect.left) / rect.width - 0.5;
    const dy = (y - rect.top) / rect.height - 0.5;
    let zone;
    if (Math.abs(dx) < SWAP_ZONE && Math.abs(dy) < SWAP_ZONE) {
      zone = "swap";
    } else if (Math.abs(dx) > Math.abs(dy)) {
      zone = dx < 0 ? "left" : "right";
    } else {
      zone = dy < 0 ? "up" : "down";
    }
    if (!current.canMovePane(grab.tab, tab, zone)) {
      return null;
    }
    return { tab, zone, rect };
  }
  return null;
}

function showDropIndicator(indicator, drop) {
  indicator.hidden = !drop;
  if (!drop) {
    return;
  }
  const box = gBrowser.tabbox.getBoundingClientRect();
  const { zone, rect } = drop;
  const half = { w: rect.width / 2, h: rect.height / 2 };
  const x = rect.left - box.left + (zone == "right" ? half.w : 0);
  const y = rect.top - box.top + (zone == "down" ? half.h : 0);
  const w = zone == "left" || zone == "right" ? half.w : rect.width;
  const h = zone == "up" || zone == "down" ? half.h : rect.height;
  Object.assign(indicator.style, {
    left: x + "px",
    top: y + "px",
    width: w + "px",
    height: h + "px",
  });
}

function layoutSplitters(layout, splitters) {
  const panels = gBrowser.tabpanels.getBoundingClientRect();
  const box = gBrowser.tabbox.getBoundingClientRect();
  const dx = panels.left - box.left;
  const dy = panels.top - box.top;
  const existing = splitterBox.querySelectorAll(".split-pane-splitter");
  for (const el of [...existing].slice(splitters.length)) {
    el.remove();
  }
  for (const [i, splitter] of splitters.entries()) {
    let el = existing[i];
    if (!el) {
      el = document.createElementNS(HTML_NS, "div");
      el.className = "split-pane-splitter";
      el.tabIndex = 0;
      el.setAttribute("role", "separator");
      el.setAttribute("data-l10n-id", "tab-splitview-splitter");
      splitterBox.append(el);
    }
    el._splitter = splitter;
    el.dataset.axis = splitter.axis;
    el.setAttribute(
      "aria-orientation",
      splitter.axis == "row" ? "vertical" : "horizontal"
    );
    el.setAttribute(
      "aria-valuenow",
      Math.round(M.nodeAt(layout, splitter.path).ratio * 100)
    );
    el.style.left = dx + splitter.x + "px";
    el.style.top = dy + splitter.y + "px";
    el.style.width = splitter.width + "px";
    el.style.height = splitter.height + "px";
  }
}

/** Ratio for a splitter placed at `position` (px inside tabpanels). */
function clampedRatio(splitter, position) {
  const { rect, axis, path, usable, offset } = splitter;
  const start = axis == "row" ? rect.x : rect.y;
  const ratio = (position - start - offset - GAP / 2) / Math.max(1, usable);
  return clampRatio(path, ratio);
}

function clampRatio(path, ratio) {
  const bounds = M.ratioBounds(
    current.layout,
    path,
    contentRect(),
    MIN_PANE_WIDTH + GAP,
    MIN_PANE_HEIGHT + GAP
  );
  return Math.min(bounds.max, Math.max(bounds.min, ratio));
}

function onSplitterPointerDown(event) {
  const el = event.target;
  if (!el.classList.contains("split-pane-splitter") || event.button != 0) {
    return;
  }
  event.preventDefault();
  el.setPointerCapture(event.pointerId);
  drag = { el, ratio: null, x: event.clientX, y: event.clientY };
}

function onSplitterPointerMove(event) {
  if (!drag || event.target !== drag.el || !current) {
    return;
  }
  // A click with a little pointer jitter is not a resize, so it must not
  // mark the split as resized by hand.
  if (
    drag.ratio === null &&
    Math.abs(event.clientX - drag.x) < DRAG_SLOP &&
    Math.abs(event.clientY - drag.y) < DRAG_SLOP
  ) {
    return;
  }
  const splitter = drag.el._splitter;
  const panels = gBrowser.tabpanels.getBoundingClientRect();
  const position =
    splitter.axis == "row"
      ? event.clientX - panels.left
      : event.clientY - panels.top;
  drag.ratio = clampedRatio(splitter, position);
  current.setLayoutRatio(splitter.path, drag.ratio, false);
}

function onSplitterPointerUp(event) {
  if (!drag || event.target !== drag.el) {
    return;
  }
  const { el, ratio } = drag;
  drag = null;
  el.releasePointerCapture?.(event.pointerId);
  if (ratio !== null && current) {
    current.setLayoutRatio(el._splitter.path, ratio, true);
  }
}

function onSplitterKeyDown(event) {
  const splitter = event.target._splitter;
  const keys =
    splitter.axis == "row"
      ? { ArrowLeft: -1, ArrowRight: 1 }
      : { ArrowUp: -1, ArrowDown: 1 };
  const step = keys[event.key];
  if (!step || !current) {
    return;
  }
  event.preventDefault();
  const ratio = M.nodeAt(current.layout, splitter.path).ratio;
  current.setLayoutRatio(
    splitter.path,
    clampRatio(splitter.path, ratio + step * KEY_STEP),
    true
  );
}
