/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, isBlankPageURL, openTrustedLinkIn, UrlbarUtils, BrowserUIUtils */

/**
 * Renders the active split view as a recursive layout of panes.
 *
 * Loaded into a browser window on its first split view. Browser panels stay
 * direct children of tabpanels; this module only positions them, adds a small
 * header (Back, Forward, address) to each visible pane, and draws one splitter
 * per split. Everything it adds is removed when the split view is hidden, so
 * a window without a visible split view keeps no listeners, observers, or DOM.
 */

const M = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
);

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/tabbrowser/splitview-panes.css";

export const MIN_PANE_WIDTH = 140;
export const MIN_PANE_HEIGHT = 120;

// Space around and between panes, in CSS pixels.
const GAP = 6;
// Ratio change for one splitter arrow key press.
const KEY_STEP = 0.02;

/** The split view wrapper currently rendered in this window, if any. */
let current = null;
let splitterBox = null;
let resizeObserver = null;
let pendingFrame = 0;
let sheetLoaded = false;
let drag = null;

const progressListener = {
  onLocationChange(browser, webProgress) {
    if (webProgress?.isTopLevel) {
      updateHeader(gBrowser.getTabForBrowser(browser));
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
        onSplitterPointerDown(event);
        break;
      case "pointermove":
        onSplitterPointerMove(event);
        break;
      case "pointerup":
      case "pointercancel":
        onSplitterPointerUp(event);
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
  const { leaves, splitters } = M.computeLayout(layout, contentRect(), GAP);
  for (const { id: tab, x, y, width, height } of leaves) {
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel) {
      continue;
    }
    if (!panel.classList.contains("split-pane")) {
      panel.classList.add("split-pane");
      panel.prepend(createHeader(tab));
      updateHeader(tab);
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
    const panel = document.getElementById(tab.linkedPanel);
    if (!panel?.classList.contains("split-pane")) {
      continue;
    }
    panel.classList.remove("split-pane");
    panel.querySelector(":scope > .split-pane-header")?.remove();
    for (const property of ["left", "top", "width", "height"]) {
      panel.style.removeProperty(property);
    }
  }
}

/**
 * Focuses the address field of the pane showing `tab`.
 *
 * @returns {boolean} Whether a pane address field took focus.
 */
export function focusLocation(tab) {
  const input = headerFor(tab)?.querySelector(".split-pane-url");
  if (!input) {
    return false;
  }
  input.focus();
  input.select();
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
  for (const type of [
    "command",
    "mousedown",
    "keydown",
    "focusin",
    "focusout",
  ]) {
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

  resizeObserver = new ResizeObserver(scheduleRender);
  resizeObserver.observe(tabpanels);
}

function teardown() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
  splitterBox?.remove();
  splitterBox = null;
  drag = null;
  gBrowser.removeTabsProgressListener(progressListener);
  const tabpanels = gBrowser.tabpanels;
  for (const type of [
    "command",
    "mousedown",
    "keydown",
    "focusin",
    "focusout",
  ]) {
    tabpanels.removeEventListener(type, handler);
  }
  tabpanels.removeAttribute("splitlayout");
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

function headerFor(tab) {
  return document
    .getElementById(tab.linkedPanel)
    ?.querySelector(":scope > .split-pane-header");
}

function createButton(className, image, label) {
  const button = document.createXULElement("toolbarbutton");
  button.className = className;
  button.setAttribute("image", image);
  button.setAttribute("tooltiptext", label);
  button.setAttribute("aria-label", label);
  return button;
}

function createHeader(tab) {
  const header = document.createXULElement("hbox");
  header.className = "split-pane-header";
  header.setAttribute("role", "toolbar");
  header._tab = tab;

  const input = document.createElementNS(HTML_NS, "input");
  input.className = "split-pane-url";
  input.setAttribute("spellcheck", "false");
  input.setAttribute("aria-label", "Address");
  input.setAttribute("data-l10n-id", "urlbar-placeholder");

  header.append(
    createButton("split-pane-back", "chrome://browser/skin/back.svg", "Back"),
    createButton(
      "split-pane-forward",
      "chrome://browser/skin/forward.svg",
      "Forward"
    ),
    input,
    createButton(
      "split-pane-menu",
      "chrome://global/skin/icons/more.svg",
      "Split view options"
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
 * any credentials removed.
 */
function displayURL(tab, full) {
  const uri = tab.linkedBrowser.currentURI;
  if (!uri || isBlankPageURL(uri.spec)) {
    return "";
  }
  let spec;
  try {
    spec = Services.io.createExposableURI(uri).displaySpec;
  } catch (e) {
    spec = uri.spec;
  }
  return full ? spec : BrowserUIUtils.trimURL(spec);
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
  } else if (classes.contains("split-pane-menu")) {
    gBrowser.selectedTab = tab;
    gBrowser.openSplitViewMenu(event.target);
  }
}

function onHeaderMouseDown(event) {
  const header = event.target.closest?.(".split-pane-header");
  if (!header || header._tab.selected) {
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

function layoutSplitters(layout, splitters) {
  const panels = gBrowser.tabpanels.getBoundingClientRect();
  const box = gBrowser.tabbox.getBoundingClientRect();
  const dx = panels.left - box.left;
  const dy = panels.top - box.top;
  while (splitterBox.children.length > splitters.length) {
    splitterBox.lastElementChild.remove();
  }
  for (const [i, splitter] of splitters.entries()) {
    let el = splitterBox.children[i];
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
  const { rect, axis, path } = splitter;
  const start = axis == "row" ? rect.x : rect.y;
  const extent = (axis == "row" ? rect.width : rect.height) - GAP;
  const ratio = (position - start - GAP / 2) / Math.max(1, extent);
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
  drag = { el, ratio: null };
}

function onSplitterPointerMove(event) {
  if (!drag || event.target !== drag.el || !current) {
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
