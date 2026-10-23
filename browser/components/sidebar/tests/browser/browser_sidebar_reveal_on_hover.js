/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// With vertical tabs, "hide-sidebar" visibility and sidebar.revealOnHover, a
// hidden sidebar slides in over the page when the pointer reaches the window
// edge and hides again when the pointer leaves it.

const { sidebarContainer } = SidebarController;

function edge() {
  return document.getElementById("sidebar-reveal-edge");
}

async function hoverEdge() {
  EventUtils.synthesizeMouse(edge(), 2, 100, { type: "mousemove" });
  await TestUtils.waitForCondition(
    () => !sidebarContainer.hidden,
    "Sidebar is revealed"
  );
}

async function hoverContent() {
  const tabbox = document.getElementById("tabbrowser-tabbox");
  EventUtils.synthesizeMouseAtCenter(tabbox, { type: "mousemove" });
  EventUtils.synthesizeMouse(tabbox, 400, 300, { type: "mousemove" });
}

add_setup(async () => {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.animation.enabled", false],
      [VERTICAL_TABS_PREF, true],
      ["sidebar.revealOnHover", true],
    ],
  });
  await SidebarTestUtils.waitForTabstripOrientation(window, "vertical");
  await SpecialPowers.pushPrefEnv({
    set: [[SIDEBAR_VISIBILITY_PREF, "hide-sidebar"]],
  });
  await SidebarController.waitUntilStable();
  if (!sidebarContainer.hidden) {
    await SidebarController.handleToolbarButtonClick();
  }
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);
});

add_task(async function test_reveal_and_conceal() {
  Assert.ok(edge() && !edge().hidden, "The reveal edge is active");

  await hoverEdge();
  Assert.ok(
    sidebarContainer.hasAttribute("sidebar-hover-revealed"),
    "The sidebar floats over the page"
  );
  Assert.ok(edge().hidden, "The edge is inactive while revealed");
  Assert.ok(
    SidebarController.sidebarMain.expanded,
    "The revealed sidebar is expanded"
  );
  Assert.ok(
    !SidebarController.getUIState().launcherVisible,
    "Revealing does not change the saved sidebar state"
  );

  await hoverContent();
  await TestUtils.waitForCondition(
    () => sidebarContainer.hidden,
    "Sidebar hides when the pointer leaves it"
  );
  Assert.ok(
    !sidebarContainer.hasAttribute("sidebar-hover-revealed"),
    "The float attribute is removed"
  );
  Assert.ok(!edge().hidden, "The edge is active again");
});

add_task(async function test_toggle_while_revealed_keeps_sidebar() {
  await hoverEdge();
  await SidebarController.handleToolbarButtonClick();
  Assert.ok(!sidebarContainer.hidden, "The sidebar stays shown");
  Assert.ok(
    !sidebarContainer.hasAttribute("sidebar-hover-revealed"),
    "The sidebar is back in the layout"
  );
  Assert.ok(edge().hidden, "The edge is inactive while the sidebar is shown");

  await hoverContent();
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 500));
  Assert.ok(!sidebarContainer.hidden, "Leaving does not hide a shown sidebar");

  await SidebarController.handleToolbarButtonClick();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);
  Assert.ok(!edge().hidden, "The edge is active after hiding again");
});

add_task(async function test_pref_off_disables_edge() {
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.revealOnHover", false]] });
  Assert.ok(edge().hidden, "The edge is inactive with the pref off");
  await SpecialPowers.popPrefEnv();
  Assert.ok(!edge().hidden, "The edge is active with the pref on");
});
