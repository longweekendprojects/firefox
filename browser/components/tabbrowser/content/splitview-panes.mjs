/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, gURLBar, gUnifiedExtensions, isBlankPageURL, BrowserUtils,
   CustomizableUI, PanelUI, updateBookmarkToolbarVisibility */

/**
 * Renders the active split view as a recursive layout of panes.
 *
 * Loaded into a browser window on its first split view. Browser panels stay
 * direct children of tabpanels; this module only positions them, adds a small
 * header (Back, Forward, Reload, address, extension buttons, menu, Close) to
 * each visible pane, and draws one splitter per split. While panes are shown, the window's own
 * navigation controls are hidden, because each pane has its own. Panes along
 * the top edge show their header in the toolbar row, in the space those
 * controls leave, so the window keeps a single row of controls. Everything it
 * adds is removed when the split view is hidden, so a window without a
 * visible split view keeps no listeners, observers, or DOM.
 */

const M = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/splitview/SplitLayoutModel.sys.mjs"
);

const CommandBar = ChromeUtils.importESModule(
  "chrome://browser/content/tabbrowser/command-bar.mjs",
  { global: "current" }
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
// It is small because most drops mean to split, and the indicator says when
// a drop will swap.
const SWAP_ZONE = 0.1;
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
const EXTENSIONS_BUTTON = "unified-extensions-button";
// Marks a toolbar extension widget whose popups open from a pane bar.
const ANCHOR_MARK = "split-pane-anchor";

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
/**
 * Watches the window's extensions and menu buttons, which each pane bar
 * mirrors, and the end of sidebar animations, which move the panes without
 * resizing them.
 */
let chromeObserver = null;
/** Pane bars shown in the toolbar row, with their pane's span, from the last render. */
let toolbarLeaves = [];
let followFrame = 0;

/**
 * Called by browser action code when an action changes, and by the
 * extensions panel to find the button it opens from.
 */
const actionsHook = {
  update(widgetId, tab) {
    for (const [paneTab, header] of headers) {
      if (!tab || paneTab === tab) {
        updateActions(header, widgetId);
      }
    }
  },
  extensionsAnchor() {
    return selectedPaneButton(".split-pane-extensions");
  },
  menuAnchor() {
    return selectedPaneButton(".split-pane-app-menu");
  },
};

const customizeListener = {
  onWidgetAdded: scheduleRender,
  onWidgetRemoved: scheduleRender,
  onWidgetMoved: scheduleRender,
  onWidgetAfterCreation: scheduleRender,
  onWidgetDestroyed: scheduleRender,
};

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
      case "TabSelect":
        markSelected();
        anchorActions();
        break;
      case "mousedown":
        onHeaderMouseDown(event);
        break;
      case "contextmenu": {
        // A pane bar has the split view menu, which can separate the pane.
        const header = event.target.closest?.(".split-pane-header");
        if (event.target.classList?.contains("split-pane-action")) {
          event.preventDefault();
          event.stopPropagation();
          document
            .getElementById("unified-extensions-context-menu")
            .openPopupAtScreen(event.screenX, event.screenY, true, event);
        } else if (header) {
          event.preventDefault();
          event.stopPropagation();
          gBrowser.openSplitViewMenu(null, { paneTab: header._tab, event });
        } else if (event.currentTarget === toolbarBox) {
          event.stopPropagation();
          event.preventDefault();
        }
        break;
      }
      case "keydown":
        if (event.target.classList?.contains("split-pane-splitter")) {
          onSplitterKeyDown(event);
        }
        break;
      case "focusin":
        // The pane address field opens the command bar instead of editing.
        if (event.target.classList?.contains("split-pane-url")) {
          focusLocation(event.target.closest(".split-pane-header")._tab);
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
  placeNewPanels(layout);
  const area = contentRect();
  const { leaves, splitters } = M.computeLayout(layout, area, GAP);
  const slot = toolbarSlot();
  const panels = slot && gBrowser.tabpanels.getBoundingClientRect();
  const actionIds = toolbarActionIds();
  toolbarLeaves = [];
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
    fillActions(header, actionIds);
    // A top-edge pane shows its header in the toolbar row, over its own
    // columns and clear of the toolbar's remaining buttons.
    let start = 0;
    let end = 0;
    if (slot && y <= area.y + 0.5) {
      [start, end] = toolbarSpan(slot, panels.left, x, width);
    }
    if (end - start >= MIN_TOOLBAR_HEADER) {
      toolbarLeaves.push({ header, x, width });
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
  markSelected();
  anchorActions();
  if (CommandBar.isOpen() || gURLBar.focused) {
    CommandBar.show();
  }
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
 * Selects the pane showing `tab` and opens the address bar over it as a
 * command bar.
 *
 * @param {MozTabbrowserTab} tab
 * @returns {boolean} Whether the command bar opened.
 */
export function focusLocation(tab) {
  if (!current || tab?.splitview !== current) {
    return false;
  }
  gBrowser.selectedTab = tab;
  gURLBar.select();
  gURLBar.view.autoOpen({ event: new CustomEvent("command") });
  CommandBar.show();
  return gURLBar.focused;
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

  // The address bar is hidden while panes show, so whenever it takes focus
  // it shows as a command bar over the selected pane.
  gURLBar.inputField.addEventListener("focus", CommandBar.show);

  // Each pane bar shows the toolbar's extension buttons for its own tab.
  window.SplitPaneActions = actionsHook;
  CustomizableUI.addListener(customizeListener);
  gBrowser.tabContainer.addEventListener("TabSelect", handler);
  chromeObserver = new MutationObserver(() => {
    scheduleRender();
    if (
      !followFrame &&
      gBrowser.tabbox.hasAttribute("sidebar-ongoing-animations")
    ) {
      followFrame = window.requestAnimationFrame(() =>
        followSidebarAnimation(toolbarSlot())
      );
    }
  });
  chromeObserver.observe(gBrowser.tabbox, {
    attributeFilter: ["sidebar-ongoing-animations"],
  });
  const extensionsButton = document.getElementById(EXTENSIONS_BUTTON);
  if (extensionsButton) {
    chromeObserver.observe(extensionsButton, {
      attributeFilter: ["hidden", "attention"],
    });
  }
  const menuButton = document.getElementById("PanelUI-menu-button");
  if (menuButton) {
    chromeObserver.observe(menuButton, {
      attributeFilter: ["badge-status"],
    });
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
  if (followFrame) {
    window.cancelAnimationFrame(followFrame);
    followFrame = 0;
  }
  toolbarLeaves = [];
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
  gURLBar.inputField.removeEventListener("focus", CommandBar.show);
  delete window.SplitPaneActions;
  CustomizableUI.removeListener(customizeListener);
  gBrowser.tabContainer.removeEventListener("TabSelect", handler);
  chromeObserver?.disconnect();
  chromeObserver = null;
  for (const node of document.querySelectorAll(`[${ANCHOR_MARK}]`)) {
    if (node.getAttribute("cui-anchorid") == node.getAttribute(ANCHOR_MARK)) {
      node.removeAttribute("cui-anchorid");
    }
    node.removeAttribute(ANCHOR_MARK);
  }
  CommandBar.hide();
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

/**
 * Span of a pane bar in the toolbar row, relative to the bar container, for a
 * pane at `x` with `width` inside panels whose left edge is at `panelsLeft`.
 */
function toolbarSpan(slot, panelsLeft, x, width) {
  return [
    Math.max(panelsLeft + x, slot.left) - slot.origin,
    Math.min(panelsLeft + x + width, slot.right) - slot.origin,
  ];
}

/**
 * Moves the toolbar row's pane bars with the panes on every frame of a
 * sidebar slide. The slide moves the panels without resizing them, so only
 * their left edge changes.
 *
 * @param {object} slot The toolbar slot, which the slide does not move.
 */
function followSidebarAnimation(slot) {
  followFrame = 0;
  if (
    !current ||
    !slot ||
    !gBrowser.tabbox.hasAttribute("sidebar-ongoing-animations")
  ) {
    return;
  }
  const panelsLeft = gBrowser.tabpanels.getBoundingClientRect().left;
  for (const { header, x, width } of toolbarLeaves) {
    if (header.parentNode !== toolbarBox) {
      continue;
    }
    const [start, end] = toolbarSpan(slot, panelsLeft, x, width);
    header.style.left = start + "px";
    header.style.width = Math.max(0, end - start) + "px";
  }
  followFrame = window.requestAnimationFrame(() =>
    followSidebarAnimation(slot)
  );
}

/** Area inside tabpanels available to panes. */
/**
 * Gives panels that just joined the split their pane geometry without
 * flushing layout. Otherwise the measuring flush in `render` lays them out
 * side by side first, and their pages briefly draw at that size.
 *
 * @param {object} layout
 */
function placeNewPanels(layout) {
  const unplaced = M.leafIds(layout)
    .map(tab => document.getElementById(tab.linkedPanel))
    .filter(panel => panel && !panel.classList.contains("split-pane"));
  if (!unplaced.length) {
    return;
  }
  const bounds = window.windowUtils.getBoundsWithoutFlushing(
    gBrowser.tabpanels
  );
  const area = {
    x: GAP,
    y: GAP,
    width: Math.max(0, bounds.width - 2 * GAP),
    height: Math.max(0, bounds.height - 2 * GAP),
  };
  for (const { id: tab, x, y, width, height } of M.computeLayout(
    layout,
    area,
    GAP
  ).leaves) {
    const panel = document.getElementById(tab.linkedPanel);
    if (!unplaced.includes(panel)) {
      continue;
    }
    panel.classList.add("split-pane");
    Object.assign(panel.style, {
      left: x + "px",
      top: y + "px",
      width: width + "px",
      height: height + "px",
    });
  }
}

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

function markSelected() {
  for (const [tab, header] of headers) {
    header.toggleAttribute("selected", tab.selected);
  }
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
  header.toggleAttribute("selected", tab.selected);
  header._tab = tab;

  const input = document.createElementNS(HTML_NS, "input");
  input.className = "split-pane-url";
  input.readOnly = true;
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
    createActionsBox(),
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
  header.querySelector(".split-pane-url").value = displayURL(tab);
  updateActions(header);
}

/** Widget ids of the extension buttons in the toolbar, in toolbar order. */
function toolbarActionIds() {
  return CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR).filter(
    id =>
      document.getElementById(id)?.classList.contains("unified-extensions-item")
  );
}

function selectedPaneButton(selector) {
  const button = headers.get(gBrowser.selectedTab)?.querySelector(selector);
  return button?.checkVisibility() ? button : null;
}

function createActionsBox() {
  const box = document.createXULElement("hbox");
  box.className = "split-pane-actions";
  const extensions = createButton(
    "split-pane-extensions",
    "chrome://mozapps/skin/extensions/extension.svg",
    "tab-splitview-pane-extensions"
  );
  const menu = createButton(
    "split-pane-app-menu",
    "chrome://browser/skin/menu.svg",
    "tab-splitview-pane-app-menu"
  );
  box.append(extensions, menu);
  return box;
}

/**
 * Gives `header` one button per toolbar extension button, in toolbar order,
 * before its extensions button.
 *
 * @param {Element} header
 * @param {string[]} ids Widget ids from `toolbarActionIds`.
 */
function fillActions(header, ids) {
  const box = header.querySelector(".split-pane-actions");
  const extensions = box.querySelector(".split-pane-extensions");
  const real = document.getElementById(EXTENSIONS_BUTTON);
  extensions.hidden = !real || real.hidden;
  extensions.toggleAttribute("attention", !!real?.hasAttribute("attention"));
  // A pending update or account notice shows as a dot on the menu button.
  box
    .querySelector(".split-pane-app-menu")
    .toggleAttribute(
      "attention",
      !!document
        .getElementById("PanelUI-menu-button")
        ?.hasAttribute("badge-status")
    );
  const key = ids.join(" ");
  if (box._ids === key) {
    return;
  }
  box._ids = key;
  for (const button of box.querySelectorAll(".split-pane-action")) {
    button.remove();
  }
  for (const id of ids) {
    const button = document.createXULElement("toolbarbutton");
    button.className = "split-pane-action tabbable";
    button.id = `${header.getAttribute("panel")}-${id}`;
    button.dataset.widgetId = id;
    button.setAttribute("badged", "true");
    button.setAttribute("constrain-size", "true");
    extensions.before(button);
  }
  updateActions(header);
}

/**
 * Draws the state of the extension buttons of `header` for its tab.
 *
 * @param {Element} header
 * @param {string} [widgetId] Only this extension's button.
 */
function updateActions(header, widgetId) {
  for (const button of header.querySelectorAll(".split-pane-action")) {
    if (!widgetId || button.dataset.widgetId == widgetId) {
      browserActionFor(button.dataset.widgetId)?.updatePaneButton(
        button,
        header._tab
      );
    }
  }
}

function browserActionFor(widgetId) {
  const id = document
    .getElementById(widgetId)
    ?.getAttribute("data-extensionid");
  const policy = id && WebExtensionPolicy.getByID(id);
  return policy ? gUnifiedExtensions.browserActionFor(policy) : null;
}

/**
 * Opens extension popups from the selected pane's bar, since the toolbar's
 * own extension buttons are hidden while panes show. This also covers popups
 * an extension or its keyboard shortcut opens.
 */
function anchorActions() {
  const header = headers.get(gBrowser.selectedTab);
  for (const id of toolbarActionIds()) {
    const node = document.getElementById(id);
    if (node.getAttribute("overflowedItem") == "true") {
      continue;
    }
    const button = header?.querySelector(
      `.split-pane-action[data-widget-id="${CSS.escape(id)}"]`
    );
    const anchorId = button?.checkVisibility() ? button.id : null;
    if (anchorId) {
      node.setAttribute("cui-anchorid", anchorId);
      node.setAttribute(ANCHOR_MARK, anchorId);
    } else if (node.hasAttribute(ANCHOR_MARK)) {
      if (node.getAttribute("cui-anchorid") == node.getAttribute(ANCHOR_MARK)) {
        node.removeAttribute("cui-anchorid");
      }
      node.removeAttribute(ANCHOR_MARK);
    }
  }
}

/** Runs the extension button `button` stands for, for its pane. */
function runAction(button, tab) {
  const real = document
    .getElementById(button.dataset.widgetId)
    ?.querySelector(".unified-extensions-item-action-button");
  if (!real) {
    return;
  }
  // Selecting the pane anchors the extension's popup to `button`.
  gBrowser.selectedTab = tab;
  anchorActions();
  real.dispatchEvent(
    new CustomEvent("command", { bubbles: true, cancelable: true })
  );
}

/**
 * Site of `tab`, such as "example.com", taken from browser state, never
 * from page content.
 */
function displayURL(tab) {
  const uri = tab.linkedBrowser.currentURI;
  if (!uri || isBlankPageURL(uri.spec)) {
    return "";
  }
  try {
    const exposable = Services.io.createExposableURI(uri);
    return BrowserUtils.formatURIForDisplay(exposable, {
      onlyBaseDomain: true,
    });
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
    gBrowser.openSplitViewMenu(event.target, { paneTab: tab });
  } else if (classes.contains("split-pane-action")) {
    runAction(event.target, tab);
  } else if (classes.contains("split-pane-extensions")) {
    gBrowser.selectedTab = tab;
    gUnifiedExtensions.togglePanel(event, undefined, event.target);
  } else if (classes.contains("split-pane-app-menu")) {
    // The main menu acts on the selected tab, and opens from its pane's bar.
    gBrowser.selectedTab = tab;
    PanelUI.toggle(event);
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
    const swap = document.createElementNS(HTML_NS, "div");
    swap.className = "split-pane-drop-swap";
    const label = document.createElementNS(HTML_NS, "span");
    document.l10n.setAttributes(label, "tab-splitview-pane-drop-swap");
    swap.append(label);
    grab.indicator.append(swap);
    splitterBox.append(grab.indicator);
  }
  grab.drop = dropTarget(event.clientX, event.clientY);
  showDropIndicator(grab.indicator, grab.drop);
  grab.stripDrop = grab.drop ? null : stripTarget(event.clientX, event.clientY);
  showStripIndicator(grab, grab.stripDrop);
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
  g.stripIndicator?.remove();
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
  } else if (event.type == "pointerup" && g.stripDrop) {
    dropOnStrip(g.tab, g.stripDrop);
  }
}

/**
 * Where a pane dragged over the tab strip would go: "split" with the tab or
 * split view under the pointer, or "insert" as its own tab before `before`.
 */
function stripTarget(x, y) {
  const strip = gBrowser.tabContainer;
  const box = strip.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
    return null;
  }
  const own = grab.tab.splitview;
  let el = document
    .elementFromPoint(x, y)
    ?.closest?.("tab-split-view-wrapper, .tabbrowser-tab");
  if (el?.splitview) {
    el = el.splitview;
  }
  const vertical = strip.verticalMode;
  if (!el || el.pinned) {
    // Over empty space or pinned tabs: a tab of its own after the last tab.
    const last = gBrowser.visibleTabs.findLast(t => !t.pinned);
    const lastElement = last?.splitview ?? last;
    if (!lastElement || lastElement === own) {
      return own
        ? { mode: "insert", before: own.nextElementSibling, own }
        : null;
    }
    return {
      mode: "insert",
      before: lastElement.nextElementSibling,
      rect: lastElement.getBoundingClientRect(),
      edge: "end",
      own,
    };
  }
  const rect = el.getBoundingClientRect();
  const f = vertical
    ? (y - rect.top) / rect.height
    : (x - rect.left) / rect.width;
  if (el !== own && f > 0.2 && f < 0.8) {
    const canSplit =
      el.localName == "tab-split-view-wrapper"
        ? el.canSplitPane(el.edgePane("right"), "right")
        : !el.closing;
    if (canSplit) {
      return { mode: "split", target: el, rect, own };
    }
  }
  const after = f >= 0.5;
  return {
    mode: "insert",
    before: after ? el.nextElementSibling : el,
    rect,
    edge: after ? "end" : "start",
    own,
  };
}

function showStripIndicator(g, drop) {
  if (!drop?.rect) {
    if (g.stripIndicator) {
      g.stripIndicator.hidden = true;
    }
    return;
  }
  if (!g.stripIndicator) {
    g.stripIndicator = document.createElementNS(HTML_NS, "div");
    g.stripIndicator.className = "split-pane-strip-drop";
    document.documentElement.append(g.stripIndicator);
  }
  const el = g.stripIndicator;
  el.hidden = false;
  el.setAttribute("mode", drop.mode);
  const { rect } = drop;
  const vertical = gBrowser.tabContainer.verticalMode;
  let style = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  if (drop.mode == "insert") {
    const at = drop.edge == "end";
    style = vertical
      ? {
          left: rect.left,
          top: (at ? rect.bottom : rect.top) - 1,
          width: rect.width,
          height: 2,
        }
      : {
          left: (at ? rect.right : rect.left) - 1,
          top: rect.top,
          width: 2,
          height: rect.height,
        };
  }
  for (const [key, value] of Object.entries(style)) {
    el.style[key] = value + "px";
  }
}

/** Separates `tab` from its split view, then places it as `drop` says. */
function dropOnStrip(tab, drop) {
  const splitview = tab.splitview;
  if (!splitview) {
    return;
  }
  if (drop.mode == "insert") {
    splitview.separatePane(tab, { before: drop.before });
    return;
  }
  splitview.separatePane(tab);
  const target = drop.target;
  if (target.localName == "tab-split-view-wrapper") {
    if (target.isConnected) {
      target.splitPane(target.edgePane("right"), "right", tab);
    }
  } else if (target.isConnected && !target.splitview) {
    gBrowser.addTabSplitView([target, tab], {
      insertBefore: target,
      direction: "right",
    });
  }
  gBrowser.selectedTab = tab;
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
  indicator.setAttribute("zone", zone);
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
