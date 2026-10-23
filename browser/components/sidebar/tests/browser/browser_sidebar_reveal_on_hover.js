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

add_task(async function test_closing_settings_after_choosing_hide() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revealOnHover", false],
      [SIDEBAR_VISIBILITY_PREF, "expand-on-hover"],
    ],
  });
  await SidebarController.waitUntilStable();
  Assert.ok(!sidebarContainer.hidden, "The collapsed sidebar is shown");

  await SidebarController.show("viewCustomizeSidebar");
  Services.prefs.setBoolPref("sidebar.revealOnHover", true);
  Services.prefs.setStringPref(SIDEBAR_VISIBILITY_PREF, "hide-sidebar");
  await SidebarController.waitUntilStable();
  SidebarController.hide();
  await SidebarController.waitUntilStable();

  Assert.ok(!sidebarContainer.hidden, "The sidebar is shown again");
  Assert.ok(
    SidebarController.sidebarMain.expanded,
    "The sidebar comes back wide, not compact"
  );

  await SidebarController.handleToolbarButtonClick();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);
  Assert.ok(!edge().hidden, "The edge is active once the sidebar is hidden");
  await hoverEdge();
  Assert.ok(
    SidebarController.sidebarMain.expanded,
    "The revealed sidebar is wide"
  );
  await hoverContent();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);

  Services.prefs.clearUserPref("sidebar.revealOnHover");
  await SpecialPowers.popPrefEnv();
});

function leaveWindow(target, clientX) {
  target.dispatchEvent(
    new MouseEvent(target == edge() ? "mouseleave" : "mouseout", {
      bubbles: target != edge(),
      clientX,
      clientY: 100,
      relatedTarget: null,
    })
  );
}

function reenterWindow() {
  document
    .getElementById("tabbrowser-tabbox")
    .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

add_task(async function test_overshooting_the_edge_reveals_and_stays() {
  Assert.ok(!edge().hidden, "The reveal edge is active");
  leaveWindow(edge(), -3);
  Assert.ok(!sidebarContainer.hidden, "Leaving through the edge reveals");

  leaveWindow(sidebarContainer, -3);
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(r => setTimeout(r, 600));
  Assert.ok(
    !sidebarContainer.hidden,
    "The sidebar stays while the pointer is past the window edge"
  );

  reenterWindow();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);

  const tabbox = document.getElementById("tabbrowser-tabbox");
  leaveWindow(tabbox, 20);
  Assert.ok(
    !sidebarContainer.hidden,
    "A fast exit that skips the edge strip still reveals"
  );
  reenterWindow();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);

  leaveWindow(tabbox, 600);
  Assert.ok(sidebarContainer.hidden, "Leaving far from the edge does not");
});

add_task(async function test_conceal_slides_out() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.prefersReducedMotion", 0]],
  });
  await hoverEdge();
  let sawSlideOut = false;
  const observer = new MutationObserver(() => {
    sawSlideOut ||= sidebarContainer.hasAttribute("sidebar-hover-concealing");
  });
  observer.observe(sidebarContainer, { attributes: true });
  await hoverContent();
  await TestUtils.waitForCondition(() => sidebarContainer.hidden);
  observer.disconnect();
  Assert.ok(sawSlideOut, "The sidebar slides out before hiding");
  Assert.ok(
    !sidebarContainer.hasAttribute("sidebar-hover-concealing") &&
      !sidebarContainer.hasAttribute("sidebar-hover-revealed"),
    "Slide-out attributes are cleared"
  );
  Assert.ok(!edge().hidden, "The edge is active again");
});
