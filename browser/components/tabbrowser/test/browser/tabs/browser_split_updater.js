/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { SplitUpdater } = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/SplitUpdater.sys.mjs"
);

const { CustomizableUITestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/CustomizableUITestUtils.sys.mjs"
);
const gCUITestUtils = new CustomizableUITestUtils(window);

const SERVER =
  "https://example.com/browser/browser/components/tabbrowser/test/browser/tabs/split_update_release.sjs";

let updates = [];

add_setup(async function () {
  let { update, installedStamp } = SplitUpdater;
  SplitUpdater.update = release => updates.push(release);
  SplitUpdater.installedStamp = "261116-1645";
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.splitUpdate.enabled", true],
      ["browser.splitUpdate.lastCheck", 0],
    ],
  });
  registerCleanupFunction(() => {
    SplitUpdater.update = update;
    SplitUpdater.installedStamp = installedStamp;
    SplitUpdater.hide();
    Services.prefs.clearUserPref("browser.splitUpdate.lastCheck");
  });
});

function notification() {
  return gNotificationBox.getNotificationWithValue("split-update");
}

async function checkTag(tag) {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.splitUpdate.url", `${SERVER}?tag=${tag}`]],
  });
  let release = await SplitUpdater.check();
  await SpecialPowers.popPrefEnv();
  return release;
}

add_task(async function test_same_or_older_release_shows_nothing() {
  ok(!(await checkTag("split-160.0-261116-1645")), "Same build is not newer");
  ok(!(await checkTag("split-159.0.1-1108-1251")), "Old stamp is ignored");
  ok(!(await checkTag("split-160.0-261101-0900")), "Older build is ignored");
  ok(!notification(), "No notice");
});

add_task(async function test_newer_release_offers_restart() {
  let release = await checkTag("split-161.0-261120-0900");
  is(release.stamp, "261120-0900", "Newer build found");
  is(release.dmgURL, "https://example.com/n.dmg", "The DMG asset is used");
  ok(notification(), "Notice appears");
  is(
    notification().messageL10nId,
    "split-update-available",
    "Notice offers the update"
  );
  Assert.greater(
    Services.prefs.getIntPref("browser.splitUpdate.lastCheck"),
    0,
    "The check time is saved"
  );

  notification().buttonContainer.querySelector("button").click();
  is(updates.length, 1, "Restart to Update starts the update");
  is(updates[0].stamp, "261120-0900", "It updates to the newer build");
});

add_task(async function test_checks_once_a_day() {
  SplitUpdater.hide();
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.splitUpdate.url", `${SERVER}?tag=split-161.0-261120-0900`],
      ["browser.splitUpdate.lastCheck", Math.floor(Date.now() / 1000) - 60],
    ],
  });
  ok(!(await SplitUpdater.maybeCheck()), "No second check within a day");
  ok(!notification(), "No notice");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_disabled_pref_skips_check() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.splitUpdate.enabled", false]],
  });
  ok(!(await checkTag("split-161.0-261120-0900")), "Disabled pref skips");
  ok(!notification(), "No notice");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_release_without_dmg_is_ignored() {
  is(
    SplitUpdater.parseRelease({ tag_name: "split-161.0-261120-0900" }),
    null,
    "A release without the DMG asset is ignored"
  );
});

async function checkNowWith(query) {
  SplitUpdater.hide();
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.splitUpdate.url", `${SERVER}?${query}`],
      ["browser.splitUpdate.lastCheck", Math.floor(Date.now() / 1000) - 60],
    ],
  });
  let release = await SplitUpdater.checkNow();
  await SpecialPowers.popPrefEnv();
  return release;
}

add_task(async function test_check_now_reports_up_to_date() {
  ok(
    !(await checkNowWith("tag=split-160.0-261116-1645")),
    "Same build is not newer"
  );
  let shown = notification();
  ok(shown, "A notice reports the result");
  is(shown.messageL10nId, "split-update-up-to-date", "It says up to date");
  is(
    shown.messageL10nArgs.version,
    `${Services.appinfo.version} split 261116-1645`,
    "It names the running version"
  );
});

add_task(async function test_check_now_ignores_daily_limit() {
  updates = [];
  let release = await checkNowWith("tag=split-161.0-261120-0900");
  is(release?.stamp, "261120-0900", "A recent daily check does not block it");
  is(
    notification().messageL10nId,
    "split-update-available",
    "Notice offers the update"
  );
  notification().buttonContainer.querySelector("button").click();
  is(updates.length, 1, "Restart to Update starts the update");
});

add_task(async function test_check_now_reports_failure() {
  ok(!(await checkNowWith("status=500")), "A server error finds nothing");
  is(
    notification().messageL10nId,
    "split-update-check-failed",
    "It says the check failed"
  );
  let button = notification().buttonContainer.querySelector("button");
  is(
    button.getAttribute("data-l10n-id"),
    "split-update-try-again",
    "It offers to try again"
  );
  SplitUpdater.hide();
});

add_task(async function test_menu_items_follow_can_update() {
  await gCUITestUtils.openMainMenu();
  let button = PanelMultiView.getViewNode(
    document,
    "appMenu-split-update-button"
  );
  ok(BrowserTestUtils.isVisible(button), "The app menu shows the item");

  await SpecialPowers.pushPrefEnv({
    set: [["browser.splitUpdate.url", `${SERVER}?tag=split-160.0-261116-1645`]],
  });
  let shown = TestUtils.waitForCondition(
    () => notification()?.messageL10nId == "split-update-up-to-date",
    "Clicking the item checks right away"
  );
  let hidden = BrowserTestUtils.waitForEvent(PanelUI.panel, "popuphidden");
  button.click();
  await hidden;
  await shown;
  await SpecialPowers.popPrefEnv();
  SplitUpdater.hide();

  buildHelpMenu();
  ok(
    !document.getElementById("menu_splitUpdateCheck").hidden,
    "The Help menu shows the item"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["browser.splitUpdate.enabled", false]],
  });
  buildHelpMenu();
  ok(
    document.getElementById("menu_splitUpdateCheck").hidden,
    "The Help menu hides the item when updates are off"
  );
  await gCUITestUtils.openMainMenu();
  ok(BrowserTestUtils.isHidden(button), "The app menu hides it too");
  await gCUITestUtils.hideMainMenu();
  await SpecialPowers.popPrefEnv();
});
