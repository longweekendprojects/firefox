/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, BrowserUtils, isBlankPageURL, gReduceMotion */

/**
 * Peek: a link previewed in a card over the current page, without becoming a
 * tab in the tab strip.
 *
 * The page loads in an ordinary tab that is hidden from the tab strip. Its
 * panel is drawn over the content area, so expanding it to a tab or a split
 * pane keeps the page as it is. Closing the card closes that tab. A window
 * keeps no Peek DOM, listeners or observers while no card is shown.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLESHEET = "chrome://browser/content/tabbrowser/peek.css";
const HIDDEN_BY = "peek";
// Height of the card's own toolbar, in CSS pixels.
const BAR_HEIGHT = 36;
// Space between the card and the content area edges.
const MARGIN_BLOCK = 10;
const MIN_MARGIN_INLINE = 64;
const MARGIN_INLINE_RATIO = 0.09;

let peekTab = null;
let layer = null;
let resizeObserver = null;
let sheetLoaded = false;

const progressListener = {
  onLocationChange(browser, webProgress) {
    if (webProgress?.isTopLevel && browser == peekTab?.linkedBrowser) {
      updateBar();
    }
  },
};

const handler = {
  handleEvent(event) {
    switch (event.type) {
      case "click":
        onClick(event);
        break;
      case "command":
        onCommand(event);
        break;
      case "keydown":
        onKeyDown(event);
        break;
      case "TabSelect":
      case "TabClose":
        if (event.type == "TabClose" && event.target != peekTab) {
          return;
        }
        if (event.type == "TabSelect" && event.target == peekTab) {
          return;
        }
        // The card belongs to the page it was opened over.
        closeCard({ keepTab: event.type == "TabClose" });
        break;
    }
  },
  observe() {
    // A Peek is not part of the saved session.
    closeCard();
  },
};

/** Whether a Peek card is shown in this window. */
export function isOpen() {
  return !!peekTab;
}

/** The hidden tab shown in the Peek card, if any. */
export function getTab() {
  return peekTab;
}

/**
 * Opens `url` in a Peek card over the selected page.
 *
 * @param {string} url
 * @param {object} params
 *   Load parameters, as for openLinkIn.
 */
export function openLink(url, params = {}) {
  closeCard();
  window.openLinkIn(url, "tab", {
    ...params,
    inBackground: true,
    skipTabAnimation: true,
    resolveOnNewTabCreated: browser => {
      let tab = gBrowser.getTabForBrowser(browser);
      if (tab) {
        show(tab);
      }
    },
  });
}

function show(tab) {
  gBrowser.hideTab(tab, HIDDEN_BY);
  if (!tab.hidden) {
    // Tabs that cannot be hidden stay ordinary tabs.
    gBrowser.selectedTab = tab;
    return;
  }
  peekTab = tab;
  tab.setAttribute("peek", "true");
  const browser = tab.linkedBrowser;
  // Draw the page although its tab is not selected, the way print preview
  // draws a background tab.
  gBrowser.activateBrowserForPrintPreview(browser);
  browser.renderLayers = true;

  attach();
  const panel = document.getElementById(tab.linkedPanel);
  panel?.classList.add("peek-panel");
  layout();
  updateBar();
  if (!gReduceMotion) {
    layer.setAttribute("opening", "");
    panel?.setAttribute("opening", "");
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        layer?.removeAttribute("opening");
        panel?.removeAttribute("opening");
      })
    );
  }
  browser.focus();
}

/**
 * Closes the Peek card.
 *
 * @param {object} [options]
 * @param {boolean} [options.keepTab]
 *   Keep the tab, because it is already closing or now shown elsewhere.
 */
export function closeCard({ keepTab = false } = {}) {
  const tab = peekTab;
  if (!tab) {
    return;
  }
  detach(tab);
  if (!keepTab && !tab.closing) {
    gBrowser.removeTab(tab, { animate: false });
  }
}

