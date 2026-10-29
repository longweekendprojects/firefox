/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", true]] });
});

function panelRect(tab) {
  return document.getElementById(tab.linkedPanel).getBoundingClientRect();
}

/**
 * Drags `tab` from the tab strip over the page at `x`, `y` (fractions of the
 * page area), checks what the page shows during the drag, and drops it there.
 *
 * @returns {{shown: MozTabbrowserTab, indicator: boolean}}
 */
async function dragTabToPage(tab, x, y, { drop = true } = {}) {
  EventUtils.startDragSession(window, "move");
  let [, dataTransfer] = EventUtils.synthesizeDragOver(tab, tab, null, "move");
  let session = EventUtils._getDOMWindowUtils(window).dragSession;
  let overlay = document.getElementById("tab-content-drop");
  Assert.ok(overlay, "The page drop area is there during a tab drag");
  let rect = gBrowser.tabpanels.getBoundingClientRect();
  let point = {
    clientX: rect.left + rect.width * x,
    clientY: rect.top + rect.height * y,
  };
  for (let type of ["dragenter", "dragover"]) {
    EventUtils.sendDragEvent(
      EventUtils.createDragEventObject(
        type,
        overlay,
        window,
        dataTransfer,
        point
      ),
      overlay
    );
  }
  let shown = gBrowser.selectedTab;
  let indicator = !overlay.firstElementChild.hidden;
  if (drop) {
    dataTransfer.dropEffect = "move";
    EventUtils.sendDragEvent(
      EventUtils.createDragEventObject(
        "drop",
        overlay,
        window,
        dataTransfer,
        point
      ),
      overlay
    );
  }
  // Synthesized drag sessions fire no dragend, so send it as the drag
  // service would.
  dataTransfer.dropEffect = drop ? "move" : "none";
  EventUtils.sendDragEvent(
    EventUtils.createDragEventObject("dragend", tab, window, dataTransfer, {}),
    tab
  );
  session.endDragSession(drop, 0);
  await TestUtils.waitForCondition(
    () => !document.getElementById("tab-content-drop"),
    "The page drop area is gone after the drag"
  );
  return { shown, indicator };
}

add_task(async function test_drop_tab_on_page_splits() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  let tab3 = await addTab("data:text/html,three");
  try {
    gBrowser.selectedTab = tab1;
    let { shown, indicator } = await dragTabToPage(tab2, 0.9, 0.5);
    Assert.equal(shown, tab1, "The page keeps showing the selected tab");
    Assert.ok(indicator, "The drop side is highlighted");
    let splitview = tab1.splitview;
    Assert.ok(splitview, "Dropping a tab on the page splits it");
    Assert.equal(tab2.splitview, splitview, "The dropped tab joins the split");
    Assert.equal(gBrowser.selectedTab, tab2, "The dropped tab is selected");
    await TestUtils.waitForCondition(
      () => panelRect(tab1).right <= panelRect(tab2).left,
      "The dropped tab takes the right side"
    );

    gBrowser.selectedTab = tab1;
    let left = panelRect(tab1);
    let rect = gBrowser.tabpanels.getBoundingClientRect();
    ({ shown } = await dragTabToPage(
      tab3,
      (left.left - rect.left + left.width / 2) / rect.width,
      0.95
    ));
    Assert.equal(shown, tab1, "The split stays on screen during the drag");
    Assert.equal(tab3.splitview, splitview, "A tab dropped on a pane joins");
    Assert.equal(splitview.tabs.length, 3, "The split has three panes");
    await TestUtils.waitForCondition(
      () => panelRect(tab1).bottom <= panelRect(tab3).top,
      "The dropped tab lands below the pane it was dropped on"
    );
  } finally {
    for (let tab of [tab1, tab2, tab3]) {
      BrowserTestUtils.removeTab(tab);
    }
  }
});

add_task(async function test_drag_back_without_drop_keeps_dragged_tab() {
  let tab1 = await addTab("data:text/html,one");
  let tab2 = await addTab("data:text/html,two");
  try {
    gBrowser.selectedTab = tab1;
    let { shown } = await dragTabToPage(tab2, 0.9, 0.5, { drop: false });
    Assert.equal(
      shown,
      tab1,
      "The page shows the selected tab during the drag"
    );
    Assert.ok(!tab1.splitview && !tab2.splitview, "Nothing was split");
    Assert.equal(
      gBrowser.selectedTab,
      tab2,
      "A cancelled drag leaves the dragged tab selected, as before"
    );
  } finally {
    BrowserTestUtils.removeTab(tab1);
    BrowserTestUtils.removeTab(tab2);
  }
});

add_task(async function test_drag_selected_tab_has_no_page_target() {
  let tab1 = await addTab("data:text/html,one");
  try {
    gBrowser.selectedTab = tab1;
    EventUtils.startDragSession(window, "move");
    let [, dataTransfer] = EventUtils.synthesizeDragOver(
      tab1,
      tab1,
      null,
      "move"
    );
    let session = EventUtils._getDOMWindowUtils(window).dragSession;
    Assert.ok(
      !document.getElementById("tab-content-drop"),
      "Dragging the selected tab offers no page drop"
    );
    EventUtils.sendDragEvent(
      EventUtils.createDragEventObject(
        "dragend",
        tab1,
        window,
        dataTransfer,
        {}
      ),
      tab1
    );
    session.endDragSession(true, 0);
  } finally {
    BrowserTestUtils.removeTab(tab1);
  }
});
