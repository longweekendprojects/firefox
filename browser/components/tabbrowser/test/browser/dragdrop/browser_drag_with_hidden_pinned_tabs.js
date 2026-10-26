/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const LIST_PREF = "browser.spaces.list";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.verticalTabs", true],
      ["browser.tabs.groups.enabled", false],
    ],
  });
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(LIST_PREF);
    Services.prefs.clearUserPref("browser.spaces.active");
    for (let tab of gBrowser.tabs.slice(1)) {
      BrowserTestUtils.removeTab(tab);
    }
    gBrowser.unpinTab(gBrowser.tabs[0]);
    gBrowser.showTab(gBrowser.tabs[0]);
  });
});

/**
 * Drags `source` upward and drops it just before `target`.
 *
 * @param {MozTabbrowserTab} source
 * @param {MozTabbrowserTab} target
 */
async function dragAbove(source, target) {
  let sourceRect = bounds(source);
  let targetRect = bounds(target);
  let overlap = Math.ceil(0.5 * targetRect.height) + 1;
  await customDragAndDrop(source, target, null, waitForTabMove(source), {
    clientX: Math.round(targetRect.left + targetRect.width / 2),
    clientY: targetRect.bottom - overlap + Math.floor(sourceRect.height / 2),
  });
}

add_task(async function test_drag_to_top_with_hidden_pinned_tabs() {
  Services.prefs.setStringPref(
    LIST_PREF,
    JSON.stringify([
      { id: "a", name: "A", icon: "circle", color: "blue" },
      { id: "b", name: "B", icon: "briefcase", color: "red" },
    ])
  );
  let startingTab = gBrowser.tabs[0];
  gBrowser.pinTab(startingTab);

  let hiddenPins = await Promise.all(
    [1, 2, 3].map(i => addTab(`data:text/plain,hidden${i}`))
  );
  for (let tab of hiddenPins) {
    gBrowser.pinTab(tab);
  }
  window.gSpaces.moveTabs(hiddenPins, "b");

  let [tab1, tab2, tab3, tab4, tab5] = await Promise.all(
    [1, 2, 3, 4, 5].map(i => addTab(`data:text/plain,tab${i}`))
  );
  Assert.equal(gBrowser.pinnedTabCount, 4, "4 pinned tabs in the window");
  Assert.equal(
    gBrowser.tabContainer.visiblePinnedTabCount,
    1,
    "Only 1 pinned tab is in the shown space"
  );

  await dragAbove(tab5, tab1);
  Assert.deepEqual(
    gBrowser.visibleTabs,
    [startingTab, tab5, tab1, tab2, tab3, tab4],
    "The dragged tab moved above every unpinned tab"
  );
});