/** Shows the page of the Peek card as an ordinary selected tab. */
export function expand() {
  const tab = peekTab;
  if (!tab) {
    return;
  }
  detach(tab);
  gBrowser.showTab(tab);
  gBrowser.selectedTab = tab;
}

/** Shows the page of the Peek card in a split pane beside the current one. */
export function split() {
  const tab = peekTab;
  if (!tab) {
    return;
  }
  const current = gBrowser.selectedTab;
  detach(tab);
  gBrowser.showTab(tab);
  if (current.splitview) {
    current.splitview.splitPane(current, "right", tab);
  } else if (!current.pinned) {
    gBrowser.addTabSplitView([current, tab], {
      insertBefore: current,
      direction: "right",
    });
  }
  gBrowser.selectedTab = tab;
}

function detach(tab) {
  peekTab = null;
  tab.removeAttribute("peek");
  gBrowser._printPreviewBrowsers.delete(tab.linkedBrowser);
  const panel = document.getElementById(tab.linkedPanel);
  if (panel) {
    panel.classList.remove("peek-panel");
    panel.removeAttribute("opening");
    for (const property of ["left", "top", "width", "height"]) {
      panel.style.removeProperty(property);
    }
  }
  teardown();
}

function attach() {
  if (!sheetLoaded) {
    window.windowUtils.loadSheetUsingURIString(
      STYLESHEET,
      window.windowUtils.AUTHOR_SHEET
    );
    sheetLoaded = true;
  }
  layer = document.createElementNS(HTML_NS, "div");
  layer.id = "peek-layer";

  const backdrop = document.createElementNS(HTML_NS, "div");
  backdrop.className = "peek-backdrop";

  const frame = document.createElementNS(HTML_NS, "div");
  frame.className = "peek-frame";
  const bar = document.createXULElement("hbox");
  bar.className = "peek-bar";
  bar.setAttribute("role", "toolbar");
  const host = document.createElementNS(HTML_NS, "span");
  host.className = "peek-host";
  bar.append(
    createButton("peek-back", "chrome://browser/skin/back.svg", "peek-back"),
    createButton(
      "peek-forward",
      "chrome://browser/skin/forward.svg",
      "peek-forward"
    ),
    createButton(
      "peek-reload",
      "chrome://global/skin/icons/reload.svg",
      "peek-reload"
    ),
    host
  );
  frame.append(bar);

  const actions = document.createXULElement("vbox");
  actions.className = "peek-actions";
  actions.append(
    createButton(
      "peek-close",
      "chrome://global/skin/icons/close.svg",
      "peek-close"
    ),
    createButton(
      "peek-expand",
      "chrome://browser/skin/fullscreen.svg",
      "peek-expand"
    ),
    createButton(
      "peek-split",
      "chrome://browser/skin/split-view-right-16.svg",
      "peek-split"
    )
  );

  layer.append(backdrop, frame, actions);
  layer.addEventListener("click", handler);
  layer.addEventListener("command", handler);
  gBrowser.tabbox.append(layer);

  window.addEventListener("keydown", handler, { mozSystemGroup: true });
  gBrowser.tabContainer.addEventListener("TabSelect", handler);
  gBrowser.tabContainer.addEventListener("TabClose", handler);
  gBrowser.addTabsProgressListener(progressListener);
  Services.obs.addObserver(handler, "quit-application-requested");
  resizeObserver = new window.ResizeObserver(() => layout());
  resizeObserver.observe(gBrowser.tabpanels);
}

function teardown() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("keydown", handler, { mozSystemGroup: true });
  gBrowser.tabContainer.removeEventListener("TabSelect", handler);
  gBrowser.tabContainer.removeEventListener("TabClose", handler);
  gBrowser.removeTabsProgressListener(progressListener);
  try {
    Services.obs.removeObserver(handler, "quit-application-requested");
  } catch (e) {
    // Not observing.
  }
  layer?.remove();
  layer = null;
}

