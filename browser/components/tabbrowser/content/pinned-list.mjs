/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser */

/**
 * The pinned list: tabs kept as rows between the pinned tiles and the New Tab
 * row, like the pinned tabs of an Arc space. They are regular tabs marked with
 * the pinned-list attribute, so they can be grouped and split, and like
 * pinned tiles they keep the address they were pinned with.
 *
 * The tab strip keeps each space's pinned list items before its other items.
 * A tab group or split view is one item: all of its tabs are in the list or
 * none are.
 */

export const ATTR = "pinned-list";
const NEWTAB_ROW_ID = "tabs-list-newtab-button";

let pendingFrame = 0;
let normalizing = false;
let rowShift = 0;

export function init() {
  let tabs = gBrowser.tabContainer;
  new MutationObserver(schedule).observe(tabs.arrowScrollbox, {
    childList: true,
    subtree: true,
  });
  tabs.addEventListener("TabPinned", onTabPinned);
  tabs.addEventListener("TabShow", schedule);
  tabs.addEventListener("TabHide", schedule);
  tabs.addEventListener("SSTabRestoring", schedule);
  window.addEventListener("SSWindowRestored", schedule);
  window.addEventListener(
    "unload",
    () => {
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
      }
    },
    { once: true }
  );
  schedule();
}

function onTabPinned(event) {
  event.target.removeAttribute(ATTR);
}

function schedule() {
  if (!pendingFrame && !normalizing) {
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = 0;
      normalize();
    });
  }
}

const isTab = el => el?.localName == "tab";
const isSplit = el => el?.localName == "tab-split-view-wrapper";
const isGroup = el => el?.localName == "tab-group";

/**
 * The tab strip item that holds `element`: its tab group, else its split view,
 * else the tab itself.
 */
export function unitOf(element) {
  if (!element) {
    return null;
  }
  if (isGroup(element) || isSplit(element)) {
    return element.group ?? element;
  }
  return element.group ?? element.splitview ?? element;
}

function tabsOf(unit) {
  if (isTab(unit)) {
    return [unit];
  }
  return [...unit.querySelectorAll("tab.tabbrowser-tab")];
}

function units() {
  return [...gBrowser.tabContainer.arrowScrollbox.children].filter(
    el => isTab(el) || isSplit(el) || isGroup(el)
  );
}

export function isListTab(tab) {
  return !!tab && !tab.pinned && tab.hasAttribute(ATTR);
}

export function isListItem(element) {
  let unit = unitOf(element);
  return !!unit && tabsOf(unit).some(isListTab);
}

function urlOf(tab) {
  let spec = tab.linkedBrowser?.currentURI?.spec;
  return spec && spec != "about:blank" ? spec : null;
}

/**
 * Puts the tab strip item holding `element` in or out of the pinned list.
 *
 * @param {Element} element
 * @param {boolean} list
 */
export function setInList(element, list) {
  let unit = unitOf(element);
  if (!unit || unit.pinned) {
    return;
  }
  for (let tab of tabsOf(unit)) {
    if (tab.pinned) {
      continue;
    }
    if (list) {
      if (!tab.hasAttribute(ATTR)) {
        tab.setAttribute(ATTR, "true");
        let url = urlOf(tab);
        if (!tab.hasAttribute("pinned-url") && url) {
          tab.setAttribute("pinned-url", url);
        }
      }
    } else if (tab.hasAttribute(ATTR)) {
      tab.removeAttribute(ATTR);
      tab.removeAttribute("pinned-url");
    }
  }
  unit.toggleAttribute(ATTR, list);
}

function spaceKey(unit) {
  let tab = tabsOf(unit)[0];
  return (tab && window.gSpaces?.spaceOf(tab)) ?? "";
}

/**
 * Makes each tab group and split view wholly in or out of the list, by the
 * majority of its tabs, and moves each space's list items before its other
 * items.
 */
