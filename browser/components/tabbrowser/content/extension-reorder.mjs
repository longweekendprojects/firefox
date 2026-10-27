/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global CustomizableUI, CustomizationHandler */

/**
 * Reordering pinned extension buttons by dragging them, outside Customize
 * mode. This covers the toolbar's own extension buttons and the copies split
 * view pane bars show.
 */

const TARGET_ID = "nav-bar-customization-target";
const DRAG_THRESHOLD = 5;
const SHIFT_TRANSITION = "transform 150ms ease";

/**
 * One drag of an extension button along a row of extension buttons. The
 * dragged button follows the pointer and the buttons it passes slide aside.
 */
export class ExtensionReorder {
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

function toolbarItem(node) {
  const item = node?.closest?.(".unified-extensions-item");
  return item?.parentElement?.id == TARGET_ID ? item : null;
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
    const items = [...document.getElementById(TARGET_ID).children].filter(
      node =>
        node.classList.contains("unified-extensions-item") &&
        node.checkVisibility()
    );
    if (items.length < 2) {
      return;
    }
    pending.reorder = new ExtensionReorder(
      pending.item,
      items,
      pending.x,
      node => node.id
    );
  }
  pending.reorder.move(event.clientX);
}

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
