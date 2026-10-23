/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser, SessionStore, MozXULElement, gReduceMotion, AppConstants */

/**
 * Spaces: named sets of tabs, each with its own pinned tabs, shown one at a
 * time in the vertical tab strip. Tabs of other spaces are hidden with the
 * stock tab hiding API, so they keep their state and are unloaded by the stock
 * tab unloader like any background tab. A space may use its own container,
 * which gives it separate logins.
 *
 * A tab's space is its "space" attribute, which SessionStore persists. Tabs
 * without one belong to the first space. The space list is shared by all
 * windows through a pref. The shown space always follows the selected tab.
 *
 * A horizontal swipe over the tab strip shows the next or previous space, and
 * on macOS Ctrl+1 to Ctrl+9 show a space by position. The sidebar takes a
 * tint of the shown space's color.
 */

import { ContainerEditor } from "chrome://browser/content/usercontext/ContainerEditor.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
});

const LIST_PREF = "browser.spaces.list";
const ACTIVE_PREF = "browser.spaces.active";
const HIDDEN_BY = "spaces";
const STYLESHEET = "chrome://browser/content/tabbrowser/spaces.css";

let spaces = [];
let activeId = null;
// The last selected tab of each space in this window.
let lastSelected = new Map();
let bar = null;
let list = null;
let contextMenu = null;
let contextSpaceId = null;
let initialized = false;
// Horizontal scroll, in CSS pixels, that counts as a swipe between spaces.
const SWIPE_DISTANCE = 80;
// Pause in scroll events, in milliseconds, that ends a swipe.
const SWIPE_END_DELAY = 200;
let swipe = { distance: 0, done: false, timer: 0 };

function readSpaces() {
  try {
    let saved = JSON.parse(Services.prefs.getStringPref(LIST_PREF, "[]"));
    if (Array.isArray(saved) && saved.length) {
      return saved.filter(s => s && typeof s.id == "string");
    }
  } catch {}
  return [{ id: "default", name: "", icon: "circle", color: "blue" }];
}

function writeSpaces(newSpaces) {
  Services.prefs.setStringPref(LIST_PREF, JSON.stringify(newSpaces));
}

function getSpace(id) {
  return spaces.find(s => s.id == id);
}

export function spaceOf(tab) {
  let id = tab.getAttribute("space");
  return id && getSpace(id) ? id : spaces[0].id;
}

export function getSpaces() {
  return spaces;
}

export function getActiveId() {
  return activeId;
}

function containerOf(space) {
  let id = space?.userContextId;
  if (!id || !lazy.ContextualIdentityService.getPublicIdentityFromId(id)) {
    return undefined;
  }
  return id;
}

function updateDefaults() {
  window.spacesUserContextId = containerOf(getSpace(activeId));
}

export function init() {
  if (initialized) {
    return;
  }
  initialized = true;
  window.windowUtils.loadSheetUsingURIString(
    STYLESHEET,
    window.windowUtils.AUTHOR_SHEET
  );
  MozXULElement.insertFTLIfNeeded("browser/tabbrowser.ftl");
  spaces = readSpaces();

  let selected = gBrowser.selectedTab;
  if (!selected.hasAttribute("space") && gBrowser.tabs.length == 1) {
    let last = Services.prefs.getStringPref(ACTIVE_PREF, "");
    if (getSpace(last)) {
      selected.setAttribute("space", last);
    }
  }
  activeId = spaceOf(selected);
  updateDefaults();

  buildBar();
  render();
  apply();

  gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
  gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);
  gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
  gBrowser.tabContainer.addEventListener("SSTabRestoring", onTabRestoring);
  window.addEventListener("SSWindowRestored", onWindowRestored);
  gBrowser.tabContainer.addEventListener("wheel", onWheel, { passive: false });
  if (AppConstants.platform == "macosx") {
    window.addEventListener("keydown", onKeyDown, { mozSystemGroup: true });
  }
  Services.prefs.addObserver(LIST_PREF, onListChanged);
  window.addEventListener("unload", uninit, { once: true });
}