export function normalize() {
  if (normalizing) {
    return;
  }
  normalizing = true;
  try {
    let all = units();
    for (let unit of all) {
      let tabs = tabsOf(unit).filter(t => !t.pinned);
      let inList = tabs.filter(t => t.hasAttribute(ATTR)).length;
      let list = !!tabs.length && inList * 2 >= tabs.length;
      if (
        (inList && inList != tabs.length) ||
        unit.hasAttribute(ATTR) != list
      ) {
        setInList(unit, list);
      }
    }
    let firstOther = new Map();
    for (let unit of all) {
      let key = spaceKey(unit);
      if (!unit.hasAttribute(ATTR)) {
        if (!firstOther.has(key)) {
          firstOther.set(key, unit);
        }
      } else if (firstOther.has(key)) {
        gBrowser.moveTabBefore(unit, firstOther.get(key));
      }
    }
    let row = newTabRow();
    if (row) {
      row.toggleAttribute(
        "after-pinned-list",
        units().some(
          u => u.hasAttribute(ATTR) && tabsOf(u).some(t => t.visible)
        )
      );
    }
  } finally {
    normalizing = false;
  }
}

function newTabRow() {
  let row = document.getElementById(NEWTAB_ROW_ID);
  return row?.getBoundingClientRect().height ? row : null;
}

/**
 * While a regular tab strip item is dragged in the vertical tab strip, tells
 * whether it would land in the pinned list, and moves the New Tab row out of
 * the way of the list growing or shrinking.
 *
 * @param {Element} dragged The dragged tab or tab group label.
 * @param {number} clientY The pointer position.
 * @param {number} shiftSize How far tabs move aside for the dragged item.
 * @returns {boolean|null} null when the strip shows no New Tab row.
 */
export function dragTarget(dragged, clientY, shiftSize) {
  let row = newTabRow();
  if (!row) {
    return null;
  }
  let rect = row.getBoundingClientRect();
  let list = clientY < rect.top + rect.height / 2;
  let fromList = isListItem(dragged);
  let shift = 0;
  if (list && !fromList) {
    shift = shiftSize;
  } else if (!list && fromList) {
    shift = -shiftSize;
  }
  if (shift != rowShift) {
    rowShift = shift;
    row.style.transition = window.gReduceMotion
      ? "none"
      : "transform 200ms ease-out";
    row.style.transform = shift ? `translateY(${shift}px)` : "";
  }
  return list;
}

/** Puts the New Tab row back after a drag. */
export function endDrag() {
  rowShift = 0;
  let row = document.getElementById(NEWTAB_ROW_ID);
  if (row) {
    row.style.transition = "none";
    row.style.transform = "";
    row.style.removeProperty("transition");
  }
}

/**
 * After dropped tabs moved, puts them in or out of the pinned list.
 *
 * @param {Element[]} moved
 * @param {boolean|null} list
 */
export function applyDrop(moved, list) {
  if (list == null) {
    return;
  }
  for (let element of moved) {
    setInList(element, list);
  }
  normalize();
}

/**
 * Places pinned tiles dragged out into the tab list at the pointer: in the
 * pinned list above the New Tab row, among the other tabs below it.
 *
 * @param {MozTabbrowserTab[]} tabs Tabs that were just unpinned.
 * @param {number} clientY
 * @param {Map<MozTabbrowserTab, string>} pinnedURLs Their pinned addresses.
 */
export function placeUnpinned(tabs, clientY, pinnedURLs) {
  let row = newTabRow();
  let list = false;
  if (row) {
    let rect = row.getBoundingClientRect();
    list = clientY < rect.top + rect.height / 2;
  }
  let moving = new Set(tabs);
  let candidates = units().filter(
    u =>
      !moving.has(u) &&
      u.hasAttribute(ATTR) == list &&
      tabsOf(u).some(t => t.visible)
  );
  let before = candidates.find(u => {
    let rect = u.getBoundingClientRect();
    return rect.top + rect.height / 2 > clientY;
  });
  for (let tab of tabs) {
    if (list) {
      let url = pinnedURLs.get(tab);
      if (url) {
        tab.setAttribute("pinned-url", url);
      }
    }
    setInList(tab, list);
  }
  if (before) {
    gBrowser.moveTabsBefore(tabs, before);
  } else if (candidates.length) {
    gBrowser.moveTabsAfter(tabs, candidates.at(-1));
  }
  normalize();
}
