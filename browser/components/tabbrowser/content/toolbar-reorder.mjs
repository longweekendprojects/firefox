/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global CustomizableUI, CustomizationHandler */

/**
 * Reordering the toolbar buttons after the address bar by dragging them,
 * outside Customize mode, as in Arc and Chrome. This covers extension buttons,
 * the extensions button and Firefox's own buttons there, and the extension
 * buttons split view pane bars show. The main menu button stays at the end.
 */

const TARGET_ID = "nav-bar-customization-target";
const DRAG_THRESHOLD = 5;
const SHIFT_TRANSITION = "transform 150ms ease";

/**
 * One drag of a button along a row of buttons. The dragged button follows the
 * pointer and the buttons it passes slide aside.
 */
export class ToolbarReorder {
  /**
   * @param {Element} button The dragged button.
   * @param {Element[]} items Every button in the row, in order.
   * @param {number} startX Pointer position when the drag started.
   * @param {Function} widgetIdOf Returns the widget id a button stands for.
   */
  constructor(button, items, startX, widgetIdOf) {
    this.button = button;
    this.items = items;
    this.widgetIdOf = widgetIdOf;
    this.startX = startX;
    this.from = items.indexOf(button);
    this.to = this.from;
    this.rects = items.map(item => item.getBoundingClientRect());
    const rect = this.rects[this.from];
    const next = this.rects[this.from + 1];
    const prev = this.rects[this.from - 1];
    let gap = 0;
    if (next) {
      gap = next.left - rect.right;
    } else if (prev) {
      gap = rect.left - prev.right;
    }
    this.step = rect.width + gap;
    this.center = rect.left + rect.width / 2;
    const animate = !button.documentGlobal.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    for (const item of items) {
      item.style.transition =
        animate && item !== button ? SHIFT_TRANSITION : "";
    }
    button.style.position = "relative";
    button.style.zIndex = "1";
    button.setAttribute("extension-dragging", "true");
  }

  move(x) {
    const rect = this.rects[this.from];
    const min = this.rects[0].left - rect.left;
    const max = this.rects.at(-1).right - rect.right;
    const dx = Math.min(Math.max(x - this.startX, min), max);
    this.button.style.transform = `translateX(${dx}px)`;
    const center = this.center + dx;
    // A button counts as passed once the dragged button's center reaches
    // its center, which the drag can do at either end of the row.
    this.to = this.rects.filter((r, i) => {
      const c = r.left + r.width / 2;
      return i < this.from ? c < center : i > this.from && c <= center;
    }).length;
    this.items.forEach((item, i) => {
      let shift = 0;
      if (i > this.from && i <= this.to) {
        shift = -this.step;
      } else if (i < this.from && i >= this.to) {
        shift = this.step;
      }
      if (i != this.from) {
        item.style.transform = shift ? `translateX(${shift}px)` : "";
      }
    });
  }

  /**
   * Ends the drag and, when `commit` is true, saves the new order.
   *
   * @param {boolean} commit
   */
  finish(commit) {
    for (const item of this.items) {
      item.style.transition = "";
      item.style.transform = "";
    }
    this.button.style.position = "";
    this.button.style.zIndex = "";
    this.button.removeAttribute("extension-dragging");
    if (!commit || this.to == this.from) {
      return;
    }
    const ids = this.items.map(this.widgetIdOf);
    const id = ids[this.from];
    const others = ids.filter((_, i) => i != this.from);
    let position;
    if (this.to < others.length) {
      position = CustomizableUI.getPlacementOfWidget(others[this.to]).position;
    } else {
      position =
        CustomizableUI.getPlacementOfWidget(others.at(-1)).position + 1;
    }
    CustomizableUI.moveWidgetWithinArea(id, position);
  }
}

let pending = null;

/** The toolbar items after the address bar that can be dragged, in order. */
function movableItems() {
  const items = [];
  let afterUrlbar = false;
  for (const node of document.getElementById(TARGET_ID).children) {
    if (node.id == "urlbar-container") {
      afterUrlbar = true;
      continue;
    }
    if (
      afterUrlbar &&
      !node.id.startsWith("customizableui-special-") &&
      CustomizableUI.getPlacementOfWidget(node.id)?.area ==
        CustomizableUI.AREA_NAVBAR &&
      node.checkVisibility()
    ) {
      items.push(node);
    }
  }
  return items;
}

function toolbarItem(node) {
  let item = node;
  while (item && item.parentElement?.id != TARGET_ID) {
    item = item.parentElement;
  }
  return item && movableItems().includes(item) ? item : null;
}

/** Closes a panel or menu the press opened from `item`. */
function closePopupsFrom(item) {
  for (const popup of document.querySelectorAll("panel, menupopup")) {
    if (
      popup.state == "open" &&
      (item.contains(popup.anchorNode) || item.contains(popup))
    ) {
      popup.hidePopup();
    }
  }
}

function onPointerDown(event) {
  if (event.button != 0 || CustomizationHandler.isCustomizing()) {
    return;
  }
  const item = toolbarItem(event.target);
  if (!item) {
    return;
  }
  pending = { item, x: event.clientX, y: event.clientY, reorder: null };
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
}

function onPointerMove(event) {
  if (!pending) {
    return;
  }
  if (!(event.buttons & 1)) {
    onPointerUp({ type: "pointercancel" });
    return;
  }
  if (!pending.reorder) {
    if (Math.abs(event.clientX - pending.x) < DRAG_THRESHOLD) {
      return;
    }
    const items = movableItems();
    if (items.length < 2) {
      return;
    }
    // Some buttons open their panel on press, some of them a moment later;
    // a drag closes it and keeps it from opening.
    closePopupsFrom(pending.item);
    window.addEventListener("popupshowing", blockPopups, true);
    pending.reorder = new ToolbarReorder(
      pending.item,
      items,
      pending.x,
      node => node.id
    );
  }
  pending.reorder.move(event.clientX);
}

function blockPopups(event) {
  const anchor = event.target.anchorNode ?? event.target.triggerNode;
  if (pending?.item.contains(anchor) || lastDragged?.contains(anchor)) {
    event.preventDefault();
  }
}

let lastDragged = null;

function stopClick(event) {
  event.preventDefault();
  event.stopPropagation();
}

function onPointerUp(event) {
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onPointerUp, true);
  const reorder = pending?.reorder;
  pending = null;
  if (!reorder) {
    return;
  }
  reorder.finish(event.type == "pointerup");
  const dragged = reorder.button;
  lastDragged = dragged;
  closePopupsFrom(dragged);
  // A panel the press asked for can still be on its way.
  window.setTimeout(() => {
    if (lastDragged === dragged) {
      window.removeEventListener("popupshowing", blockPopups, true);
      lastDragged = null;
    }
    closePopupsFrom(dragged);
    // A button whose panel did not open would otherwise stay pressed.
    for (const button of [dragged, ...dragged.querySelectorAll("*")]) {
      if (button.open) {
        button.open = false;
      }
    }
  }, 500);
  // The release would otherwise press the button.
  window.addEventListener("click", stopClick, { capture: true, once: true });
  window.setTimeout(
    () => window.removeEventListener("click", stopClick, true),
    0
  );
}

export function init() {
  const navbar = document.getElementById("nav-bar");
  navbar?.addEventListener("pointerdown", onPointerDown, true);
}