function createButton(className, image, l10nId) {
  const button = document.createXULElement("toolbarbutton");
  button.className = className;
  button.setAttribute("image", image);
  document.l10n.setAttributes(button, l10nId);
  return button;
}

function layout() {
  if (!peekTab || !layer) {
    return;
  }
  const panels = gBrowser.tabpanels.getBoundingClientRect();
  const box = gBrowser.tabbox.getBoundingClientRect();
  const marginInline = Math.max(
    MIN_MARGIN_INLINE,
    Math.round(panels.width * MARGIN_INLINE_RATIO)
  );
  const width = Math.max(0, panels.width - 2 * marginInline);
  const height = Math.max(0, panels.height - 2 * MARGIN_BLOCK);
  const x = marginInline;
  const y = MARGIN_BLOCK;

  const panel = document.getElementById(peekTab.linkedPanel);
  if (panel) {
    Object.assign(panel.style, {
      left: x + "px",
      top: y + BAR_HEIGHT + "px",
      width: width + "px",
      height: Math.max(0, height - BAR_HEIGHT) + "px",
    });
  }
  const dx = panels.left - box.left;
  const dy = panels.top - box.top;
  Object.assign(layer.querySelector(".peek-backdrop").style, {
    left: dx + "px",
    top: dy + "px",
    width: panels.width + "px",
    height: panels.height + "px",
  });
  Object.assign(layer.querySelector(".peek-frame").style, {
    left: dx + x + "px",
    top: dy + y + "px",
    width: width + "px",
    height: height + "px",
  });
  Object.assign(layer.querySelector(".peek-actions").style, {
    left: dx + x + width + 14 + "px",
    top: dy + y + "px",
  });
}

function updateBar() {
  if (!peekTab || !layer) {
    return;
  }
  const browser = peekTab.linkedBrowser;
  let canGoBack = false;
  let canGoForward = false;
  try {
    canGoBack = browser.canGoBack;
    canGoForward = browser.canGoForward;
  } catch (e) {
    // No session history yet.
  }
  layer.querySelector(".peek-back").toggleAttribute("disabled", !canGoBack);
  layer
    .querySelector(".peek-forward")
    .toggleAttribute("disabled", !canGoForward);
  layer.querySelector(".peek-host").textContent = displayHost(browser);
}

function displayHost(browser) {
  const uri = browser.currentURI;
  if (!uri || isBlankPageURL(uri.spec)) {
    return "";
  }
  try {
    return BrowserUtils.formatURIForDisplay(
      Services.io.createExposableURI(uri),
      { onlyBaseDomain: true }
    );
  } catch (e) {
    return uri.spec;
  }
}

function onClick(event) {
  if (event.button == 0 && event.target.classList?.contains("peek-backdrop")) {
    closeCard();
  }
}

function onCommand(event) {
  const classes = event.target.classList;
  const browser = peekTab?.linkedBrowser;
  if (!browser) {
    return;
  }
  if (classes.contains("peek-back")) {
    browser.goBack();
  } else if (classes.contains("peek-forward")) {
    browser.goForward();
  } else if (classes.contains("peek-reload")) {
    browser.reload();
  } else if (classes.contains("peek-close")) {
    closeCard();
  } else if (classes.contains("peek-expand")) {
    expand();
  } else if (classes.contains("peek-split")) {
    split();
  }
}

function onKeyDown(event) {
  if (
    event.key != "Escape" ||
    event.defaultPrevented ||
    !event.isTrusted ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  // A page that uses Escape itself, such as to close its own dialog, keeps
  // it. Wait for the page to pass on the key first.
  if (event.target?.isRemoteBrowser && !event.isReplyEventFromRemoteContent) {
    if (!event.isWaitingReplyFromRemoteContent) {
      event.requestReplyFromRemoteContent();
    }
    return;
  }
  event.preventDefault();
  closeCard();
}
