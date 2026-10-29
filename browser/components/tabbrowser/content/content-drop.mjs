/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser */

/**
 * Dropping a tab from the tab strip onto the page splits it with the page or
 * pane under the pointer, as in Arc. Dragging a tab does not select it: the
 * tab that was selected before the drag stays selected.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";
const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

/** @type {?{source: Element, tab: MozTabbrowserTab, target: MozTabbrowserTab, overlay: Element, indicator: Element, drop: ?object, dropped: boolean}} */
let drag = null;

function panes() {
  return ChromeUtils.importESModule(
    "chrome://browser/content/tabbrowser/splitview-panes.mjs",
    { global: "current" }
  );
}

/**
 * Starts watching a drag of `tab` from the tab strip.
 *
 * @param {Element} source The dragged tab, or the split view it is a pane of.
 * @param {MozTabbrowserTab} tab The tab that a drop on the page splits in.
 * @param {?MozTabbrowserTab} target The tab selected before the drag began.
 */
export function start(source, tab, target) {
  removeOverlay();
  if (!target || target === tab || !target.isConnected || target.closing) {
    return;
  }
  const overlay = document.createElementNS(HTML_NS, "div");
  overlay.id = "tab-content-drop";
  const indicator = document.createElementNS(HTML_NS, "div");
  indicator.hidden = true;
  Object.assign(indicator.style, {
    position: "absolute",
    pointerEvents: "none",
    boxSizing: "border-box",
    border: "2px solid var(--focus-outline-color)",
    borderRadius: "var(--border-radius-medium)",
    backgroundColor: "var(--background-color-dimmed)",
  });
  overlay.append(indicator);
  const box = gBrowser.tabbox.getBoundingClientRect();
  const rect = gBrowser.tabpanels.getBoundingClientRect();
  Object.assign(overlay.style, {
    position: "absolute",
    zIndex: "3",
    left: rect.left - box.left + "px",
    top: rect.top - box.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
  });
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    overlay.addEventListener(type, onEvent);
  }
  // A click here means the drag is over without a dragend.
  overlay.addEventListener("pointerdown", end);
  gBrowser.tabbox.append(overlay);
  drag = {
    source,
    tab,
    target,
    overlay,
    indicator,
    drop: null,
    dropped: false,
  };
  // Waits a frame, so a drop that ends the drag right away, such as one in
  // another window, never sees the switch.
  window.requestAnimationFrame(showTarget);
}

/** Shows the tab that was selected before the drag. */
function showTarget() {
  const target = drag?.target;
  if (target?.isConnected && !target.closing && !drag.tab.closing) {
    gBrowser.selectedTab = target;
  }
}

/**
 * Ends the drag.
 *
 * @returns {boolean} Whether the tab was dropped on the page.
 */
export function end() {
  const d = drag;
  removeOverlay();
  return !!d?.dropped;
}

function removeOverlay() {
  drag?.overlay.remove();
  drag = null;
}

function onEvent(event) {
  if (!drag) {
    return;
  }
  const dt = event.dataTransfer;
  if (dt?.mozGetDataAt(TAB_DROP_TYPE, 0) !== drag.source) {
    return;
  }
  switch (event.type) {
    case "dragenter":
    case "dragover":
      if (gBrowser.selectedTab !== drag.target) {
        showTarget();
      }
      drag.drop = dropAt(event.clientX, event.clientY);
      showIndicator();
      if (drag.drop) {
        event.preventDefault();
        dt.dropEffect = "move";
      }
      break;
    case "dragleave":
      if (!drag.overlay.contains(event.relatedTarget)) {
        drag.drop = null;
        showIndicator();
      }
      break;
    case "drop":
      if (drag.drop) {
        event.preventDefault();
        event.stopPropagation();
        drag.dropped = true;
        const { tab, drop } = drag;
        drag.drop = null;
        showIndicator();
        dropTab(tab, drop);
      }
      break;
  }
}

/**
 * The pane under the point and the side of it the dragged tab would take.
 */
function dropAt(x, y) {
  const target = gBrowser.selectedTab;
  const splitview = target.splitview;
  const candidates = splitview
    ? splitview.tabs.map(tab => [
        tab,
        document.getElementById(tab.linkedPanel)?.getBoundingClientRect(),
      ])
    : [[target, gBrowser.tabpanels.getBoundingClientRect()]];
  for (const [tab, rect] of candidates) {
    if (
      tab === drag.tab ||
      !rect?.width ||
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom
    ) {
      continue;
    }
    const dx = (x - rect.left) / rect.width - 0.5;
    const dy = (y - rect.top) / rect.height - 0.5;
    let zone;
    if (Math.abs(dx) > Math.abs(dy)) {
      zone = dx < 0 ? "left" : "right";
    } else {
      zone = dy < 0 ? "up" : "down";
    }
    return canDrop(tab, zone) ? { tab, zone, rect } : null;
  }
  return null;
}

function canDrop(target, zone) {
  const splitview = target.splitview;
  if (splitview) {
    return drag.tab.splitview === splitview
      ? splitview.canMovePane(drag.tab, target, zone)
      : splitview.canSplitPane(target, zone);
  }
  const { width, height } = gBrowser.tabpanels.getBoundingClientRect();
  const { MIN_PANE_WIDTH, MIN_PANE_HEIGHT } = panes();
  return zone == "left" || zone == "right"
    ? width >= 2 * MIN_PANE_WIDTH
    : height >= 2 * MIN_PANE_HEIGHT;
}

function showIndicator() {
  const { indicator, overlay, drop } = drag;
  indicator.hidden = !drop;
  if (!drop) {
    return;
  }
  const box = overlay.getBoundingClientRect();
  const { zone, rect } = drop;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  Object.assign(indicator.style, {
    left: rect.left - box.left + (zone == "right" ? halfW : 0) + "px",
    top: rect.top - box.top + (zone == "down" ? halfH : 0) + "px",
    width: (zone == "left" || zone == "right" ? halfW : rect.width) + "px",
    height: (zone == "up" || zone == "down" ? halfH : rect.height) + "px",
  });
}

/**
 * Splits `drop.tab` so that `tab` takes the `drop.zone` side of its pane.
 */
function dropTab(tab, drop) {
  const { tab: target, zone } = drop;
  const splitview = target.splitview;
  if (splitview && tab.splitview === splitview) {
    splitview.movePane(tab, target, zone);
    gBrowser.selectedTab = tab;
    return;
  }
  tab.splitview?.separatePane(tab);
  gBrowser.splitDropStarting(tab);
  if (splitview) {
    tab = gBrowser.detachPinnedTabForSplit(tab);
    splitview.splitPane(target, zone, tab);
  } else {
    gBrowser.addTabSplitView([target, tab], {
      insertBefore: target,
      trigger: "drag_drop",
      direction: zone,
    });
  }
  gBrowser.selectedTab = tab;
  gBrowser.splitDropDone(tab);
}
