/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* global browser */

// Pinned extension buttons can be dragged to a new order, in the toolbar and
// in split view pane bars, and right-clicking one offers Unpin from Toolbar.

const PAGE = "https://example.com/";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
  CustomizableUI.reset();
});

function loadExtension(name) {
  return ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      name,
      browser_action: { default_area: "navbar", default_title: name },
    },
    background() {
      browser.browserAction.onClicked.addListener(() => {
        browser.test.sendMessage("clicked");
      });
    },
  });
}

function widgetIdFor(extension) {
  return `${extension.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-browser-action`;
}

function restoreOrder() {
  for (const id of ids) {
    CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
  }
}

function extensionOrder(ids) {
  return CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR).filter(
    id => ids.includes(id)
  );
}

async function drag(from, to, offset = 0) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const y = a.top + a.height / 2;
  const x0 = a.left + a.width / 2;
  const x1 = b.left + b.width / 2 + offset;
  EventUtils.synthesizeMouseAtPoint(x0, y, { type: "mousedown" });
  for (let i = 1; i <= 8; i++) {
    EventUtils.synthesizeMouseAtPoint(x0 + ((x1 - x0) * i) / 8, y, {
      type: "mousemove",
      buttons: 1,
    });
    await new Promise(r => requestAnimationFrame(r));
  }
  EventUtils.synthesizeMouseAtPoint(x1, y, { type: "mouseup" });
  await TestUtils.waitForTick();
}

let extensions;
let ids;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
  extensions = ["One", "Two", "Three"].map(loadExtension);
  for (const extension of extensions) {
    await extension.startup();
  }
  ids = extensions.map(widgetIdFor);
});

add_task(async function test_drag_reorders_toolbar_buttons() {
  Assert.deepEqual(extensionOrder(ids), ids, "Pinned in install order");
  const [first, , third] = ids.map(id => document.getElementById(id));
  let clicked = false;
  extensions[2].onMessage("clicked", () => (clicked = true));

  await drag(third, first, -first.getBoundingClientRect().width / 4);
  Assert.deepEqual(
    extensionOrder(ids),
    [ids[2], ids[0], ids[1]],
    "Dragging the last button before the first moves it first"
  );
  Assert.ok(!clicked, "Dragging does not press the button");
  Assert.ok(!third.style.transform, "No drag offset is left behind");

  const button = document.getElementById(ids[1]);
  const half = button.getBoundingClientRect().width / 2;
  EventUtils.synthesizeMouse(button, half, 8, {});
  await extensions[1].awaitMessage("clicked");
  Assert.ok(true, "A plain click still presses the button");
  restoreOrder();
});

add_task(async function test_context_menu_unpins() {
  const node = document.getElementById(ids[0]);
  const menu = document.getElementById("toolbar-context-menu");
  const shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  EventUtils.synthesizeMouseAtCenter(node, { type: "contextmenu" });
  await shown;
  const unpin = menu.querySelector("#toolbar-context-unpin-extension");
  Assert.ok(!unpin.hidden, "Unpin from Toolbar is offered");
  Assert.equal(
    unpin.previousElementSibling.id,
    "toolbar-context-manage-extension",
    "Unpin from Toolbar sits next to Manage Extension"
  );
  Assert.ok(
    menu.querySelector("#toolbar-context-pin-to-toolbar").hidden,
    "The Pin to Toolbar checkbox is hidden"
  );
  const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.activateItem(unpin);
  await hidden;
  Assert.equal(
    CustomizableUI.getPlacementOfWidget(ids[0]).area,
    CustomizableUI.AREA_ADDONS,
    "The extension moved into the extensions panel"
  );
  restoreOrder();
});

add_task(async function test_drag_reorders_pane_bar_buttons() {
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
    await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    tabs.push(tab);
  }
  gBrowser.addTabSplitView(tabs, { insertBefore: tabs[0] });
  gBrowser.selectedTab = tabs[0];
  const header = () =>
    document.querySelector(
      `.split-pane-header[panel="${tabs[0].linkedPanel}"]`
    );
  const action = id =>
    header()?.querySelector(`.split-pane-action[data-widget-id="${id}"]`);
  await TestUtils.waitForCondition(
    () => ids.every(id => action(id)?.checkVisibility()),
    "pane bar shows every extension button"
  );

  Assert.deepEqual(extensionOrder(ids), ids, "Starts in install order");
  await drag(action(ids[0]), action(ids[2]), 4);
  Assert.deepEqual(
    extensionOrder(ids),
    [ids[1], ids[2], ids[0]],
    "Dragging a pane bar button past the last moves it last"
  );
  await TestUtils.waitForCondition(
    () =>
      [...header().querySelectorAll(".split-pane-action")]
        .map(b => b.dataset.widgetId)
        .join() == [ids[1], ids[2], ids[0]].join(),
    "pane bar shows the new order"
  );
  Assert.ok(tabs[0].splitview, "The pane did not move out of its split");

  tabs[0].splitview.unsplitTabs();
  gBrowser.removeTabs(tabs);
});

add_task(async function cleanup() {
  for (const extension of extensions) {
    await extension.unload();
  }
});