function uninit() {
  Services.prefs.removeObserver(LIST_PREF, onListChanged);
  window.clearTimeout(swipe.timer);
}

function onTabOpen(event) {
  let tab = event.target;
  if (!tab.hasAttribute("space")) {
    tab.setAttribute("space", activeId);
  }
}

function onTabSelect() {
  let tab = gBrowser.selectedTab;
  let id = spaceOf(tab);
  if (id != activeId) {
    switchTo(id, { tab });
  } else {
    lastSelected.set(id, tab);
  }
}

/** Shows the space `offset` places after the shown one, if there is one. */
export function step(offset) {
  let index = spaces.findIndex(s => s.id == activeId) + offset;
  if (index >= 0 && index < spaces.length) {
    switchTo(spaces[index].id);
  }
}

function onWheel(event) {
  if (spaces.length < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
    return;
  }
  event.preventDefault();
  window.clearTimeout(swipe.timer);
  swipe.timer = window.setTimeout(() => {
    swipe = { distance: 0, done: false, timer: 0 };
  }, SWIPE_END_DELAY);
  if (swipe.done) {
    return;
  }
  let pixels =
    event.deltaMode == event.DOM_DELTA_PIXEL ? event.deltaX : event.deltaX * 16;
  swipe.distance += pixels;
  if (Math.abs(swipe.distance) >= SWIPE_DISTANCE) {
    // One swipe moves one space, however far it goes.
    swipe.done = true;
    step(swipe.distance > 0 ? 1 : -1);
  }
}

function onKeyDown(event) {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    !event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !/^Digit[1-9]$/.test(event.code)
  ) {
    return;
  }
  let space = spaces[Number(event.code.at(-1)) - 1];
  if (!space) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  switchTo(space.id);
}

function onTabClose(event) {
  let tab = event.target;
  for (let [id, last] of lastSelected) {
    if (last == tab) {
      lastSelected.delete(id);
    }
  }
}

function onTabRestoring(event) {
  let tab = event.target;
  let id = spaceOf(tab);
  if (id == activeId) {
    return;
  }
  if (tab.selected) {
    switchTo(id, { tab });
  } else {
    gBrowser.hideTab(tab, HIDDEN_BY);
    updateGroups();
  }
}

function onWindowRestored() {
  activeId = spaceOf(gBrowser.selectedTab);
  updateDefaults();
  render();
  apply();
}

function onListChanged() {
  spaces = readSpaces();
  for (let tab of gBrowser.tabs) {
    if (tab.hasAttribute("space") && !getSpace(tab.getAttribute("space"))) {
      tab.setAttribute("space", spaces[0].id);
    }
  }
  let id = spaceOf(gBrowser.selectedTab);
  if (id != activeId) {
    activeId = id;
    lastSelected.delete(id);
  }
  updateDefaults();
  render();
  apply();
}

function isHiddenBySpaces(tab) {
  return (
    tab.hidden && SessionStore.getCustomTabValue(tab, "hiddenBy") == HIDDEN_BY
  );
}

/** Shows the tabs of the shown space and hides all others. */
function apply() {
  for (let tab of gBrowser.tabs) {
    if (spaceOf(tab) == activeId) {
      if (isHiddenBySpaces(tab)) {
        gBrowser.showTab(tab);
      }
    } else if (!tab.hidden) {
      gBrowser.hideTab(tab, HIDDEN_BY);
    }
  }
  updateGroups();
}

function updateGroups() {
  for (let group of gBrowser.tabGroups) {
    let hide = group.tabs.length && group.tabs.every(isHiddenBySpaces);
    if (group.hidden != hide) {
      group.hidden = hide;
    }
  }
}

function pickTab(id) {
  let last = lastSelected.get(id);
  if (last?.isConnected && !last.closing && spaceOf(last) == id) {
    return last;
  }
  let best = null;
  for (let tab of gBrowser.tabs) {
    if (
      spaceOf(tab) == id &&
      !tab.closing &&
      tab != window.FirefoxViewHandler?.tab &&
      (!tab.hidden || isHiddenBySpaces(tab)) &&
      (!best || tab.lastAccessed > best.lastAccessed)
    ) {
      best = tab;
    }
  }
  return best;
}

