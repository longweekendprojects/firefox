/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* global browser */

// Each split view pane bar shows the toolbar's extension buttons for its own
// tab, and the toolbar's own extension buttons hide while panes show.

const PAGE = "https://example.com/";

registerCleanupFunction(() => {
  Services.prefs.clearUserPref("browser.tabs.splitview.hasUsed");
  CustomizableUI.reset();
});

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
});

function loadExtension({ popup = true } = {}) {
  return ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      browser_action: {
        default_area: "navbar",
        default_title: "Pane test",
        ...(popup ? { default_popup: "popup.html" } : {}),
      },
    },
    files: {
      "popup.html": `<!DOCTYPE html><meta charset="utf-8"><body>Popup</body>`,
    },
    background() {
      browser.test.onMessage.addListener(async (msg, id, text) => {
        await browser.browserAction.setBadgeText({ text, tabId: id });
        browser.test.sendMessage("badge-set");
      });
      browser.browserAction.onClicked.addListener(tab => {
        browser.test.sendMessage("clicked", tab.id);
      });
    },
  });
}

async function addLoadedTab() {
  const tab = BrowserTestUtils.addTab(gBrowser, PAGE);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

async function makeSplit() {
  const tabs = [await addLoadedTab(), await addLoadedTab()];
  gBrowser.addTabSplitView(tabs, { insertBefore: tabs[0] });
  gBrowser.selectedTab = tabs[0];
  await TestUtils.waitForCondition(
    () => paneHeader(tabs[0]) && paneHeader(tabs[1]),
    "pane bars are shown"
  );
  return tabs;
}

function tabId(tab) {
  const { ExtensionParent } = ChromeUtils.importESModule(
    "resource://gre/modules/ExtensionParent.sys.mjs"
  );
  return ExtensionParent.apiManager.global.tabTracker.getId(tab);
}

function paneHeader(tab) {
  return document.querySelector(
    `.split-pane-header[panel="${tab.linkedPanel}"]`
  );
}

function paneAction(tab, widgetId) {
  return paneHeader(tab)?.querySelector(
    `.split-pane-action[data-widget-id="${widgetId}"]`
  );
}

function widgetIdFor(extension) {
  return `${makeWidgetId(extension.id)}-browser-action`;
}

function makeWidgetId(id) {
  return id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function closeSplit(tabs) {
  tabs[0].splitview.unsplitTabs();
  gBrowser.removeTabs(tabs);
}

add_task(async function test_pane_buttons_match_toolbar_spacing() {
  const rect = el => el.getBoundingClientRect();
  const back = document.getElementById("back-button");
  const forward = document.getElementById("forward-button");
  const stockSize = rect(back.querySelector(".toolbarbutton-icon")).width;
  const stockPitch = rect(forward).left - rect(back).left;

  const tabs = await makeSplit();
  for (const tab of tabs) {
    const header = paneHeader(tab);
    const paneBack = header.querySelector(".split-pane-back");
    const paneForward = header.querySelector(".split-pane-forward");
    Assert.equal(
      rect(paneBack).width,
      stockSize,
      "Pane buttons are as large as toolbar buttons"
    );
    Assert.equal(
      rect(paneForward).left - rect(paneBack).left,
      stockPitch,
      "Pane buttons are spaced like toolbar buttons"
    );
  }
  closeSplit(tabs);
});

add_task(async function test_panes_show_extension_buttons() {
  const extension = loadExtension();
  await extension.startup();
  const widgetId = widgetIdFor(extension);
  const node = document.getElementById(widgetId);
  ok(BrowserTestUtils.isVisible(node), "The toolbar shows the extension");

  const tabs = await makeSplit();
  for (const tab of tabs) {
    const button = paneAction(tab, widgetId);
    ok(button, "Each pane bar has the extension's button");
    ok(BrowserTestUtils.isVisible(button), "The pane button is visible");
    is(
      button.nextElementSibling,
      paneHeader(tab).querySelector(".split-pane-extensions"),
      "The extensions button follows the extension buttons"
    );
  }
  ok(BrowserTestUtils.isHidden(node), "The toolbar's extension button hides");
  ok(
    BrowserTestUtils.isHidden(
      document.getElementById("unified-extensions-button")
    ),
    "The toolbar's extensions button hides"
  );
  is(
    node.getAttribute("cui-anchorid"),
    paneAction(tabs[0], widgetId).id,
    "Popups open from the selected pane's bar"
  );

  extension.sendMessage("set-badge", tabId(tabs[1]), "7");
  await extension.awaitMessage("badge-set");
  await TestUtils.waitForCondition(
    () => paneAction(tabs[1], widgetId).getAttribute("badge") == "7",
    "The badge shows on the pane of its tab"
  );
  ok(
    !paneAction(tabs[0], widgetId).hasAttribute("badge"),
    "The other pane shows no badge"
  );

  closeSplit(tabs);
  await TestUtils.waitForCondition(
    () => !window.SplitPaneActions,
    "The window hook is removed"
  );
  ok(BrowserTestUtils.isVisible(node), "The toolbar shows the extension again");
  ok(!node.hasAttribute("cui-anchorid"), "The popup anchor is restored");
  await extension.unload();
});

add_task(async function test_pane_button_opens_popup_for_its_pane() {
  const extension = loadExtension();
  await extension.startup();
  const widgetId = widgetIdFor(extension);
  const tabs = await makeSplit();

  const button = paneAction(tabs[1], widgetId);
  const shown = BrowserTestUtils.waitForEvent(
    document,
    "popupshown",
    false,
    e => e.target.id?.startsWith("customizationui-widget-panel")
  );
  EventUtils.synthesizeMouseAtCenter(button, {});
  const { target: panel } = await shown;
  is(gBrowser.selectedTab, tabs[1], "The pane of the button is selected");
  ok(
    button.contains(panel.anchorNode),
    `The popup opens from the pane's button (${panel.anchorNode?.className})`
  );
  const hidden = BrowserTestUtils.waitForPopupEvent(panel, "hidden");
  panel.hidePopup();
  await hidden;

  // A popup the extension opens itself, such as from its keyboard shortcut,
  // opens from the selected pane's bar too.
  const shownAgain = BrowserTestUtils.waitForEvent(
    document,
    "popupshown",
    false,
    e => e.target.id?.startsWith("customizationui-widget-panel")
  );
  gUnifiedExtensions
    .browserActionFor(WebExtensionPolicy.getByID(extension.id))
    .triggerAction(window);
  const { target: panelAgain } = await shownAgain;
  ok(
    button.contains(panelAgain.anchorNode),
    "The triggered popup opens from the pane"
  );
  const hiddenAgain = BrowserTestUtils.waitForPopupEvent(panelAgain, "hidden");
  panelAgain.hidePopup();
  await hiddenAgain;

  closeSplit(tabs);
  await extension.unload();
});

add_task(async function test_pane_button_clicks_for_its_pane() {
  const extension = loadExtension({ popup: false });
  await extension.startup();
  const widgetId = widgetIdFor(extension);
  const tabs = await makeSplit();

  EventUtils.synthesizeMouseAtCenter(paneAction(tabs[1], widgetId), {});
  is(
    await extension.awaitMessage("clicked"),
    tabId(tabs[1]),
    "The click goes to the pane's tab"
  );

  closeSplit(tabs);
  await extension.unload();
});

add_task(async function test_pane_extensions_button_opens_panel() {
  const extension = loadExtension();
  await extension.startup();
  // An extension that is not pinned keeps the panel from opening about:addons.
  const unpinned = ExtensionTestUtils.loadExtension({
    manifest: { browser_action: { default_area: "menupanel" } },
  });
  await unpinned.startup();
  const tabs = await makeSplit();

  const button = paneHeader(tabs[1]).querySelector(".split-pane-extensions");
  const panel = gUnifiedExtensions.panel;
  const shown = BrowserTestUtils.waitForPopupEvent(panel, "shown");
  EventUtils.synthesizeMouseAtCenter(button, {});
  await shown;
  is(gBrowser.selectedTab, tabs[1], "The pane of the button is selected");
  is(panel.anchorNode, button, "The panel opens from the pane's button");
  ok(gUnifiedExtensions.isPanelOpen(), "The panel counts as open");

  const hidden = BrowserTestUtils.waitForPopupEvent(panel, "hidden");
  EventUtils.synthesizeMouseAtCenter(button, {});
  await hidden;
  ok(!gUnifiedExtensions.isPanelOpen(), "A second click closes the panel");

  closeSplit(tabs);
  await unpinned.unload();
  await extension.unload();
});

add_task(async function test_toolbar_row_is_shared_by_panes() {
  const tabs = await makeSplit();
  for (const id of ["PanelUI-button", "fxa-toolbar-menu-button"]) {
    const node = document.getElementById(id);
    ok(!node || BrowserTestUtils.isHidden(node), `${id} hides`);
  }
  const navbar = document.getElementById("nav-bar").getBoundingClientRect();
  const panels = tabs.map(tab =>
    document.getElementById(tab.linkedPanel).getBoundingClientRect()
  );
  const headers = tabs.map(tab => paneHeader(tab).getBoundingClientRect());
  Assert.lessOrEqual(
    navbar.right - headers[1].right,
    8,
    "The rightmost pane bar reaches the end of the toolbar row"
  );
  Assert.lessOrEqual(
    Math.abs(headers[1].width - panels[1].width),
    2,
    "The rightmost pane bar is as wide as its pane"
  );
  Assert.lessOrEqual(
    Math.abs(headers[0].width - headers[1].width),
    2,
    "Both pane bars are equally wide"
  );

  const menuButton = paneHeader(tabs[1]).querySelector(".split-pane-app-menu");
  ok(BrowserTestUtils.isVisible(menuButton), "Each pane bar has a menu button");
  const shown = BrowserTestUtils.waitForPopupEvent(PanelUI.panel, "shown");
  EventUtils.synthesizeMouseAtCenter(menuButton, {});
  await shown;
  is(gBrowser.selectedTab, tabs[1], "The pane of the menu button is selected");
  ok(
    menuButton.contains(PanelUI.panel.anchorNode),
    "The menu opens from the pane's button"
  );
  const hidden = BrowserTestUtils.waitForPopupEvent(PanelUI.panel, "hidden");
  EventUtils.synthesizeMouseAtCenter(menuButton, {});
  await hidden;

  closeSplit(tabs);
  await TestUtils.waitForCondition(
    () => BrowserTestUtils.isVisible(document.getElementById("PanelUI-button")),
    "The toolbar menu button comes back"
  );
});

add_task(async function test_toolbar_pane_bars_follow_sidebar() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.animation.enabled", true],
      ["sidebar.visibility", "hide-sidebar"],
      ["sidebar.revealOnHover", true],
    ],
  });
  await SidebarController.waitUntilStable();
  const container = SidebarController.sidebarContainer;
  if (container.hidden) {
    await SidebarController.handleToolbarButtonClick();
    await TestUtils.waitForCondition(() => !container.hidden);
  }
  const tabs = await makeSplit();
  const aligned = () =>
    tabs.every(tab => {
      const header = paneHeader(tab).getBoundingClientRect();
      const panel = document
        .getElementById(tab.linkedPanel)
        .getBoundingClientRect();
      return Math.abs(header.right - panel.right) <= 2;
    });
  const settled = async () => {
    await TestUtils.waitForTick();
    await TestUtils.waitForCondition(
      () => !SidebarController._ongoingAnimations.length,
      "Sidebar animation ends"
    );
    await new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
  };
  // The first pane's right edge stays inside the toolbar row, so its bar
  // must follow it on every frame of the slide.
  let sampling = false;
  let drift = 0;
  let frames = 0;
  const sample = () => {
    if (!sampling) {
      return;
    }
    requestAnimationFrame(() =>
      // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
      setTimeout(() => {
        if (SidebarController._ongoingAnimations.length) {
          const header = paneHeader(tabs[0]).getBoundingClientRect();
          const panel = document
            .getElementById(tabs[0].linkedPanel)
            .getBoundingClientRect();
          drift = Math.max(drift, Math.abs(header.right - panel.right));
          frames++;
        }
        sample();
      }, 0)
    );
  };
  const slide = async (expectHidden, label) => {
    drift = 0;
    frames = 0;
    sampling = true;
    sample();
    await SidebarController.handleToolbarButtonClick();
    await TestUtils.waitForCondition(
      () => container.hidden == expectHidden,
      `Sidebar ${label}`
    );
    await settled();
    sampling = false;
    Assert.greater(frames, 2, `Sampled the slide while the sidebar ${label}`);
    Assert.lessOrEqual(drift, 2, `Pane bars follow the slide as it ${label}`);
    ok(aligned(), `Pane bars line up with their panes after it ${label}`);
  };
  await TestUtils.waitForCondition(aligned, "Pane bars line up");
  await slide(true, "hides");
  await slide(false, "shows");

  closeSplit(tabs);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_pane_button_context_menu() {
  const extension = loadExtension();
  await extension.startup();
  const widgetId = widgetIdFor(extension);
  const tabs = await makeSplit();

  const menu = document.getElementById("unified-extensions-context-menu");
  const shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
  EventUtils.synthesizeMouseAtCenter(paneAction(tabs[0], widgetId), {
    type: "contextmenu",
  });
  await shown;
  const pin = menu.querySelector(
    ".unified-extensions-context-menu-pin-to-toolbar"
  );
  ok(!pin.hidden, "The menu is for the extension's button");
  ok(pin.hasAttribute("checked"), "It shows the button as pinned");
  const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
  menu.hidePopup();
  await hidden;

  closeSplit(tabs);
  await extension.unload();
});

add_task(async function test_pinning_puts_extension_before_extensions_button() {
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { browser_action: { default_area: "menupanel" } },
  });
  await extension.startup();
  const widgetId = widgetIdFor(extension);
  gUnifiedExtensions.pinToToolbar(widgetId, true);
  const ids = CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR);
  is(
    ids.indexOf(widgetId) + 1,
    ids.indexOf("unified-extensions-button"),
    "A pinned extension sits just before the extensions button"
  );
  await extension.unload();
});
