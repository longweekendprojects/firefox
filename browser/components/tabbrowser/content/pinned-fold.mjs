/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser */

/**
 * Folding the pinned sections of the expanded vertical tab strip. The pinned
 * tiles and the pinned list fold independently, each from a small button on
 * the line under it. A folded list still shows the item holding the selected
 * tab. Fold state is kept in prefs, so it applies to every window and
 * survives restarts.
 */

const PREFS = {
  tiles: "browser.tabs.pinnedTiles.folded",
  list: "browser.tabs.pinnedList.folded",
};
const LIST_ATTR = "pinned-list";
const AWAY_ATTR = "folded-away";
const DURATION_MS = 180;

let toggles = {};
let pendingFrame = 0;

export function isFolded(section) {
  return Services.prefs.getBoolPref(PREFS[section], false);
}

/**
 * Folds or unfolds a pinned section.
 *
 * @param {"tiles"|"list"} section
 * @param {boolean} folded
 */
export function setFolded(section, folded) {
  if (isFolded(section) != folded) {
    Services.prefs.setBoolPref(PREFS[section], folded);
  }
}

export function toggle(section) {
  setFolded(section, !isFolded(section));
}

/**
 * Whether a tab strip item is hidden by the folded pinned list. The drag and
 * drop code skips these items.
 *
 * @param {Element} element
 */
export function isFoldedAway(element) {
  return element.hasAttribute(AWAY_ATTR);
}

export function init() {
  let tabs = gBrowser.tabContainer;
  toggles.tiles = makeToggle("pinned-tiles-fold", "tiles");
  document.getElementById("vertical-pinned-tabs-splitter").after(toggles.tiles);
  toggles.list = makeToggle("pinned-list-fold", "list");
  tabs.arrowScrollbox.prepend(toggles.list);

  let observer = () => {
    update({ animate: true });
  };
  for (let pref of Object.values(PREFS)) {
    Services.prefs.addObserver(pref, observer);
  }
  for (let type of ["TabSelect", "TabPinned", "TabUnpinned", "TabShow"]) {
    tabs.addEventListener(type, schedule);
  }
  tabs.addEventListener("TabHide", schedule);
  new MutationObserver(schedule).observe(tabs.arrowScrollbox, {
    childList: true,
    subtree: true,
  });
  new MutationObserver(schedule).observe(tabs, {
    attributes: true,
    attributeFilter: ["orient", "expanded"],
  });
  window.addEventListener(
    "unload",
    () => {
      for (let pref of Object.values(PREFS)) {
        Services.prefs.removeObserver(pref, observer);
      }
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
      }
    },
    { once: true }
  );
  update();
}

function makeToggle(id, section) {
  let button = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button"
  );
  button.id = id;
  button.className = "pinned-fold-toggle";
  button.hidden = true;
  let icon = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
  icon.className = "pinned-fold-icon";
  icon.alt = "";
  let count = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
  count.className = "pinned-fold-count";
  button.append(icon, count);
  button.addEventListener("click", event => {
    event.stopPropagation();
    toggle(section);
  });
  for (let type of ["mousedown", "dragstart"]) {
    button.addEventListener(type, event => event.stopPropagation());
  }
  let anchor = document.createXULElement("box");
  anchor.className = "pinned-fold-anchor";
  anchor.id = `${id}-anchor`;
  anchor.append(button);
  return anchor;
}

function schedule() {
  if (!pendingFrame) {
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = 0;
      update();
    });
  }
}

function expandedVertical() {
  let tabs = gBrowser.tabContainer;
  return tabs.verticalMode && tabs.hasAttribute("expanded");
}

function listUnits() {
  return [...gBrowser.tabContainer.arrowScrollbox.children].filter(
    el =>
      el.hasAttribute(LIST_ATTR) &&
      ["tab", "tab-group", "tab-split-view-wrapper"].includes(el.localName)
  );
}

function tabsOf(unit) {
  return unit.localName == "tab"
    ? [unit]
    : [...unit.querySelectorAll("tab.tabbrowser-tab")];
}

