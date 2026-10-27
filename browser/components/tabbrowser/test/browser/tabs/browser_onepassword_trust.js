/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { OnePasswordTrust, EXTENSION_ID } = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/OnePasswordTrust.sys.mjs"
);

let launched = 0;

add_setup(async function () {
  let original = OnePasswordTrust._appFile;
  OnePasswordTrust._appFile = () => ({
    exists: () => true,
    launch: () => launched++,
  });
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.onepassword.trustPrompt.enabled", true],
      ["browser.onepassword.trustPrompt.done", false],
    ],
  });
  registerCleanupFunction(() => {
    OnePasswordTrust._appFile = original;
    OnePasswordTrust._reset();
    Services.prefs.clearUserPref("browser.onepassword.trustPrompt.done");
  });
});

function notification() {
  return gNotificationBox.getNotificationWithValue("onepassword-trust");
}

function loadOnePassword() {
  return ExtensionTestUtils.loadExtension({
    manifest: { browser_specific_settings: { gecko: { id: EXTENSION_ID } } },
    useAddonManager: "temporary",
  });
}

add_task(async function test_no_notice_without_extension() {
  ok(!(await OnePasswordTrust.maybeShow()), "No notice without 1Password");
  ok(!notification(), "No notification shown");
});

add_task(async function test_notice_dismissed_stays_hidden() {
  let ext = loadOnePassword();
  await ext.startup();
  await TestUtils.waitForCondition(notification, "Notice appears on install");
  is(
    notification().messageL10nId,
    "onepassword-trust-message",
    "Notice explains Add Browser"
  );
  notification().closeButton.click();
  await TestUtils.waitForCondition(() => !notification(), "Notice closes");
  ok(!(await OnePasswordTrust.maybeShow()), "Dismissed notice stays hidden");
  await ext.unload();
  OnePasswordTrust._reset();
});

add_task(async function test_open_button_launches_once() {
  let ext = loadOnePassword();
  await ext.startup();
  await TestUtils.waitForCondition(notification, "Notice appears on install");
  notification().buttonContainer.querySelector("button").click();
  await TestUtils.waitForCondition(() => !notification(), "Notice closes");
  is(launched, 1, "1Password was opened");
  ok(
    Services.prefs.getBoolPref("browser.onepassword.trustPrompt.done"),
    "Notice is marked done"
  );
  ok(!(await OnePasswordTrust.maybeShow()), "Notice does not come back");
  await ext.unload();
});

add_task(async function test_disabled_pref_hides_notice() {
  Services.prefs.setBoolPref("browser.onepassword.trustPrompt.done", false);
  await SpecialPowers.pushPrefEnv({
    set: [["browser.onepassword.trustPrompt.enabled", false]],
  });
  let ext = loadOnePassword();
  await ext.startup();
  ok(!(await OnePasswordTrust.maybeShow()), "Disabled pref hides the notice");
  ok(!notification(), "No notification shown");
  await ext.unload();
  await SpecialPowers.popPrefEnv();
});
