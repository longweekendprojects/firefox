/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

async function contentWebdriver() {
  return BrowserTestUtils.withNewTab("https://example.com/browser/", browser =>
    SpecialPowers.spawn(browser, [], () => content.navigator.webdriver)
  );
}

add_task(async function test_webdriver_hidden_from_websites() {
  Assert.ok(
    Cc["@mozilla.org/remote/marionette;1"].getService(Ci.nsIMarionette)
      .isBrowserAutomationRunning,
    "The test harness runs under Marionette"
  );
  is(await contentWebdriver(), false, "Websites do not see automation");

  await SpecialPowers.pushPrefEnv({
    set: [["browser.remoteControl.reportToWebsites", true]],
  });
  is(await contentWebdriver(), true, "The pref restores the stock signal");
  await SpecialPowers.popPrefEnv();
});