function shown(unit) {
  return tabsOf(unit).some(t => t.visible) || unit.localName == "tab-group";
}

/**
 * Applies the fold prefs to the tab strip.
 *
 * @param {object} [options]
 * @param {boolean} [options.animate] Animate items hiding or showing.
 */
export function update({ animate = false } = {}) {
  let tabs = gBrowser.tabContainer;
  let container = tabs.pinnedTabsContainer;
  let active = expandedVertical();
  animate &&= !window.gReduceMotion;

  let tilesFolded = active && isFolded("tiles");
  if (container.hasAttribute("folded") != tilesFolded) {
    if (animate) {
      animateFold([container], tilesFolded, () =>
        container.toggleAttribute("folded", tilesFolded)
      );
    } else {
      container.toggleAttribute("folded", tilesFolded);
    }
  }
  let tileCount = gBrowser.visibleTabs.filter(t => t.pinned).length;
  updateToggle(toggles.tiles, "tiles", active && tileCount > 0, tileCount);

  let listFolded = active && isFolded("list");
  let units = listUnits().filter(shown);
  let leaving = [];
  let arriving = [];
  for (let unit of units) {
    let away = listFolded && !tabsOf(unit).some(t => t.selected);
    if (unit.hasAttribute(AWAY_ATTR) != away) {
      (away ? leaving : arriving).push(unit);
    }
  }
  for (let unit of tabs.arrowScrollbox.querySelectorAll(`[${AWAY_ATTR}]`)) {
    if (!unit.hasAttribute(LIST_ATTR) && !arriving.includes(unit)) {
      arriving.push(unit);
    }
  }
  let apply = (list, away) => {
    for (let unit of list) {
      unit.toggleAttribute(AWAY_ATTR, away);
    }
    tabs._invalidateCachedVisibleTabs();
  };
  if (animate) {
    animateFold(leaving, true, () => apply(leaving, true));
    animateFold(arriving, false, () => apply(arriving, false));
  } else {
    apply(leaving, true);
    apply(arriving, false);
  }
  updateToggle(toggles.list, "list", active && !!units.length, units.length);
  toggles.list.toggleAttribute(
    "empty-fold",
    listFolded &&
      units.every(
        unit =>
          leaving.includes(unit) || (isAway(unit) && !arriving.includes(unit))
      )
  );
}

function isAway(unit) {
  return unit.hasAttribute(AWAY_ATTR);
}

function updateToggle(anchor, section, visible, count) {
  let button = anchor.firstElementChild;
  let folded = isFolded(section);
  anchor.hidden = !visible;
  button.hidden = !visible;
  button.toggleAttribute("folded", folded);
  button.setAttribute("aria-expanded", String(!folded));
  button.querySelector(".pinned-fold-count").textContent = folded
    ? String(count)
    : "";
  document.l10n.setAttributes(
    button,
    folded ? "pinned-section-unfold" : "pinned-section-fold",
    { count }
  );
}

/**
 * Animates elements folding to no height, or unfolding from no height.
 * `apply` changes their fold state; it runs before an unfold and after a
 * fold.
 *
 * @param {Element[]} elements
 * @param {boolean} folding
 * @param {Function} apply
 */
function animateFold(elements, folding, apply) {
  if (!elements.length) {
    return;
  }
  if (!folding) {
    apply();
  }
  let parts = elements.flatMap(element =>
    element.localName == "tab-group"
      ? [...element.children].filter(c => c.getBoundingClientRect().height)
      : [element]
  );
  let animations = parts.map(element => {
    let height = element.getBoundingClientRect().height;
    let expanded = { height: `${height}px`, opacity: 1 };
    let shrunk = {
      height: "0px",
      opacity: 0,
      marginBlock: "0px",
      paddingBlock: "0px",
    };
    element.style.overflow = "clip";
    return element.animate(folding ? [expanded, shrunk] : [shrunk, expanded], {
      duration: DURATION_MS,
      easing: "ease-out",
    }).finished;
  });
  Promise.allSettled(animations).then(() => {
    for (let element of parts) {
      element.style.removeProperty("overflow");
    }
    if (folding) {
      apply();
    }
  });
}
