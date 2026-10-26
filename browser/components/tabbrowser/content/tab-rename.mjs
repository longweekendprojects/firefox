/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gBrowser */

/**
 * Renaming a tab from its context menu, as in Arc. The name is edited in
 * place over the tab's title and shown instead of the page title. An empty
 * name goes back to the page title.
 */

const MENU_ID = "context_renameTab";
const INPUT_ID = "tab-rename-input";

let menuTab = null;

/**
 * Shows the Rename Tab item for a single tab.
 *
 * @param {MozTabbrowserTab} contextTab
 * @param {boolean} multiselected
 */
export function updateTabContextMenu(contextTab, multiselected) {
  let item = document.getElementById(MENU_ID);
  if (!item) {
    return;
  }
  menuTab = contextTab;
  item.hidden = multiselected || contextTab.hasAttribute("customizemode");
  if (!item._renameListener) {
    item._renameListener = () => {
      let tab = menuTab;
      // Wait for the menu to close, so the editor keeps focus.
      window.setTimeout(() => startRename(tab), 0);
    };
    item.addEventListener("command", item._renameListener);
  }
}

function editorRect(tab) {
  let label = tab.querySelector(".tab-label-container");
  let rect = label?.getBoundingClientRect();
  if (rect?.width >= 40) {
    return rect;
  }
  return tab.getBoundingClientRect();
}

/**
 * Opens the name editor over a tab's title.
 *
 * @param {MozTabbrowserTab} tab
 */
export function startRename(tab) {
  if (!tab?.isConnected || tab.closing) {
    return;
  }
  document.getElementById(INPUT_ID)?.blur();
  if (tab.group?.collapsed) {
    tab.group.collapsed = false;
  }
  tab.scrollIntoView?.({ block: "nearest" });
  let rect = editorRect(tab);
  let input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
  input.id = INPUT_ID;
  document.l10n.setAttributes(input, "tab-rename-input");
  input.value = tab.getAttribute("custom-label") || tab.label;
  let width = Math.max(rect.width, 180);
  let left = Math.min(rect.left, window.innerWidth - width - 4);
  input.style.left = `${Math.max(left, 4)}px`;
  input.style.top = `${rect.top + rect.height / 2}px`;
  input.style.width = `${width}px`;
  document.body.append(input);
  tab.setAttribute("renaming", "");

  let done = false;
  let finish = save => {
    if (done) {
      return;
    }
    done = true;
    tab.removeAttribute("renaming");
    let value = input.value;
    input.remove();
    if (save && tab.isConnected) {
      gBrowser.setCustomTabLabel(tab, value);
    }
  };
  input.addEventListener("keydown", event => {
    if (event.key == "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      gBrowser.selectedBrowser.focus();
    } else if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      gBrowser.selectedBrowser.focus();
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  input.select();
}
