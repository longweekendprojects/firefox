/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { OnePasswordTrust, HELPER_NAME } = ChromeUtils.importESModule(
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
    set: [["browser.onepassword.trustPrompt.enabled", true]],
  });
  registerCleanupFunction(() => {
    OnePasswordTrust._appFile = original;
    OnePasswordTrust._reset();
    OnePasswordTrust.hide();
  });
});

function notification() {
  return gNotificationBox.getNotificationWithValue("onepassword-trust");
}

// Message shapes recorded from 1Password's helper.
function notifyState(state, helper = HELPER_NAME) {
  let msg =
    state == "Known"
      ? {
          type: "Success",
          content: { response: {} },
          browser_state: { type: "Known" },
        }
      : {
          type: "NotificationModern",
          content: {
            content: {
              type: "BrowserVerificationFailed",
              content: "UnknownBrowser",
            },
            browser_state: { type: state },
          },
        };
  Services.obs.notifyObservers(
    { wrappedJSObject: msg },
    "native-app-message",
    helper
  );
}

add_task(async function test_no_notice_without_untrusted_report() {
  notifyState("Unknown");
  notifyState("Untrusted", "other.host");
  await TestUtils.waitForTick();
  ok(!notification(), "No notice unless 1Password reports Untrusted");
});

add_task(async function test_notice_stays_until_trusted() {
  notifyState("Untrusted");
  await TestUtils.waitForCondition(notification, "Notice appears");
  is(
    notification().messageL10nId,
    "onepassword-trust-message",
    "Notice explains Add Browser"
  );

  notification().buttonContainer.querySelector("button").click();
  is(launched, 1, "1Password was opened");
  ok(notification(), "Notice stays after opening 1Password");

  notifyState("Untrusted");
  await TestUtils.waitForTick();
  ok(notification(), "Notice stays while 1Password reports Untrusted");

  notifyState("Known");
  ok(!notification(), "Notice closes once 1Password trusts the browser");
});

add_task(async function test_notice_dismissed_stays_hidden() {
  notifyState("Untrusted");
  await TestUtils.waitForCondition(notification, "Notice appears");
  notification().closeButton.click();
  await TestUtils.waitForCondition(() => !notification(), "Notice closes");
  notifyState("Untrusted");
  await TestUtils.waitForTick();
  ok(!notification(), "Dismissed notice stays hidden this session");
  OnePasswordTrust._reset();
});

add_task(async function test_disabled_pref_hides_notice() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.onepassword.trustPrompt.enabled", false]],
  });
  notifyState("Untrusted");
  await TestUtils.waitForTick();
  ok(!notification(), "Disabled pref hides the notice");
  await SpecialPowers.popPrefEnv();
});
