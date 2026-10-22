/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_checked_sidebar_button_has_no_highlight() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
    ],
  });
  CustomizableUI.addWidgetToArea("sidebar-button", "nav-bar", 0);
  const button = document.getElementById("sidebar-button");
  const icon =
    button.querySelector(".toolbarbutton-badge-stack") ||
    button.querySelector(".toolbarbutton-icon");

  button.checked = true;
  is(
    getComputedStyle(icon).backgroundColor,
    "rgba(0, 0, 0, 0)",
    "A checked sidebar button is not highlighted with vertical tabs"
  );

  button.checked = false;
  CustomizableUI.reset();
});