/**
 * Shows another space.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {MozTabbrowserTab} [options.tab]
 *   The tab to select in that space. Defaults to the space's last selected
 *   tab, or a new tab when the space has none.
 */
export function switchTo(id, { tab = null } = {}) {
  if (!getSpace(id) || id == activeId) {
    return;
  }
  let from = activeId;
  activeId = id;
  Services.prefs.setStringPref(ACTIVE_PREF, id);
  updateDefaults();
  gBrowser.clearMultiSelectedTabs();

  for (let t of gBrowser.tabs) {
    if (spaceOf(t) == id && isHiddenBySpaces(t)) {
      gBrowser.showTab(t);
    }
  }
  tab ??= pickTab(id);
  if (tab) {
    if (!tab.selected) {
      gBrowser.selectedTab = tab;
    }
  } else {
    window.BrowserCommands.openTab();
  }
  lastSelected.set(id, gBrowser.selectedTab);
  apply();
  render();
  animate(
    spaces.findIndex(s => s.id == id) > spaces.findIndex(s => s.id == from)
  );
}

function animate(forward) {
  if (gReduceMotion) {
    return;
  }
  let offset = forward ? "24px" : "-24px";
  for (let el of [
    gBrowser.tabContainer.arrowScrollbox,
    gBrowser.pinnedTabsContainer,
  ]) {
    el.animate(
      [
        { transform: `translateX(${offset})`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }
}

/**
 * Moves tabs to another space. A tab in a split moves with its whole split.
 * When the selected tab moves, its new space is shown.
 *
 * @param {MozTabbrowserTab[]} tabs
 * @param {string} id
 */
export function moveTabs(tabs, id) {
  if (!getSpace(id)) {
    return;
  }
  let moving = new Set();
  for (let tab of tabs) {
    for (let t of tab.splitview?.tabs ?? [tab]) {
      moving.add(t);
    }
  }
  let follow = [...moving].find(t => t.selected);
  for (let tab of moving) {
    tab.setAttribute("space", id);
  }
  if (follow) {
    switchTo(id, { tab: follow });
  } else {
    apply();
  }
}

/**
 * Removes a space. Its tabs move to the first remaining space, so nothing is
 * closed. Its container, if any, is kept with its data.
 *
 * @param {string} id
 */
export function removeSpace(id) {
  if (spaces.length < 2 || !getSpace(id)) {
    return;
  }
  let remaining = spaces.filter(s => s.id != id);
  if (activeId == id) {
    switchTo(remaining[0].id);
  }
  writeSpaces(remaining);
}

async function defaultName() {
  let [value] = await document.l10n.formatValues(["spaces-default-name"]);
  return value;
}

function buildBar() {
  bar = document.createElement("div");
  bar.id = "spaces-bar";
  bar.setAttribute("role", "toolbar");
  document.l10n.setAttributes(bar, "spaces-bar");
  list = document.createElement("div");
  list.id = "spaces-list";
  let add = document.createXULElement("toolbarbutton");
  add.id = "spaces-add-button";
  add.className = "toolbarbutton-1";
  document.l10n.setAttributes(add, "spaces-add-button");
  add.addEventListener("command", () => openEditor(add));
  bar.append(list, add);
  placeBar();
  new MutationObserver(placeBar).observe(gBrowser.tabContainer, {
    attributes: true,
    attributeFilter: ["orient", "expanded"],
  });
  list.addEventListener("command", event => {
    let id = event.target.closest(".space-button")?.dataset.spaceId;
    if (id) {
      switchTo(id);
    }
  });
  list.addEventListener("contextmenu", event => {
    let button = event.target.closest(".space-button");
    if (!button) {
      return;
    }
    event.preventDefault();
    contextSpaceId = button.dataset.spaceId;
    getContextMenu().openPopupAtScreen(
      event.screenX,
      event.screenY,
      true,
      event
    );
  });
}

/**
 * Puts the bar in the sidebar's bottom row, next to the sidebar tools, while
 * the vertical tab strip is expanded, and at the end of the tab strip
 * otherwise.
 */
function placeBar() {
  let container = gBrowser.tabContainer;
  let main = document.querySelector("sidebar-main");
  let inRow =
    main &&
    container.getAttribute("orient") == "vertical" &&
    container.hasAttribute("expanded");
  if (inRow && bar.parentNode != main) {
    bar.slot = "spaces";
    main.append(bar);
  } else if (!inRow && bar.parentNode != container) {
    bar.removeAttribute("slot");
    container.append(bar);
  }
}

function render() {
  if (!list) {
    return;
  }
  let buttons = spaces.map(space => {
    let button = document.createXULElement("toolbarbutton");
    button.className = `space-button toolbarbutton-1 identity-color-${space.color} identity-icon-${space.icon}`;
    button.dataset.spaceId = space.id;
    button.setAttribute("type", "radio");
    if (space.emoji) {
      button.setAttribute("emoji", "");
      button.setAttribute("label", space.emoji);
    }
    if (space.name) {
      button.setAttribute("tooltiptext", space.name);
      button.setAttribute("aria-label", space.name);
    } else {
      document.l10n.setAttributes(button, "spaces-default-button");
    }
    if (space.id == activeId) {
      button.setAttribute("checked", "true");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }
    return button;
  });
  list.replaceChildren(...buttons);
  bar.toggleAttribute("multiple", spaces.length > 1);
  updateTint();
}

/** Tints the sidebar with the color of the shown space. */
function updateTint() {
  let container = document.getElementById("sidebar-container");
  let button = list.querySelector("[checked]");
  let color =
    spaces.length > 1 &&
    button &&
    getComputedStyle(button).getPropertyValue("--identity-icon-color");
  if (color) {
    container?.style.setProperty("--space-tint-color", color);
    container?.setAttribute("space-tint", "");
  } else {
    container?.style.removeProperty("--space-tint-color");
    container?.removeAttribute("space-tint");
  }
}

function getContextMenu() {
  if (contextMenu) {
    return contextMenu;
  }
  contextMenu = document.createXULElement("menupopup");
  contextMenu.id = "spaces-context-menu";
  let edit = document.createXULElement("menuitem");
  edit.id = "spaces-context-edit";
  document.l10n.setAttributes(edit, "spaces-context-edit");
  edit.addEventListener("command", () =>
    openEditor(
      list.querySelector(`[data-space-id="${CSS.escape(contextSpaceId)}"]`),
      contextSpaceId
    )
  );
  let remove = document.createXULElement("menuitem");
  remove.id = "spaces-context-delete";
  document.l10n.setAttributes(remove, "spaces-context-delete");
  remove.addEventListener("command", () => removeSpace(contextSpaceId));
  contextMenu.addEventListener("popupshowing", () => {
    remove.disabled = spaces.length < 2;
  });
  contextMenu.append(edit, remove);
  document.getElementById("mainPopupSet").append(contextMenu);
  return contextMenu;
}

let panel = null;

function getPanel() {
  if (panel) {
    return panel;
  }
  let fragment = MozXULElement.parseXULToFragment(`
    <panel id="spaces-panel" class="panel-no-padding" type="arrow"
           orient="vertical" role="dialog" aria-labelledby="spaces-panel-title">
      <box class="panel-header">
        <html:h1 id="spaces-panel-title"></html:h1>
      </box>
      <toolbarseparator/>
      <vbox id="spaces-panel-body" class="panel-subview-body"/>
      <html:moz-button-group class="panel-footer">
        <html:moz-button id="spaces-panel-cancel"
                         data-l10n-id="containers-panel-cancel-button"/>
        <html:moz-button id="spaces-panel-done" type="primary"
                         data-l10n-id="containers-panel-create-button"/>
      </html:moz-button-group>
    </panel>`);
  panel = fragment.firstElementChild;
  document.getElementById("mainPopupSet").append(panel);
  return panel;
}

/**
 * Opens the form that creates a space, or edits one when an id is given.
 *
 * @param {Element} anchor
 * @param {string} [id]
 */
export async function openEditor(anchor, id = null) {
  let space = id && getSpace(id);
  let popup = getPanel();
  if (popup.state == "open" || popup.state == "showing") {
    return;
  }
  let body = popup.querySelector("#spaces-panel-body");
  body.replaceChildren();
  document.l10n.setAttributes(
    popup.querySelector("#spaces-panel-title"),
    space ? "spaces-panel-edit-title" : "spaces-panel-title"
  );
  let spaceName = space ? space.name || (await defaultName()) : "";
  let editor = new ContainerEditor(body, {
    identity: space
      ? { name: spaceName, icon: space.icon, color: space.color }
      : null,
  });
  editor.render();

  let separate = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "moz-checkbox"
  );
  separate.id = "spaces-panel-separate";
  document.l10n.setAttributes(separate, "spaces-separate-logins");
  separate.checked = !!containerOf(space);
  separate.disabled = !!containerOf(space);
  editor.form.append(separate);

  let done = popup.querySelector("#spaces-panel-done");
  let cancel = popup.querySelector("#spaces-panel-cancel");
  let updateValidity = () => {
    done.disabled = !editor.isValid;
  };
  editor.form.addEventListener("input", updateValidity);
  updateValidity();

  let onDone = () => {
    if (!editor.isValid) {
      return;
    }
    let data = new FormData(editor.form);
    let values = {
      name: data.get("name").trim(),
      icon: data.get("icon"),
      color: data.get("color"),
    };
    commit(id, values, separate.checked);
    popup.hidePopup();
  };
  let onCancel = () => popup.hidePopup();
  let onSubmit = event => {
    event.preventDefault();
    onDone();
  };
  done.addEventListener("click", onDone);
  cancel.addEventListener("click", onCancel);
  editor.form.addEventListener("submit", onSubmit);
  popup.addEventListener("popupshown", () => editor.focus(), { once: true });
  popup.addEventListener(
    "popuphidden",
    () => {
      done.removeEventListener("click", onDone);
      cancel.removeEventListener("click", onCancel);
      body.replaceChildren();
    },
    { once: true }
  );
  popup.openPopup(anchor, "before_end");
}

async function commit(id, values, separateLogins) {
  let current = readSpaces().map(s => ({ ...s }));
  if (!current[0].name) {
    current[0].name = await defaultName();
  }
  let space = id && current.find(s => s.id == id);
  if (!space) {
    space = { id: Services.uuid.generateUUID().toString().slice(1, -1) };
    current.push(space);
  }
  if (space.icon != values.icon) {
    delete space.emoji;
  }
  Object.assign(space, values);
  let userContextId = containerOf(space);
  if (userContextId) {
    lazy.ContextualIdentityService.update(
      userContextId,
      values.name,
      values.icon,
      values.color
    );
  } else if (separateLogins) {
    space.userContextId = lazy.ContextualIdentityService.create(
      values.name,
      values.icon,
      values.color
    ).userContextId;
  }
  writeSpaces(current);
  if (!id) {
    switchTo(space.id);
  }
}

/**
 * Adds "Move to Space" items to the tab context menu's "Move Tab" submenu.
 *
 * @param {MozTabbrowserTab} contextTab
 */
export function updateTabContextMenu(contextTab) {
  let popup = document.getElementById("moveTabOptionsMenu");
  for (let item of popup.querySelectorAll("[spaceid]")) {
    item.remove();
  }
  let others = spaces.filter(s => s.id != spaceOf(contextTab));
  if (!others.length) {
    return;
  }
  let anchor = document.getElementById("context_openTabInWindow");
  let items = [document.createXULElement("menuseparator")];
  items[0].setAttribute("spaceid", "");
  for (let space of others) {
    let item = document.createXULElement("menuitem");
    item.setAttribute("spaceid", space.id);
    item.className = `menuitem-iconic identity-color-${space.color} identity-icon-${space.icon}`;
    document.l10n.setAttributes(item, "spaces-move-tab-to", {
      name: space.name || "",
    });
    item.addEventListener("command", () => {
      let tabs = contextTab.multiselected
        ? gBrowser.selectedTabs
        : [contextTab];
      moveTabs(tabs, space.id);
    });
    items.push(item);
  }
  anchor.after(...items);
}
